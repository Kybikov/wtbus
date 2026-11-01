package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRouteFromTripPostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	row := func(q string, args ...any) string {
		t.Helper()
		var v string
		if err := db.QueryRow(ctx, q, args...).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	tenant := row(`INSERT INTO tenants(slug,name,subscription_status) VALUES('trip-route-qa','Trip Route','suspended') RETURNING id::text`)
	other := row(`INSERT INTO tenants(slug,name) VALUES('trip-route-other','Other') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('trip-route@test.invalid','Developer') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'developer') RETURNING id::text`, tenant, user)
	trip := row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency,pricing_mode,driver_pay_minor,navigation) VALUES($1,'individual','assigned','A','B',now()+interval '1 day',now()+interval '1 day 2 hours',8,12300,'EUR','per_passenger',5000,'{"start":[20,50],"end":[21,51],"coordinates":[[20,50],[21,51]],"distanceMeters":120000}') RETURNING id::text`, tenant)
	if _, err := db.Exec(ctx, `UPDATE trips SET navigation='{"start":[20,50],"end":[21,51],"coordinates":[[20,50],[21,51]],"distanceMeters":120000}' WHERE id=$1`, trip); err != nil {
		t.Fatal(err)
	}
	foreign := row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual','assigned','A','B',now()+interval '1 day',now()+interval '1 day 2 hours',8,'EUR') RETURNING id::text`, other)
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	defer cache.Close()
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	session, err := app.createSession(ctx, identity{UserID: user, MembershipID: member, TenantID: tenant, TenantSlug: "trip-route-qa", Role: "developer"})
	if err != nil {
		t.Fatal(err)
	}
	router := app.routes()
	call := func(id string, want int) string {
		t.Helper()
		r := httptest.NewRequest("POST", "/api/v1/tenants/trip-route-qa/trips/"+id+"/route", bytes.NewBufferString(`{"name":"A — B"}`))
		r.Header.Set("Authorization", "Bearer "+session.SessionToken)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("create route %d want %d: %s", w.Code, want, w.Body)
		}
		var result struct {
			RouteID string `json:"routeId"`
		}
		json.Unmarshal(w.Body.Bytes(), &result)
		return result.RouteID
	}
	call(foreign, 404)
	route := call(trip, 201)
	if route == "" || call(trip, 200) != route {
		t.Fatal("retry created duplicate route")
	}
	if got := row(`SELECT (t.kind='regular' AND t.route_id=r.id AND t.navigation=r.navigation AND r.default_price_minor=12300 AND r.default_pricing_mode='per_passenger' AND r.driver_pay_minor=5000)::text FROM trips t JOIN routes r ON r.id=t.route_id WHERE t.id=$1`, trip); got != "true" {
		t.Fatal("trip values/road not preserved")
	}
	if got := row(`SELECT count(*)::text FROM routes WHERE tenant_id=$1`, tenant); got != "1" {
		t.Fatal("duplicate routes")
	}
	// Production sales still require an active company, a future departure and per-passenger fare.
	if _, err := db.Exec(ctx, `UPDATE tenants SET subscription_status='active' WHERE id=$1`, tenant); err != nil {
		t.Fatal(err)
	}
	date := time.Now().UTC().Add(24 * time.Hour).Format("2006-01-02")
	r := httptest.NewRequest("GET", "/api/v1/public/trip-route-qa/trips?origin=A&destination=B&seats=1&date="+date, nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(trip)) {
		t.Fatalf("converted trip unavailable to customer: %d %s", w.Code, w.Body)
	}
	active := row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual','in_progress','A','B',now(),now()+interval '1 hour',8,'EUR') RETURNING id::text`, tenant)
	call(active, 409)
	if got := row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1 AND action IN ('route.created_from_trip','trip.route_created')`, tenant); got != "2" {
		t.Fatal("activity not attributed exactly once")
	}
}
