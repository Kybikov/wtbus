package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestWorkspaceInvitationsPostgres(t *testing.T) {
	ctx := context.Background()
	db := deliveryTestDatabase(t)
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	t.Cleanup(func() { cache.Close() })
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	handler := app.routes()
	row := func(query string, args ...any) string {
		t.Helper()
		var result string
		if err := db.QueryRow(ctx, query, args...).Scan(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	session := func(tenant, slug, role, email string) string {
		user := row(`INSERT INTO users(email,display_name) VALUES($1,'QA founder') RETURNING id::text`, email)
		membership := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3::membership_role) RETURNING id::text`, tenant, user, role)
		login, err := app.createSession(ctx, identity{UserID: user, MembershipID: membership, TenantID: tenant, TenantSlug: slug, Role: role})
		if err != nil {
			t.Fatal(err)
		}
		return login.SessionToken
	}
	call := func(method, path, token string, input any, want int) map[string]any {
		t.Helper()
		body, _ := json.Marshal(input)
		request := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, response.Code, want, response.Body)
		}
		var result map[string]any
		if want != 204 {
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}
	tenant := row(`INSERT INTO tenants(slug,name,subscription_status) VALUES('invitations-qa','Invite QA','active') RETURNING id::text`)
	other := row(`INSERT INTO tenants(slug,name,subscription_status) VALUES('invite-other','Other QA','active') RETURNING id::text`)
	owner := session(tenant, "invitations-qa", "owner", "owner@invite.invalid")
	otherOwner := session(other, "invite-other", "owner", "other@invite.invalid")
	operator := session(tenant, "invitations-qa", "admin", "admin@invite.invalid")
	const invites = "/tenants/invitations-qa/team/invitations"
	const preview = "/auth/invitations/preview"
	const accept = "/auth/invitations/accept"
	call("POST", invites, owner, map[string]string{"role": "developer"}, 403)
	call("POST", invites, operator, map[string]string{"role": "accountant"}, 403)
	driver := row(`INSERT INTO drivers(tenant_id,full_name,phone_e164) VALUES($1,'Driver QA','+380670001234') RETURNING id::text`, tenant)
	created := call("POST", invites, owner, map[string]string{"role": "driver", "driverId": driver}, 201)
	token := created["token"].(string)
	if len(token) != 43 {
		t.Fatal("missing opaque link")
	}
	call("DELETE", "/tenants/invite-other/team/invitations/"+created["id"].(string), otherOwner, nil, 404)
	if data := call("POST", preview, "", map[string]string{"token": token}, 200); data["role"] != "driver" || data["company"] != "Invite QA" {
		t.Fatalf("preview %v", data)
	}
	const password = "qa-workspace-invite-password"
	const email = "driver@invite.invalid"
	input := map[string]string{"token": token, "email": email, "displayName": "QA Driver", "password": password, "phone": "+380670001999"}
	call("POST", accept, "", input, 409)
	if row(`SELECT count(*)::text FROM users WHERE email=$1`, email) != "0" {
		t.Fatal("failed acceptance did not roll back")
	}
	input["phone"] = "+380670001234"
	result := call("POST", accept, "", input, 201)
	if result["role"] != "driver" || result["tenantSlug"] != "invitations-qa" {
		t.Fatalf("wrong invite role or workspace %v", result)
	}
	me := call("GET", "/auth/me", result["sessionToken"].(string), nil, 200)
	if row(`SELECT membership_id::text FROM drivers WHERE id=$1`, driver) != me["membershipId"] {
		t.Fatal("driver profile was not linked")
	}
	call("POST", accept, "", input, 404)
	call("POST", preview, "", map[string]string{"token": token}, 404)
	list := call("GET", invites, owner, nil, 200)
	item := list["items"].([]any)[0].(map[string]any)
	if item["status"] != "accepted" || item["acceptedBy"] != "QA Driver" || item["token"] != nil {
		t.Fatalf("bad invitation history %v", item)
	}

	otherInvite := call("POST", "/tenants/invite-other/team/invitations", otherOwner, map[string]string{"role": "dispatcher"}, 201)
	input = map[string]string{"token": otherInvite["token"].(string), "email": email, "password": "wrong-password"}
	call("POST", accept, "", input, 401)
	input["password"] = password
	if data := call("POST", accept, "", input, 201); data["role"] != "dispatcher" || data["tenantSlug"] != "invite-other" {
		t.Fatalf("bad second workspace %v", data)
	}

	revoked := call("POST", invites, owner, map[string]string{"role": "accountant"}, 201)
	call("DELETE", invites+"/"+revoked["id"].(string), owner, nil, 204)
	call("POST", preview, "", map[string]any{"token": revoked["token"]}, 404)
	pending := call("POST", invites, owner, map[string]string{"role": "admin"}, 201)
	row(`UPDATE tenants SET subscription_through=DATE '2000-01-01' WHERE id=$1 RETURNING id::text`, tenant)
	call("POST", preview, "", map[string]any{"token": pending["token"]}, 404)
	call("POST", invites, owner, map[string]string{"role": "driver"}, 402)
	call("GET", invites, owner, nil, 200)
}
