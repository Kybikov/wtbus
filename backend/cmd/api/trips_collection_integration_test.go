package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
)

func TestTripsCollectionPostgres(t *testing.T) {
	ctx := context.Background()
	db := deliveryTestDatabase(t)
	row := func(query string, args ...any) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, query, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	tenant := row(`INSERT INTO tenants(slug,name,timezone) VALUES('trips-qa','Trips QA','Europe/Warsaw') RETURNING id::text`)
	other := row(`INSERT INTO tenants(slug,name) VALUES('trips-other','Other') RETURNING id::text`)
	for _, starts := range []string{"2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z", "2026-10-24T22:00:00Z", "2026-10-25T22:59:59Z", "2026-10-25T23:00:00Z", "2035-01-01T00:00:00Z"} {
		row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual','new','Kyiv','Warsaw',$2::timestamptz,$2::timestamptz+interval '1 hour',17,'EUR') RETURNING id::text`, tenant, starts)
	}
	row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual','new','Private other tenant','Warsaw','2035-01-01','2035-01-02',17,'EUR') RETURNING id::text`, other)
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	call := func(query string, status int) []tripResponse {
		t.Helper()
		r := httptest.NewRequest("GET", "/api/v1/tenants/trips-qa/trips"+query, nil)
		r.SetPathValue("slug", "trips-qa")
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, identity{TenantID: tenant, TenantSlug: "trips-qa", Role: "owner"}))
		w := httptest.NewRecorder()
		app.listTrips(w, r)
		if w.Code != status {
			t.Fatalf("%s: status %d, body %s", query, w.Code, w.Body)
		}
		if status != 200 {
			return nil
		}
		var result struct {
			Items    []tripResponse `json:"items"`
			Timezone string         `json:"timezone"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Timezone != "Europe/Warsaw" {
			t.Fatal("company timezone lost")
		}
		for _, trip := range result.Items {
			if trip.Origin == "Private other tenant" {
				t.Fatal("foreign trip exposed")
			}
		}
		return result.Items
	}
	all := call("", 200)
	if len(all) != 6 {
		t.Fatalf("default collection should include all days, got %d trips", len(all))
	}
	for i := 1; i < len(all); i++ {
		if all[i].StartsAt.Before(all[i-1].StartsAt) || (all[i].StartsAt.Equal(all[i-1].StartsAt) && all[i].ID < all[i-1].ID) {
			t.Fatal("unstable trip ordering")
		}
	}
	if got := call("?date=2026-10-25", 200); len(got) != 2 {
		t.Fatalf("DST day must span 25 hours: got %d trips", len(got))
	}
	if got := call("?date=2026-10-26", 200); len(got) != 1 {
		t.Fatalf("exclusive day boundary lost: got %d trips", len(got))
	}
	if got := call("?date=2000-01-01", 200); len(got) != 0 {
		t.Fatal("empty date returned unrelated trips")
	}
	call("?date=2026-02-30", 400)
}
