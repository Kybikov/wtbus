package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

func TestPlatformWorkspacesAndOwnerPermissions(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	t.Cleanup(func() { cache.Close() })
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	handler := app.routes()
	call := func(method, path, token string, input any, status int, out any) string {
		t.Helper()
		body, _ := json.Marshal(input)
		req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != status {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, status, w.Body)
		}
		if out != nil {
			if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
				t.Fatal(err)
			}
		}
		return w.Body.String()
	}
	row := func(query string, args ...any) string {
		t.Helper()
		var v string
		if err := db.QueryRow(ctx, query, args...).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	const password = "workspace-test-password"
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	primary := row(`INSERT INTO tenants(slug,name,subscription_status) VALUES('aa-platform-qa','First workspace','active') RETURNING id::text`)
	account := func(email, role string, platform bool) string {
		t.Helper()
		user := row(`INSERT INTO users(email,display_name,is_platform_admin) VALUES($1,'QA account',$2) RETURNING id::text`, email, platform)
		exec(`INSERT INTO memberships(user_id,tenant_id,role) VALUES($1,$2,$3::membership_role)`, user, primary, role)
		exec(`INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)`, user, string(hash))
		return user
	}
	account("global@workspace.invalid", "developer", true)
	account("tenant-dev@workspace.invalid", "developer", false)
	account("owner@workspace.invalid", "owner", false)
	login := func(email string) loginResponse {
		t.Helper()
		var data loginResponse
		call("POST", "/auth/login", "", loginRequest{Email: email, Password: password, AutoSelect: true}, 200, &data)
		if data.SessionToken == "" || data.RequiresCompanySelection {
			t.Fatal("login interrupted by company selection")
		}
		return data
	}
	admin := login("global@workspace.invalid").SessionToken
	owner := login("owner@workspace.invalid").SessionToken
	tenantDev := login("tenant-dev@workspace.invalid").SessionToken
	const platform = "/platform/workspaces"
	const added = "zz-platform-qa"
	call("GET", platform, owner, nil, 403, nil)
	call("GET", platform, tenantDev, nil, 403, nil)
	call("GET", platform, "", nil, 401, nil)
	input := provisionTenantRequest{Slug: added, Name: "Second workspace", Timezone: "UTC", BaseCurrency: "UAH", OwnerEmail: "owner@workspace.invalid", OwnerDisplayName: "QA owner"}
	call("POST", platform, admin, input, 201, nil)
	call("POST", platform, admin, input, 409, nil)
	sharedMember := row(`SELECT m.id::text FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND u.email='owner@workspace.invalid'`, primary)
	call("PATCH", "/tenants/aa-platform-qa/team/"+sharedMember, admin, map[string]string{"password": "another-test-password"}, 403, nil)
	second := row(`SELECT id::text FROM tenants WHERE slug=$1`, added)
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'QA customer','+380500001231') RETURNING id::text`, second)
	target := "/tenants/" + added + "/entity-details/customers/" + customer + "/deletion"
	call("GET", target, owner, nil, 403, nil)
	call("POST", "/auth/workspaces", tenantDev, map[string]string{"slug": added}, 403, nil)
	var next loginResponse
	call("POST", "/auth/workspaces", owner, map[string]string{"slug": added}, 200, &next)
	if next.TenantSlug != added || next.Role != "owner" {
		t.Fatalf("wrong workspace: %+v", next)
	}
	call("GET", "/auth/me", owner, nil, 401, nil)
	if got := login("owner@workspace.invalid").TenantSlug; got != added {
		t.Fatal("did not remember last workspace", got)
	}
	var removal deletionPreview
	call("GET", target, next.SessionToken, nil, 200, &removal)
	call("DELETE", target, next.SessionToken, map[string]string{"token": removal.Token}, 200, nil)
	if row(`SELECT count(*)::text FROM customers WHERE id=$1`, customer) != "0" {
		t.Fatal("owner could not delete record")
	}
	member := row(`SELECT id::text FROM memberships WHERE tenant_id=$1 AND role='owner'`, second)
	if row(`SELECT count(*)::text FROM activity_events WHERE entity_id=$1 AND actor_membership_id=$2 AND action='record_deleted'`, customer, member) != "1" {
		t.Fatal("owner deletion was not attributed")
	}
	call("GET", platform, next.SessionToken, nil, 403, nil)

	workspace := platform + "/" + added
	call("PATCH", workspace, admin, map[string]string{"status": "active", "reason": "QA activation"}, 200, nil)
	payment := map[string]any{"amountMinor": workspaceMonthlyMinor, "paidOn": time.Now().UTC().Format("2006-01-02"), "reference": "QA-receipt"}
	call("POST", workspace+"/payments", admin, payment, 201, nil)
	call("POST", workspace+"/payments", admin, payment, 409, nil)
	var details struct {
		Payments []platformPaymentRow
		Events   []platformEventRow
	}
	call("GET", workspace, admin, nil, 200, &details)
	if len(details.Payments) != 1 || details.Payments[0].AmountMinor != 300000 || len(details.Events) != 3 {
		t.Fatalf("wrong payment/activity history: %+v", details)
	}
	view := call("GET", platform, admin, nil, 200, nil)
	if !strings.Contains(view, added) || !strings.Contains(view, `"monthlyMinor":300000`) {
		t.Fatalf("invalid platform overview: %s", view)
	}
	call("POST", "/auth/workspaces", admin, map[string]string{"slug": added}, 200, &next)
	call("GET", platform, next.SessionToken, nil, 200, nil)
}
