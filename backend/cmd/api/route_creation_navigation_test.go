package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestRouteCreationStoresRoadAndDistanceAtomically(t *testing.T) {
	dsn := os.Getenv("GPS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires disposable GPS_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	slug := fmt.Sprintf("route-nav-%d", time.Now().UnixNano())
	var tenant string
	if err = db.QueryRow(ctx, `INSERT INTO tenants(slug,name) VALUES($1,'Route test') RETURNING id::text`, slug).Scan(&tenant); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	failed := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if failed {
			w.WriteHeader(503)
			return
		}
		fmt.Fprint(w, `{"code":"Ok","routes":[{"geometry":{"type":"LineString","coordinates":[[20,50],[20.02,50],[20.02,50.02]]}}]}`)
	}))
	defer server.Close()
	t.Setenv("ROUTING_SERVICE_URL", server.URL)
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	start, end := roadPoint{20, 50}, roadPoint{20.02, 50.02}
	nav := routeNavigation{Start: &start, End: &end, StartLabel: "Station A", EndLabel: "Station B", DistanceMeters: 1, Coordinates: []roadPoint{{0, 0}, {1, 1}}}
	request := func(handler http.HandlerFunc, method, route string, body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/", bytes.NewReader(raw))
		r.SetPathValue("slug", slug)
		r.SetPathValue("routeID", route)
		if method == "PUT" {
			r.SetPathValue("tripID", route)
		}
		r = r.WithContext(context.WithValue(r.Context(), identityContextKey{}, identity{TenantID: tenant, TenantSlug: slug, Role: "developer"}))
		w := httptest.NewRecorder()
		handler(w, r)
		return w
	}
	count := func() int {
		var n int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM routes WHERE tenant_id=$1`, tenant).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	w := request(app.previewRouteNavigation, "POST", "", nav)
	if w.Code != 200 || count() != 0 {
		t.Fatalf("preview persisted or failed: %d %s", w.Code, w.Body)
	}
	input := routeInput{Name: "A-B", Origin: "A", Destination: "B", Currency: "EUR", DefaultPriceMinor: 5000, DriverPayMinor: 1000, Navigation: &nav, DistanceKM: 1, Status: "active", TariffMode: "per_km", VehicleClassRates: map[string]int64{"bus": 100}}
	w = request(app.createRoute, "POST", "", input)
	if w.Code != 201 {
		t.Fatalf("create %d %s", w.Code, w.Body)
	}
	var response struct {
		Item routeResponse `json:"item"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	id := response.Item.ID
	var raw []byte
	var distance float64
	if err = db.QueryRow(ctx, `SELECT navigation,distance_km::float8 FROM routes WHERE id=$1`, id).Scan(&raw, &distance); err != nil {
		t.Fatal(err)
	}
	var stored routeNavigation
	json.Unmarshal(raw, &stored)
	expected := math.Round(roadLength([]roadPoint{start, {20.02, 50}, end})/10) / 100
	if len(stored.Coordinates) != 3 || distance != expected || stored.DistanceMeters < 3000 || stored.StartLabel != "Station A" {
		t.Fatalf("road/distance spoofed or lost: %s %v expected%v", raw, distance, expected)
	}
	// Changing road points must also repair the pricing distance, not just the map.
	db.Exec(ctx, `UPDATE routes SET distance_km=999 WHERE id=$1`, id)
	w = request(app.routeNavigation, "PATCH", id, map[string]any{"start": start, "end": end})
	if w.Code != 200 {
		t.Fatalf("edit %d %s", w.Code, w.Body)
	}
	db.QueryRow(ctx, `SELECT distance_km::float8 FROM routes WHERE id=$1`, id).Scan(&distance)
	if distance != expected {
		t.Fatalf("distance out of sync %v", distance)
	}
	t.Run("default driver and per-trip overrides", func(t *testing.T) {
		users := []string{}
		defer func() {
			for _, id := range users {
				db.Exec(ctx, `DELETE FROM users WHERE id=$1`, id)
			}
		}()
		newDriver := func(name string) string {
			var user, member, driver string
			if err := db.QueryRow(ctx, `INSERT INTO users(email,display_name) VALUES($1,$2) RETURNING id::text`, slug+name+"@test.invalid", name).Scan(&user); err != nil {
				t.Fatal(err)
			}
			users = append(users, user)
			if err := db.QueryRow(ctx, `INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'driver') RETURNING id::text`, tenant, user).Scan(&member); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow(ctx, `INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,$3,$4) RETURNING id::text`, tenant, member, name, "+"+fmt.Sprint(len(users))).Scan(&driver); err != nil {
				t.Fatal(err)
			}
			return driver
		}
		defaultDriver, replacement := newDriver("Default"), newDriver("Replacement")
		if !app.validateRouteDefaultDriver(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil), tenant, &defaultDriver) {
			t.Fatal("connected driver rejected")
		}
		var foreignTenant, foreignDriver string
		if err := db.QueryRow(ctx, `INSERT INTO tenants(slug,name) VALUES($1,'Foreign') RETURNING id::text`, slug+"-foreign").Scan(&foreignTenant); err != nil {
			t.Fatal(err)
		}
		defer db.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, foreignTenant)
		if err := db.QueryRow(ctx, `INSERT INTO drivers(tenant_id,full_name,phone_e164) VALUES($1,'Foreign','+100') RETURNING id::text`, foreignTenant).Scan(&foreignDriver); err != nil {
			t.Fatal(err)
		}
		if app.validateRouteDefaultDriver(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil), tenant, &foreignDriver) {
			t.Fatal("foreign driver accepted")
		}
		if _, err := db.Exec(ctx, `UPDATE routes SET default_driver_id=$2 WHERE id=$1`, id, foreignDriver); err == nil {
			t.Fatal("database allowed cross-company default driver")
		}
		var vehicle string
		if err := db.QueryRow(ctx, `INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Bus','LOCAL','bus',8) RETURNING id::text`, tenant).Scan(&vehicle); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(ctx, `UPDATE routes SET default_driver_id=$2 WHERE id=$1`, id, defaultDriver); err != nil {
			t.Fatal(err)
		}
		endOverride := roadPoint{20.02, 50.025}
		tripInput := createTripRequest{Kind: "regular", RouteID: id, VehicleID: vehicle, Origin: "Custom origin", Destination: "Custom destination", StartsAt: "2027-02-01T10:00", EndsAt: "2027-02-01T12:00", PriceMinor: 5000, Navigation: &routeNavigation{Start: &start, End: &endOverride, StartLabel: "Trip pickup", EndLabel: "Trip dropoff"}}
		for i, driver := range []string{"", replacement} {
			tripInput.DriverID = driver
			tripInput.StartsAt = fmt.Sprintf("2027-02-%02dT10:00", i+1)
			tripInput.EndsAt = fmt.Sprintf("2027-02-%02dT12:00", i+1)
			w := request(app.createTrip, "POST", "", tripInput)
			if w.Code != 201 {
				t.Fatalf("trip %d %s", w.Code, w.Body)
			}
			var created struct {
				Item tripResponse `json:"item"`
			}
			json.Unmarshal(w.Body.Bytes(), &created)
			var recorded int
			if err := db.QueryRow(ctx, `SELECT count(*) FROM activity_events WHERE tenant_id=$1 AND entity_id=$2 AND action='record_created' AND details->'changes' @> '[{"field":"driver_id"}]'::jsonb`, tenant, created.Item.ID).Scan(&recorded); err != nil || recorded != 1 {
				t.Fatalf("trip creation journal missing %d %v", recorded, err)
			}
			if i == 0 {
				edit := tripInput
				edit.DriverID = defaultDriver
				edit.Origin = "Kyiv"
				edit.Destination = "Berlin"
				edit.Navigation = nil
				seats := int16(6)
				pay := int64(12345)
				edit.Capacity = &seats
				edit.DriverPayMinor = &pay
				update := request(app.updateTrip, "PUT", created.Item.ID, edit)
				if update.Code != 200 {
					t.Fatalf("inline fields update: %d %s", update.Code, update.Body)
				}
				var capacity int16
				var salary int64
				var city string
				db.QueryRow(ctx, `SELECT capacity,driver_pay_minor,origin_name FROM trips WHERE id=$1`, created.Item.ID).Scan(&capacity, &salary, &city)
				if capacity != 6 || salary != 12345 || city != "Kyiv" {
					t.Fatalf("field edits ignored %d %d %s", capacity, salary, city)
				}
				seats = 9
				over := request(app.updateTrip, "PUT", created.Item.ID, edit)
				if over.Code != 409 {
					t.Fatalf("over-capacity accepted: %d %s", over.Code, over.Body)
				}
				var customer string
				if err := db.QueryRow(ctx, `INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Capacity QA','+123455501') RETURNING id::text`, tenant).Scan(&customer); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec(ctx, `INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,currency) VALUES($1,$2,$3,'cash_on_boarding',2,'EUR')`, tenant, created.Item.ID, customer); err != nil {
					t.Fatal(err)
				}
				seats = 1
				if tooSmall := request(app.updateTrip, "PUT", created.Item.ID, edit); tooSmall.Code != 409 {
					t.Fatalf("occupied seats lost: %d %s", tooSmall.Code, tooSmall.Body)
				}
				edit.Currency = "PLN"
				seats = 6
				if changedCurrency := request(app.updateTrip, "PUT", created.Item.ID, edit); changedCurrency.Code != 409 {
					t.Fatalf("existing booking currency changed: %d %s", changedCurrency.Code, changedCurrency.Body)
				}
				edit.Currency = ""
				// Restore the direction for the existing per-trip override assertions.
				edit.Origin = tripInput.Origin
				edit.Destination = tripInput.Destination
				seats = 6
				if restored := request(app.updateTrip, "PUT", created.Item.ID, edit); restored.Code != 200 {
					t.Fatal(restored.Code, restored.Body)
				}
			}

			var selected, origin, endLabel string
			if err := db.QueryRow(ctx, `SELECT driver_id::text,origin_name,navigation->>'endLabel' FROM trips WHERE id=$1`, created.Item.ID).Scan(&selected, &origin, &endLabel); err != nil {
				t.Fatal(err)
			}
			expected := driver
			if expected == "" {
				expected = defaultDriver
			}
			if selected != expected || origin != "Custom origin" || endLabel != "Trip dropoff" {
				t.Fatalf("trip defaults/override lost %s %s %s", selected, origin, endLabel)
			}
		}
		var routeEnd, routeDriver string
		db.QueryRow(ctx, `SELECT navigation->>'endLabel',default_driver_id::text FROM routes WHERE id=$1`, id).Scan(&routeEnd, &routeDriver)
		if routeEnd != "Station B" || routeDriver != defaultDriver {
			t.Fatal("trip rewrote reusable route")
		}
		tripInput.DriverID = ""
		tripInput.StartsAt = "2027-02-15T10:00"
		tripInput.EndsAt = "2027-02-15T12:00"
		series := createTripScheduleRequest{createTripRequest: tripInput, Frequency: "monthly", Interval: 1, MonthDay: 15, RepeatUntil: "2027-04-15"}
		w := request(app.createTripSchedule, "POST", "", series)
		if w.Code != 201 {
			t.Fatalf("monthly schedule %d %s", w.Code, w.Body)
		}
		var schedule tripScheduleResponse
		json.Unmarshal(w.Body.Bytes(), &schedule)
		if schedule.CreatedCount != 3 {
			t.Fatalf("monthly count %+v", schedule)
		}
		var inherited int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM trips WHERE tenant_id=$1 AND starts_at>='2027-02-10' AND driver_id=$2 AND origin_name='Custom origin' AND navigation->>'endLabel'='Trip dropoff'`, tenant, defaultDriver).Scan(&inherited); err != nil || inherited != 3 {
			t.Fatalf("schedule lost defaults %d %v", inherited, err)
		}
		var before, after int
		db.QueryRow(ctx, `SELECT count(*) FROM trips WHERE tenant_id=$1`, tenant).Scan(&before)
		series.Frequency = "daily"
		series.StartsAt = "2027-01-31T10:00"
		series.EndsAt = "2027-01-31T12:00"
		series.RepeatUntil = "2027-02-02"
		w = request(app.createTripSchedule, "POST", "", series)
		db.QueryRow(ctx, `SELECT count(*) FROM trips WHERE tenant_id=$1`, tenant).Scan(&after)
		if w.Code != 409 || after != before {
			t.Fatalf("conflicting series partially saved: %d before%d after%d %s", w.Code, before, after, w.Body)
		}
		// Delete only fixtures introduced here; keep the outer route assertions alive.
		db.Exec(ctx, `DELETE FROM trips WHERE tenant_id=$1`, tenant)
		db.Exec(ctx, `UPDATE routes SET default_driver_id=NULL WHERE id=$1`, id)
		db.Exec(ctx, `DELETE FROM vehicles WHERE id=$1`, vehicle)
		db.Exec(ctx, `DELETE FROM drivers WHERE tenant_id=$1`, tenant)
		db.Exec(ctx, `DELETE FROM memberships WHERE tenant_id=$1`, tenant)
		for _, user := range users {
			db.Exec(ctx, `DELETE FROM users WHERE id=$1`, user)
		}
		users = nil
	})
	failed = true
	w = request(app.createRoute, "POST", "", input)
	if w.Code != 422 || count() != 1 {
		t.Fatalf("failed road partially inserted: %d %s", w.Code, w.Body)
	}
	input.Navigation = &routeNavigation{Start: &start}
	w = request(app.createRoute, "POST", "", input)
	if w.Code != 422 || count() != 1 {
		t.Fatal("partial endpoints created route")
	}
}
