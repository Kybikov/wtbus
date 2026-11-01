package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEntityDetailsBeforeNumberingMigrationPostgres(t *testing.T) {
	ctx := context.Background()
	migrated := deliveryTestDatabase(t)
	var schema string
	if err := migrated.QueryRow(ctx, `SELECT current_schema()`).Scan(&schema); err != nil {
		t.Fatal(err)
	}
	// Exclude public so another test database's registry cannot satisfy the lookup.
	config := migrated.Config()
	config.ConnConfig.RuntimeParams["search_path"] = pgx.Identifier{schema}.Sanitize()
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	exec := func(query string) {
		t.Helper()
		if _, err := db.Exec(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	row := func(query string, args ...any) string {
		t.Helper()
		var value string
		if err := db.QueryRow(ctx, query, args...).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('details-before-numbering','Detail test') RETURNING id::text`)
	other := row(`INSERT INTO tenants(slug,name) VALUES('other-before-numbering','Other company') RETURNING id::text`)
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Existing customer','+380501234567') RETURNING id::text`, tenant)
	outsider := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Private customer','+380501234568') RETURNING id::text`, other)
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	call := func(id, role, tenantID string, status int) map[string]any {
		t.Helper()
		r := httptest.NewRequest("GET", "/", nil)
		r.SetPathValue("slug", "details-before-numbering")
		r.SetPathValue("entity", "customers")
		r.SetPathValue("recordID", id)
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, identity{TenantID: tenantID, Role: role}))
		w := httptest.NewRecorder()
		app.entityDetails(w, r)
		if w.Code != status {
			t.Fatalf("expected %d, got %d: %s", status, w.Code, w.Body)
		}
		var payload struct{ Item map[string]any }
		if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Item
	}
	if item := call(customer, "developer", tenant, 200); item["record_number"] != "CL-00001" {
		t.Fatalf("number missing before compatibility check: %v", item)
	}
	exec(`ALTER TABLE record_numbers RENAME TO numbering_not_deployed`)
	item := call(customer, "developer", tenant, 200)
	if item["id"] != customer || item["full_name"] != "Existing customer" || item["record_number"] != nil {
		t.Fatalf("existing record did not survive absent numbering: %v", item)
	}
	if _, exposed := item["tenant_id"]; exposed {
		t.Fatal("tenant metadata exposed")
	}
	call(customer, "dispatcher", tenant, 200)
	call(outsider, "developer", tenant, 404)
	call(customer, "developer", other, 403)
	call(customer, "driver", tenant, 403)
	call("00000000-0000-0000-0000-000000000000", "developer", tenant, 404)
	// Other missing business tables must not be mistaken for missing numbering.
	exec(`ALTER TABLE customers RENAME TO customers_unavailable`)
	call(customer, "developer", tenant, 503)
	exec(`ALTER TABLE customers_unavailable RENAME TO customers`)
	exec(`ALTER TABLE numbering_not_deployed RENAME TO record_numbers`)
	if item := call(customer, "developer", tenant, 200); item["record_number"] != "CL-00001" {
		t.Fatalf("number did not recover after migration: %v", item)
	}
}
