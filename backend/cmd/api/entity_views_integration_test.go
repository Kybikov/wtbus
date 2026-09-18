package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestEntityViewsDatabasePrivacyAndCRUD(t *testing.T) {
	url := os.Getenv("ENTITY_VIEWS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set disposable migrated ENTITY_VIEWS_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	slug := fmt.Sprintf("views-test-%d", time.Now().UnixNano())
	var company, otherCompany string
	users := []string{}
	row := func(query string, dst *string, args ...any) {
		t.Helper()
		if err := db.QueryRow(ctx, query, args...).Scan(dst); err != nil {
			t.Fatal(err)
		}
	}
	row(`INSERT INTO tenants(slug,name) VALUES($1,'Views test') RETURNING id::text`, &company, slug)
	row(`INSERT INTO tenants(slug,name) VALUES($1,'Other views test') RETURNING id::text`, &otherCompany, slug+"-other")
	defer func() {
		db.Exec(ctx, `DELETE FROM tenants WHERE id=ANY($1::uuid[])`, []string{company, otherCompany})
		for _, id := range users {
			db.Exec(ctx, `DELETE FROM users WHERE id=$1`, id)
		}
	}()
	actor := func(n string, tenantID, role string) identity {
		var user, member string
		row(`INSERT INTO users(email,display_name) VALUES($1,'Views user') RETURNING id::text`, &user, slug+n+"@test.invalid")
		users = append(users, user)
		row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) RETURNING id::text`, &member, tenantID, user, role)
		return identity{MembershipID: member, TenantID: tenantID, Role: role}
	}
	author := actor("author", company, "dispatcher")
	reader := actor("reader", company, "dispatcher")
	manager := actor("manager", company, "developer")
	outsider := actor("outside", otherCompany, "developer")
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	request := func(method, entity, id string, body any, who identity, expected int) *httptest.ResponseRecorder {
		t.Helper()
		encoded, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/?entity="+entity+"&id="+id, bytes.NewReader(encoded))
		targetSlug := slug
		if who.TenantID == otherCompany {
			targetSlug += "-other"
		}
		r.SetPathValue("slug", targetSlug)
		r = r.WithContext(context.WithValue(r.Context(), identityContextKey{}, who))
		w := httptest.NewRecorder()
		app.entityViews(w, r)
		if w.Code != expected {
			t.Fatalf("%s %s expected %d got %d: %s", method, entity, expected, w.Code, w.Body)
		}
		return w
	}
	input := entityViewInput{Name: "My view", Visibility: "private", Config: entityViewConfig{Mode: "list", Columns: []string{"name"}, Filters: map[string]string{"telegram": "linked"}, Metrics: []entityViewMetric{{Field: "trips", Operation: "sum"}, {Field: "telegram", Operation: "filled"}}}}
	decode := func(w *httptest.ResponseRecorder) savedEntityView {
		t.Helper()
		var payload struct{ Item savedEntityView }
		if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Item
	}
	private := decode(request("POST", "customers", "", input, author, 201))
	if len(private.Config.Metrics) != 2 || private.Config.Metrics[0].Operation != "sum" {
		t.Fatal("created metrics not preserved")
	}
	for _, who := range []identity{reader, manager, outsider} {
		w := request("GET", "customers", "", nil, who, 200)
		var payload struct{ Items []savedEntityView }
		json.Unmarshal(w.Body.Bytes(), &payload)
		if len(payload.Items) != 0 {
			t.Fatal("private view leaked")
		}
		request("DELETE", "customers", private.ID, nil, who, 404)
	}
	request("POST", "customers", "", input, author, 409)
	input.Name = "Team view"
	input.Visibility = "shared"
	shared := decode(request("POST", "customers", "", input, author, 201))
	w := request("GET", "customers", "", nil, reader, 200)
	var list struct{ Items []savedEntityView }
	json.Unmarshal(w.Body.Bytes(), &list)
	if len(list.Items) != 1 || list.Items[0].CanEdit || list.Items[0].Config.Mode != "list" {
		t.Fatal("shared roundtrip/permissions wrong")
	}
	if len(list.Items[0].Config.Metrics) != 2 || list.Items[0].Config.Metrics[1].Field != "telegram" {
		t.Fatal("shared metric settings not persisted")
	}
	input.Version = shared.Version
	input.Config.Mode = "gallery"
	request("PATCH", "customers", shared.ID, input, reader, 403)
	request("DELETE", "customers", shared.ID, nil, reader, 403)
	request("PATCH", "customers", shared.ID, input, outsider, 404)
	updated := decode(request("PATCH", "customers", shared.ID, input, manager, 200))
	if updated.Version != 2 {
		t.Fatal("version not incremented")
	}
	request("PATCH", "customers", shared.ID, input, author, 409)
	input.Version = 2
	input.Visibility = "private"
	request("PATCH", "customers", shared.ID, input, manager, 409)
	request("GET", "team", "", nil, author, 403)
	request("GET", "team", "", nil, manager, 200)
	request("DELETE", "customers", shared.ID, nil, manager, 200)
	request("DELETE", "customers", private.ID, nil, author, 200)
}
