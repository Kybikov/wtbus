package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

// Requires disposable, migrated PostgreSQL and Redis instances.
func TestProfilePostgres(t *testing.T) {
	url := os.Getenv("PROFILE_TEST_DATABASE_URL")
	redisURL := os.Getenv("PROFILE_TEST_REDIS_URL")
	if url == "" || redisURL == "" {
		t.Skip("set disposable PROFILE_TEST_DATABASE_URL and PROFILE_TEST_REDIS_URL")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	cache := redis.NewClient(options)
	defer cache.Close()
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	slug := fmt.Sprintf("profile-test-%d", time.Now().UnixNano())
	var tenantID, userID, memberID, otherUserID string
	row := func(query string, dest *string, args ...any) {
		t.Helper()
		if err := db.QueryRow(ctx, query, args...).Scan(dest); err != nil {
			t.Fatal(err)
		}
	}
	row(`INSERT INTO tenants(slug,name) VALUES($1,'Profile Test') RETURNING id::text`, &tenantID, slug)
	defer db.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenantID)
	row(`INSERT INTO users(email,display_name) VALUES($1,'Original') RETURNING id::text`, &userID, slug+"@test.invalid")
	defer db.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID)
	row(`INSERT INTO users(email,display_name) VALUES($1,'Unrelated') RETURNING id::text`, &otherUserID, slug+"-other@test.invalid")
	defer db.Exec(ctx, `DELETE FROM users WHERE id=$1`, otherUserID)
	row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'driver') RETURNING id::text`, &memberID, tenantID, userID)
	hash, _ := bcrypt.GenerateFromPassword([]byte("old-password-123"), bcrypt.MinCost)
	if _, err := db.Exec(ctx, `INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)`, userID, string(hash)); err != nil {
		t.Fatal(err)
	}
	actor := identity{UserID: userID, MembershipID: memberID, TenantID: tenantID, TenantSlug: slug, Role: "driver"}
	current, err := app.createSession(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	otherSession, err := app.createSession(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	request := func(body any) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(http.MethodPatch, "/api/v1/auth/me", bytes.NewReader(data))
		r.Header.Set("Authorization", "Bearer "+current.SessionToken)
		w := httptest.NewRecorder()
		app.updateProfile(w, r)
		return w
	}
	if w := request(map[string]string{"displayName": " Renamed "}); w.Code != 200 {
		t.Fatalf("rename: %d %s", w.Code, w.Body.String())
	}
	var name string
	row(`SELECT display_name FROM users WHERE id=$1`, &name, userID)
	if name != "Renamed" {
		t.Fatalf("name = %q", name)
	}
	row(`SELECT display_name FROM users WHERE id=$1`, &name, otherUserID)
	if name != "Unrelated" {
		t.Fatal("changed another account")
	}
	for _, body := range []any{
		map[string]string{"displayName": "Escalation", "role": "owner"},
		map[string]string{"displayName": "Escalation", "userId": otherUserID},
		map[string]string{"currentPassword": "wrong", "newPassword": "new-password-123", "displayName": "Must rollback"},
	} {
		if w := request(body); w.Code != 400 {
			t.Fatalf("invalid change: %d %s", w.Code, w.Body.String())
		}
	}
	row(`SELECT display_name FROM users WHERE id=$1`, &name, userID)
	if name != "Renamed" {
		t.Fatal("failed password change did not roll back name")
	}
	if w := request(map[string]string{"currentPassword": "old-password-123", "newPassword": "new-password-123"}); w.Code != 200 {
		t.Fatalf("password: %d %s", w.Code, w.Body.String())
	}
	var nextHash string
	row(`SELECT password_hash FROM user_credentials WHERE user_id=$1`, &nextHash, userID)
	if bcrypt.CompareHashAndPassword([]byte(nextHash), []byte("new-password-123")) != nil {
		t.Fatal("password not updated")
	}
	for _, check := range []struct {
		token string
		want  int
	}{{current.SessionToken, 200}, {otherSession.SessionToken, 401}} {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Header.Set("Authorization", "Bearer "+check.token)
		w := httptest.NewRecorder()
		app.me(w, r)
		if w.Code != check.want {
			t.Fatalf("session: %d, want %d", w.Code, check.want)
		}
	}
	var role string
	row(`SELECT role::text FROM memberships WHERE id=$1`, &role, memberID)
	if role != "driver" {
		t.Fatal("profile changed role")
	}
	defer cache.Del(ctx, "auth:profile-password:"+userID)
	for attempt := 0; attempt < loginFailureLimit; attempt++ {
		request(map[string]string{"currentPassword": "wrong", "newPassword": "another-password-123"})
	}
	if w := request(map[string]string{"currentPassword": "wrong", "newPassword": "another-password-123"}); w.Code != 429 {
		t.Fatalf("throttle: %d", w.Code)
	}
}
