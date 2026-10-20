package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestActivityPostgres(t *testing.T) {
	ctx := context.Background()
	db := deliveryTestDatabase(t)
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	defer cache.Close()
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(sql string, args ...any) string {
		t.Helper()
		var value string
		if err := db.QueryRow(ctx, sql, args...).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	tenant := row(`INSERT INTO tenants(slug,name)VALUES('audit-qa','Audit')RETURNING id::text`)
	foreign := row(`INSERT INTO tenants(slug,name)VALUES('audit-other','Other')RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name)VALUES('audit@test.invalid','Auditor')RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role)VALUES($1,$2,'owner')RETURNING id::text`, tenant, user)
	session, err := app.createSession(ctx, identity{UserID: user, MembershipID: member, TenantID: tenant, TenantSlug: "audit-qa", Role: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	handler := app.routes()
	request := func(method, path string, payload any) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(payload)
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+session.SessionToken)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	w := request("POST", "/api/v1/tenants/audit-qa/customers", map[string]any{"fullName": "Before", "phone": "+380501234567"})
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
	var customer map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &customer)
	id, _ := customer["id"].(string)
	if id == "" {
		if item, ok := customer["item"].(map[string]any); ok {
			id, _ = item["id"].(string)
		}
	}
	if id == "" {
		t.Fatal("missing record id", w.Body)
	}
	w = request("PATCH", "/api/v1/tenants/audit-qa/customers/"+id, map[string]any{"fullName": "After", "phone": "+380501234567"})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	fields := row(`SELECT details->'changedFields' FROM activity_events WHERE tenant_id=$1 AND entity_id=$2 AND action='record_updated' ORDER BY id DESC LIMIT 1`, tenant, id)
	if fields != `["full_name"]` {
		t.Fatal("inexact field diff", fields)
	}
	if row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1 AND actor_membership_id=$2 AND entity_id=$3`, tenant, member, id) != "2" {
		t.Fatal("missing attributed create or update")
	}
	if row(`SELECT details->'changes'->0->>'before' FROM activity_events WHERE tenant_id=$1 AND entity_id=$2 AND action='record_updated' ORDER BY id DESC LIMIT 1`, tenant, id) != "Before" || row(`SELECT details->'changes'->0->>'after' FROM activity_events WHERE tenant_id=$1 AND entity_id=$2 AND action='record_updated' ORDER BY id DESC LIMIT 1`, tenant, id) != "After" {
		t.Fatal("committed before/after values missing")
	}
	w = request("GET", "/api/v1/tenants/audit-qa/entity-details/customers/"+id, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"before":"Before"`) || !strings.Contains(w.Body.String(), `"actorId":"`+member+`"`) {
		t.Fatal("detail history missing transitions or actor identity", w.Code, w.Body)
	}
	w = request("PATCH", "/api/v1/tenants/audit-qa/customers/"+id, map[string]any{"fullName": "After", "phone": "+380501234567"})
	if w.Code != 200 || row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1 AND entity_id=$2`, tenant, id) != "2" {
		t.Fatal("successful no-op duplicated timeline entry", w.Code, w.Body)
	}
	routeID := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,status,currency) VALUES($1,'Audit route','Киев','Львов','active','EUR') RETURNING id::text`, tenant)
	w = request("PATCH", "/api/v1/tenants/audit-qa/routes/"+routeID, map[string]any{"name": "Audit route", "origin": "Киев", "destination": "Львов", "currency": "EUR", "defaultPriceMinor": 1200, "defaultPricingMode": "per_passenger", "status": "inactive", "tariffMode": "fixed", "distanceKm": 100})
	if w.Code != 200 {
		t.Fatal("route transition failed", w.Code, w.Body)
	}
	var stored []auditFieldChange
	if json.Unmarshal([]byte(row(`SELECT details->'changes' FROM activity_events WHERE tenant_id=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 1`, tenant, routeID)), &stored) != nil {
		t.Fatal("missing route transition")
	}
	foundStatus := false
	for _, change := range stored {
		if change.Field == "status" {
			foundStatus = change.Before == "active" && change.After == "inactive" && change.BeforeLabel != "" && change.AfterLabel != "" && change.BeforeTone == "success"
		}
	}
	if !foundStatus {
		t.Fatal("status labels or historical tones missing", stored)
	}
	request("GET", "/api/v1/tenants/audit-qa/customers?q=private-query", nil)
	if row(`SELECT route FROM api_request_logs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, tenant) != "GET /api/v1/tenants/{slug}/customers" {
		t.Fatal("request log retained a raw URL")
	}
	w = request("PATCH", "/api/v1/tenants/audit-qa/integration-secrets", map[string]string{"monobankToken": "sensitive-token-not-for-logs"})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	if row(`SELECT count(*)::text FROM activity_events WHERE details::text LIKE '%sensitive-token-not-for-logs%'`) != "0" {
		t.Fatal("secret leaked into audit")
	}
	before := row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1`, tenant)
	w = request("PATCH", "/api/v1/tenants/audit-qa/customers/"+id, map[string]any{"phone": "invalid"})
	if w.Code < 400 {
		t.Fatal("invalid mutation accepted")
	}
	if row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1`, tenant) != before {
		t.Fatal("failed request recorded as successful activity")
	}
	if row(`SELECT status::text FROM api_request_logs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, tenant) != "400" {
		t.Fatal("failed request not retained")
	}
	row(`INSERT INTO activity_events(tenant_id,actor_kind,action,entity_type)VALUES($1,'system','foreign_action','customer')RETURNING id::text`, foreign)
	w = request("GET", "/api/v1/tenants/audit-qa/activity", nil)
	if w.Code != 200 || strings.Contains(w.Body.String(), "foreign_action") {
		t.Fatal("history tenant isolation", w.Code, w.Body)
	}
	w = request("GET", "/api/v1/tenants/audit-other/activity", nil)
	if w.Code != 403 {
		t.Fatal("cross-tenant history allowed", w.Code)
	}
	for i := 0; i < 55; i++ {
		row(`INSERT INTO activity_events(tenant_id,actor_kind,action,entity_type)VALUES($1,'system','page_test','routes')RETURNING id::text`, tenant)
	}
	w = request("GET", "/api/v1/tenants/audit-qa/activity", nil)
	var page struct {
		Items []struct {
			ID string `json:"id"`
		}
		HasMore bool `json:"hasMore"`
	}
	if json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 50 || !page.HasMore {
		t.Fatal("pagination", w.Body)
	}
	w = request("GET", "/api/v1/tenants/audit-qa/activity?before="+page.Items[49].ID, nil)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	_, _ = db.Exec(ctx, `UPDATE memberships SET role='admin' WHERE id=$1`, member)
	w = request("GET", "/api/v1/tenants/audit-qa/activity?kind=requests", nil)
	if w.Code != http.StatusForbidden {
		t.Fatal("admin exposed request diagnostics", w.Code)
	}
}
