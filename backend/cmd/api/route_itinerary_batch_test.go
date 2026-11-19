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
)

func TestItineraryBatchKeepsTripPickupAndDropoff(t *testing.T) {
	start, waypoint, end := roadPoint{30, 50}, roadPoint{29, 50}, roadPoint{28, 50}
	routeRoad := routeNavigation{Start: &start, End: &end, Via: []roadPoint{waypoint},
		Coordinates: []roadPoint{start, waypoint, end}, DistanceMeters: 1000}
	template := tripItinerary{Stops: []itineraryStop{{City: "Stop", Address: "Station", Minutes: 30, Point: &waypoint}}}
	trip := itineraryBatchTrip{Origin: "First", Destination: "Last", Currency: "UAH", Kind: "regular", Pricing: "per_passenger", Duration: 90}
	tripRoad := routeNavigation{Start: &start, End: &end, StartLabel: "Trip pickup", EndLabel: "Trip dropoff"}
	trip.Navigation, _ = json.Marshal(tripRoad)
	next, reason := itineraryBatchDecision(trip, template, tripItinerary{}, routeRoad, "First", "Last", "UAH")
	var updated routeNavigation
	if reason != "" || json.Unmarshal(next, &updated) != nil || updated.StartLabel != tripRoad.StartLabel ||
		updated.EndLabel != tripRoad.EndLabel || len(updated.Via) != 1 || updated.Via[0] != waypoint {
		t.Fatalf("trip pickup/dropoff was not preserved: %+v (%s)", updated, reason)
	}
	customPickup := roadPoint{31, 50}
	tripRoad.Start = &customPickup
	trip.Navigation, _ = json.Marshal(tripRoad)
	if _, reason = itineraryBatchDecision(trip, template, tripItinerary{}, routeRoad, "First", "Last", "UAH"); reason != "navigation" {
		t.Fatalf("trip with a different pickup was allowed to reuse the template road: %s", reason)
	}
}

func TestApplyItineraryAndCompanyIsolation(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	t.Cleanup(func() { cache.Close() })
	app := &application{db: db, redis: cache, saasControlSecret: "local-test-control", log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	handler := app.routes()
	call := func(method, path, token string, input any, want int) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(input)
		r := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(body))
		r.Header.Set("X-SaaS-Control-Token", app.saasControlSecret)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, want, w.Body)
		}
		return w
	}
	const email, password = "tenant-batch@example.invalid", "workspaces-fixture-only"
	for _, slug := range []string{"batch-company-a", "batch-company-b"} {
		call("POST", "/control/tenants", "", provisionTenantRequest{
			Slug: slug, Name: slug, Timezone: "UTC", BaseCurrency: "UAH", SubscriptionStatus: "active",
			OwnerEmail: email, OwnerPassword: password, OwnerDisplayName: "Shared user",
		}, 201)
	}
	login := func(slug string) string {
		t.Helper()
		var login loginResponse
		w := call("POST", "/auth/login", "", loginRequest{Email: email, Password: password}, 200)
		if err := json.Unmarshal(w.Body.Bytes(), &login); err != nil || len(login.Companies) != 2 || !login.RequiresCompanySelection {
			t.Fatalf("workspace selection: %s", w.Body)
		}
		w = call("POST", "/auth/select-company", "", selectCompanyRequest{SelectionToken: login.SelectionToken, TenantSlug: slug}, 200)
		var selected loginResponse
		if err := json.Unmarshal(w.Body.Bytes(), &selected); err != nil || selected.SessionToken == "" {
			t.Fatal("company session missing")
		}
		return selected.SessionToken
	}
	a, b := login("batch-company-a"), login("batch-company-b")
	row := func(query string, args ...any) string {
		t.Helper()
		var out string
		if err := db.QueryRow(ctx, query, args...).Scan(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	companyA := row("SELECT id::text FROM tenants WHERE slug='batch-company-a'")
	companyB := row("SELECT id::text FROM tenants WHERE slug='batch-company-b'")
	address := func(company, name string) string {
		return row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,$2,'+380500004012') RETURNING id::text`, company, name)
	}
	customerA, customerB := address(companyA, "Only Company A"), address(companyB, "Only Company B")
	aPath, bPath := "/tenants/batch-company-a", "/tenants/batch-company-b"
	for _, tc := range []struct{ path, token, own, foreign string }{{aPath, a, customerA, customerB}, {bPath, b, customerB, customerA}} {
		got := call("GET", tc.path+"/customers", tc.token, nil, 200).Body.String()
		if !strings.Contains(got, tc.own) || strings.Contains(got, tc.foreign) {
			t.Fatal("customer lists are not isolated")
		}
		call("GET", tc.path+"/finance/workspace", tc.token, nil, 200)
	}
	call("GET", bPath+"/customers", a, nil, 403)

	route := func(company string) string {
		return row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency,is_active)
			VALUES($1,'Kyiv – Lviv','Kyiv','Lviv','UAH',true) RETURNING id::text`, company)
	}
	routeA, routeB := route(companyA), route(companyB)
	template := tripItinerary{Stops: []itineraryStop{{City: "Zhytomyr", Address: "New station", Minutes: 120}},
		Fares: []itineraryFare{{From: 0, To: 1, Price: 30000}}}
	wrong := tripItinerary{Stops: []itineraryStop{{City: "Zhytomyr", Address: "Original station", Minutes: 120}}}
	canonical, _ := json.Marshal(template)
	current, _ := json.Marshal(wrong)
	start := time.Now().UTC().Add(48 * time.Hour)
	addTrip := func(company, routeID, status string, starts time.Time, duration time.Duration, current []byte) string {
		t.Helper()
		id := row(`INSERT INTO trips(tenant_id,route_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency,pricing_mode)
			VALUES($1,$2,'regular',$3,'Kyiv','Lviv',$4,$5,2,99000,'UAH','per_passenger') RETURNING id::text`, company, routeID, status, starts, starts.Add(duration))
		if current != nil {
			if _, err := db.Exec(ctx, `UPDATE trips SET itinerary=$2 WHERE id=$1`, id, current); err != nil {
				t.Fatal(err)
			}
		}
		return id
	}
	full := addTrip(companyA, routeA, "assigned", start, 6*time.Hour, nil)
	compatible := addTrip(companyA, routeA, "assigned", start, 6*time.Hour, canonical)
	locked := addTrip(companyA, routeA, "assigned", start, 6*time.Hour, current)
	short := addTrip(companyA, routeA, "assigned", start, time.Hour, nil)
	already := addTrip(companyA, routeA, "assigned", start, 6*time.Hour, canonical)
	boarded := addTrip(companyA, routeA, "boarding", start, 6*time.Hour, nil)
	past := addTrip(companyA, routeA, "assigned", start.Add(-96*time.Hour), 6*time.Hour, nil)
	foreign := addTrip(companyB, routeB, "assigned", start, 6*time.Hour, nil)
	booking := func(trip string, partial bool) string {
		t.Helper()
		return row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,price_minor,currency,segment_from,segment_to,segment_pickup,segment_dropoff)
			VALUES($1,$2,$3,'cash_on_boarding',1,92000,'UAH',CASE WHEN $4 THEN 0 END,CASE WHEN $4 THEN 1 END,'Pickup','Fixed dropoff')
			RETURNING id::text`, companyA, trip, customerA, partial)
	}
	fullBooking, partialBooking := booking(full, false), booking(compatible, true)
	newPrice := template
	newPrice.Fares = []itineraryFare{{From: 0, To: 1, Price: 35000}}
	call("PATCH", aPath+"/routes/"+routeA+"/itinerary", a, newPrice, 200)
	newRaw, _ := json.Marshal(newPrice)
	if _, err := db.Exec(ctx, `UPDATE trips SET itinerary=$2 WHERE id=$1`, already, newRaw); err != nil {
		t.Fatal(err)
	}
	path := aPath + "/routes/" + routeA + "/itinerary/apply"
	preview := func() routeItineraryBatch {
		t.Helper()
		var data routeItineraryBatch
		w := call("GET", path, a, nil, 200)
		if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	old := preview()
	if old.Ready != 3 || old.Unchanged != 1 || old.Skipped["schedule"] != 1 {
		t.Fatalf("unexpected preview %+v", old)
	}
	booking(locked, true)
	call("POST", path, a, map[string]string{"token": old.Token}, 409)
	if got := row(`SELECT jsonb_array_length(itinerary->'stops')::text FROM trips WHERE id=$1`, full); got != "0" {
		t.Fatal("stale preview partially applied")
	}
	plan := preview()
	if plan.Ready != 2 || plan.Unchanged != 1 || plan.Skipped["bookings"] != 1 {
		t.Fatalf("unexpected refreshed preview %+v", plan)
	}
	call("POST", bPath+"/routes/"+routeA+"/itinerary/apply", b, map[string]string{"token": plan.Token}, 404)
	call("POST", path, b, map[string]string{"token": plan.Token}, 403)
	call("POST", path, a, map[string]string{"token": plan.Token}, 200)
	for _, id := range []string{full, compatible, already} {
		if got := row(`SELECT itinerary->'fares'->0->>'priceMinor' FROM trips WHERE id=$1`, id); got != "35000" {
			t.Fatal("fare not copied", id, got)
		}
		if got := row(`SELECT price_minor::text FROM trips WHERE id=$1`, id); got != "99000" {
			t.Fatal("whole-trip price was changed")
		}
	}
	for _, id := range []string{short, boarded, past, foreign} {
		if got := row(`SELECT jsonb_array_length(itinerary->'stops')::text FROM trips WHERE id=$1`, id); got != "0" {
			t.Fatal("ineligible trip was changed")
		}
	}
	for _, id := range []string{fullBooking, partialBooking} {
		if got := row(`SELECT price_minor::text || ':' || segment_dropoff FROM bookings WHERE id=$1`, id); got != "92000:Fixed dropoff" {
			t.Fatal("booking was changed")
		}
	}
	if got := row(`SELECT itinerary->'stops'->0->>'address' FROM trips WHERE id=$1`, locked); got != "Original station" {
		t.Fatal("booked stop was overwritten")
	}
	if got := row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1 AND entity_type='trips' AND details->>'routeId'=$2 AND actor_membership_id IS NOT NULL`, companyA, routeA); got != "2" {
		t.Fatal("expected both updates to be attributed")
	}
	otherTemplate := template
	otherTemplate.Fares = []itineraryFare{{From: 0, To: 1, Price: 49000}}
	call("PATCH", bPath+"/routes/"+routeB+"/itinerary", b, otherTemplate, 200)
	otherPath := bPath + "/routes/" + routeB + "/itinerary/apply"
	var other routeItineraryBatch
	w := call("GET", otherPath, b, nil, 200)
	if err := json.Unmarshal(w.Body.Bytes(), &other); err != nil || other.Ready != 1 {
		t.Fatal("second company preview", w.Body)
	}
	call("POST", otherPath, b, map[string]string{"token": other.Token}, 200)
	if got := row(`SELECT itinerary->'fares'->0->>'priceMinor' FROM trips WHERE id=$1`, foreign); got != "49000" {
		t.Fatal("company B fare not copied")
	}
	if got := row(`SELECT itinerary->'fares'->0->>'priceMinor' FROM trips WHERE id=$1`, full); got != "35000" {
		t.Fatal("company B changed company A fares")
	}
}
