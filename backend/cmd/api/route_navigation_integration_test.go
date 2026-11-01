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
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRoadNavigationPostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
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
	company := row(`INSERT INTO tenants(slug,name) VALUES('road-test','Road') RETURNING id::text`)
	other := row(`INSERT INTO tenants(slug,name) VALUES('road-other','Other') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('road@test.invalid','Road') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'developer') RETURNING id::text`, company, user)
	route := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency,distance_km) VALUES($1,'Road','A','B','EUR',123) RETURNING id::text`, company)
	foreign := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency) VALUES($1,'Other','A','B','EUR') RETURNING id::text`, other)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"code":"Ok","routes":[{"geometry":{"type":"LineString","coordinates":[[20,50],[20.02,50],[20.02,50.02]]}}]}`)
	}))
	defer server.Close()
	t.Setenv("ROUTING_SERVICE_URL", server.URL)
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	defer cache.Close()
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	session, err := app.createSession(ctx, identity{UserID: user, MembershipID: member, TenantID: company, TenantSlug: "road-test", Role: "developer"})
	if err != nil {
		t.Fatal(err)
	}
	handler := app.routes()
	request := func(method, id string, body any, collection ...string) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		entity := "routes"
		if len(collection) > 0 {
			entity = collection[0]
		}
		r := httptest.NewRequest(method, "/api/v1/tenants/road-test/"+entity+"/"+id+"/navigation", bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+session.SessionToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := request("GET", route, nil); w.Code != 200 {
		t.Fatalf("read %d %s", w.Code, w.Body)
	}
	if w := request("PATCH", foreign, map[string]any{"start": []int{20, 50}}); w.Code != 404 {
		t.Fatalf("tenant isolation %d %s", w.Code, w.Body)
	}
	if w := request("PATCH", route, map[string]any{"start": []int{20, 50, 1}}); w.Code != 400 {
		t.Fatalf("invalid coordinate %d", w.Code)
	}
	if w := request("PATCH", route, map[string]any{"start": []int{20, 50}, "end": []float64{20.02, 50.02}, "startLabel": "Krakow station", "endLabel": "Lviv station"}); w.Code != 200 {
		t.Fatalf("save %d %s", w.Code, w.Body)
	}
	if got := row(`SELECT navigation->>'startLabel' FROM routes WHERE id=$1`, route); got != "Krakow station" {
		t.Fatal("place name not retained", got)
	}
	// Older clients must preserve names for unchanged coordinates.
	if w := request("PATCH", route, map[string]any{"start": []int{20, 50}, "end": []float64{20.02, 50.02}}); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if got := row(`SELECT navigation->>'startLabel' FROM routes WHERE id=$1`, route); got != "Krakow station" {
		t.Fatal("legacy client erased name", got)
	}
	exec(`UPDATE routes SET navigation='{"start":[10,40],"startLabel":"Foreign private station"}'::jsonb WHERE id=$1`, foreign)
	placesRequest := httptest.NewRequest("GET", "/api/v1/tenants/road-test/navigation-places", nil)
	placesRequest.Header.Set("Authorization", "Bearer "+session.SessionToken)
	placesResponse := httptest.NewRecorder()
	handler.ServeHTTP(placesResponse, placesRequest)
	var places struct {
		Items []navigationPlace `json:"items"`
	}
	if err := json.Unmarshal(placesResponse.Body.Bytes(), &places); err != nil || placesResponse.Code != 200 || len(places.Items) != 2 {
		t.Fatalf("saved places %d %s", placesResponse.Code, placesResponse.Body)
	}
	for _, place := range places.Items {
		if strings.Contains(place.Label, "Foreign") {
			t.Fatal("cross-company place exposed")
		}
	}
	if got := row(`SELECT (distance_km=round((navigation->>'distanceMeters')::numeric/1000,2))::text FROM routes WHERE id=$1`, route); got != "true" {
		t.Fatal("tariff distance does not match the road", got)
	}
	trip := row(`INSERT INTO trips(tenant_id,route_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,'regular','assigned','A','B',now(),now()+interval '2 hours',8,'EUR') RETURNING id::text`, company, route)
	before := row(`SELECT navigation::text FROM trips WHERE id=$1`, trip)
	if before == "" || before == "null" {
		t.Fatal("missing snapshot")
	}
	exec(`UPDATE trips SET status='in_progress' WHERE id=$1`, trip)
	// Ordinary edits do not erase points. Route reconfiguration cannot move an active trip.
	exec(`UPDATE routes SET name='Renamed',navigation=jsonb_set(navigation,'{distanceMeters}','9999') WHERE id=$1`, route)
	if got := row(`SELECT navigation::text FROM trips WHERE id=$1`, trip); got != before {
		t.Fatal("active trip route changed")
	}
	next := row(`INSERT INTO trips(tenant_id,route_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,'regular','assigned','A','B',now()+interval '1 day',now()+interval '1 day 2 hours',8,'EUR') RETURNING id::text`, company, route)
	exec(`UPDATE routes SET navigation=jsonb_set(navigation,'{distanceMeters}','8888') WHERE id=$1`, route)
	if got := row(`SELECT navigation->>'distanceMeters' FROM trips WHERE id=$1`, next); got != "9999" {
		t.Fatal("existing trip was overwritten by route defaults", got)
	}
	virgin := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency) VALUES($1,'Virgin','A','B','EUR') RETURNING id::text`, company)
	seedTrip := row(`INSERT INTO trips(tenant_id,route_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,'regular','assigned','A','B',now()+interval '2 days',now()+interval '2 days 2 hours',8,'EUR') RETURNING id::text`, company, virgin)
	if w := request("PATCH", seedTrip, map[string]any{"start": []int{20, 50}, "end": []float64{20.02, 50.02}}, "trips"); w.Code != 200 {
		t.Fatalf("trip points %d %s", w.Code, w.Body)
	}
	seed := row(`SELECT navigation::text FROM trips WHERE id=$1`, seedTrip)
	if got := row(`SELECT navigation::text FROM routes WHERE id=$1`, virgin); got != seed {
		t.Fatal("route did not inherit first trip points")
	}
	if got := row(`SELECT (distance_km>0 AND distance_km=round((navigation->>'distanceMeters')::numeric/1000,2))::text FROM routes WHERE id=$1`, virgin); got != "true" {
		t.Fatal("inherited route lost road distance", got)
	}
	exec(`UPDATE routes SET navigation=jsonb_set(navigation,'{distanceMeters}','5555') WHERE id=$1`, virgin)
	if got := row(`SELECT navigation::text FROM trips WHERE id=$1`, seedTrip); got != seed {
		t.Fatal("route override changed originating trip")
	}
	if w := request("PATCH", seedTrip, map[string]any{"start": []int{20, 50}, "end": []float64{20.02, 50.02}}, "trips"); w.Code != 200 {
		t.Fatalf("trip point edit %d %s", w.Code, w.Body)
	}
	if got := row(`SELECT navigation->>'distanceMeters' FROM routes WHERE id=$1`, virgin); got != "5555" {
		t.Fatal("trip overwrote customized route")
	}
	// Fleet must not use a GPS point from another trip sharing the vehicle.
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Road bus','ROAD-1','bus',8) RETURNING id::text`, company)
	exec(`UPDATE trips SET vehicle_id=$1 WHERE id=$2`, vehicle, trip)
	exec(`INSERT INTO gps_points(tenant_id,vehicle_id,trip_id,recorded_at,latitude,longitude,accuracy_meters) VALUES($1,$2,$3,now(),50,20.02,10)`, company, vehicle, next)
	r := httptest.NewRequest("GET", "/api/v1/tenants/road-test/fleet", nil)
	r.Header.Set("Authorization", "Bearer "+session.SessionToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	var fleet struct {
		Items []fleetVehicleResponse `json:"items"`
	}
	if json.Unmarshal(w.Body.Bytes(), &fleet) != nil || w.Code != 200 || len(fleet.Items) != 1 {
		t.Fatalf("fleet %d %s", w.Code, w.Body)
	}
	if fleet.Items[0].ActiveTrip.Progress.Status != "no_gps" {
		t.Fatalf("foreign trip GPS used: %+v", fleet.Items[0])
	}
	exec(`INSERT INTO gps_points(tenant_id,vehicle_id,trip_id,recorded_at,latitude,longitude,accuracy_meters) VALUES($1,$2,$3,now(),50,20.02,10)`, company, vehicle, trip)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if json.Unmarshal(w.Body.Bytes(), &fleet) != nil || w.Code != 200 {
		t.Fatalf("fleet %d %s", w.Code, w.Body)
	}
	if fleet.Items[0].ActiveTrip.Progress.Percent == nil {
		t.Fatal("missing road progress", w.Body)
	}
	// Driver cannot edit road endpoints, even with an active trip.
	exec(`UPDATE memberships SET role='driver' WHERE id=$1`, member)
	if w := request("PATCH", route, map[string]any{"start": []int{20, 50}}); w.Code != 403 {
		t.Fatalf("driver edit allowed %d %s", w.Code, w.Body)
	}
	// A rolling deployment before migration 48 must keep the existing fleet usable.
	exec(`UPDATE memberships SET role='developer' WHERE id=$1`, member)
	exec(`ALTER TABLE trips DROP COLUMN navigation CASCADE; ALTER TABLE routes DROP COLUMN navigation CASCADE`)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("legacy schema fleet %d %s", w.Code, w.Body)
	}
	if w := request("GET", route, nil); w.Code != 503 {
		t.Fatalf("missing schema not explained %d %s", w.Code, w.Body)
	}
}
