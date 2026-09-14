package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAuthenticationFailures(t *testing.T) {
	db, err := pgxpool.New(context.Background(), "postgres://unused:unused@localhost:1/unused")
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	app := &application{db: db}
	for name, handler := range map[string]http.HandlerFunc{
		"identity": app.me,
		"logout":   app.logout,
		"protected route": app.requireRoles("owner")(func(w http.ResponseWriter, r *http.Request) {
			t.Error("must not reach the protected handler")
		}),
	} {
		for _, token := range []string{"", "session-during-database-outage"} {
			t.Run(name+"/"+token, func(t *testing.T) {
				r := httptest.NewRequest("GET", "/", nil)
				want := http.StatusUnauthorized
				if token != "" {
					r.Header.Set("Authorization", "Bearer "+token)
					want = http.StatusServiceUnavailable
				}
				w := httptest.NewRecorder()
				handler(w, r)
				if w.Code != want {
					t.Fatalf("status = %d, want %d", w.Code, want)
				}
			})
		}
	}
}

func TestExpiredOrRevokedSessionIsUnauthorized(t *testing.T) {
	w := httptest.NewRecorder()
	writeAuthenticationError(w, fmt.Errorf("session lookup: %w", pgx.ErrNoRows))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}
