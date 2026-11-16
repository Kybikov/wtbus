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

// Exercise real role middleware as well as capability checks. A trip manager is
// an accountant membership here, deliberately without a driver profile.
func TestTripCrewLifecycleRoutes(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	defer cache.Close()
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(q string, args ...any) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, q, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('crew-routes','Crew routes') RETURNING id::text`)
	makeActor := func(name, role string) identity {
		user := row(`INSERT INTO users(email,display_name) VALUES($1,$2) RETURNING id::text`, name+"@crew-route.invalid", name)
		member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) RETURNING id::text`, tenant, user, role)
		return identity{TenantID: tenant, TenantSlug: "crew-routes", MembershipID: member, UserID: user, Role: role}
	}
	owner := makeActor("owner", "owner")
	manager := makeActor("manager", "accountant")
	first := makeActor("first", "driver")
	second := makeActor("second", "driver")
	unassigned := makeActor("unassigned", "accountant")
	driver := row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'Driver','+380500002001') RETURNING id::text`, tenant, first.MembershipID)
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Bus','CREW-ROUTES','bus',8) RETURNING id::text`, tenant)
	trip := row(`INSERT INTO trips(tenant_id,vehicle_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency) VALUES($1,$2,$3,'regular','assigned','Kyiv','Berlin',now()-interval '10 minutes',now()+interval '2 hours',8,10000,'EUR') RETURNING id::text`, tenant, vehicle, driver)
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Passenger','+380500002002') RETURNING id::text`, tenant)
	booking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,price_minor,currency) VALUES($1,$2,$3,'confirmed',1,10000,'EUR') RETURNING id::text`, tenant, trip, customer)
	sessions := map[string]string{}
	for _, a := range []identity{owner, manager, first, second, unassigned} {
		s, err := app.createSession(ctx, a)
		if err != nil {
			t.Fatal(err)
		}
		sessions[a.MembershipID] = s.SessionToken
	}
	router := app.routes()
	base := "/api/v1/tenants/crew-routes"
	call := func(method, path string, body any, a identity, want int) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+sessions[a.MembershipID])
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s as %s: %d want%d %s", method, path, a.Role, w.Code, want, w.Body)
		}
		return w
	}
	crewPath := base + "/trips/" + trip + "/crew"
	call("PATCH", crewPath, map[string]any{"membershipId": manager.MembershipID, "role": "manager", "canManage": true, "canBoard": true, "canCollect": true}, owner, 200)
	call("PATCH", crewPath, map[string]any{"membershipId": second.MembershipID, "role": "driver", "canDrive": true, "canGPS": true}, owner, 200)
	call("GET", base+"/me/trips", nil, manager, 200)
	call("POST", base+"/driver/checkin", map[string]any{"tripId": trip, "bookingId": booking, "passengerIndex": 0, "boarding": "boarded"}, unassigned, 403)
	call("PATCH", base+"/trips/"+trip, map[string]any{"status": "boarding"}, unassigned, 403)
	call("PATCH", base+"/trips/"+trip, map[string]any{"status": "boarding"}, manager, 200)
	call("POST", base+"/driver/checkin", map[string]any{"tripId": trip, "bookingId": booking, "passengerIndex": 0, "boarding": "boarded"}, manager, 200)
	gps := map[string]any{"tripId": trip, "vehicleId": vehicle, "latitude": 50.45, "longitude": 30.52}
	call("POST", base+"/gps-points", gps, first, 403)
	call("POST", base+"/gps-points", gps, manager, 403)
	call("POST", base+"/gps-points", gps, second, 201)
	// Secondary drivers cannot board/depart two different trips at once.
	otherDriver := row(`INSERT INTO drivers(tenant_id,full_name,phone_e164) VALUES($1,'Other driver','+380500002009') RETURNING id::text`, tenant)
	otherVehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Other bus','CREW-OTHER','bus',8) RETURNING id::text`, tenant)
	otherTrip := row(`INSERT INTO trips(tenant_id,vehicle_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency) VALUES($1,$2,$3,'regular','assigned','Kyiv','Berlin',now()+interval '5 days',now()+interval '6 days',8,10000,'EUR') RETURNING id::text`, tenant, otherVehicle, otherDriver)
	otherCrew := base + "/trips/" + otherTrip + "/crew"
	call("PATCH", otherCrew, map[string]any{"membershipId": manager.MembershipID, "role": "manager", "canBoard": true}, owner, 200)
	call("PATCH", otherCrew, map[string]any{"membershipId": second.MembershipID, "role": "driver", "canDrive": true}, owner, 200)
	call("PATCH", base+"/trips/"+otherTrip, map[string]any{"status": "boarding"}, owner, 409)
	call("PATCH", otherCrew, map[string]any{"membershipId": second.MembershipID, "remove": true}, owner, 200)
	call("PATCH", base+"/trips/"+otherTrip, map[string]any{"status": "boarding"}, owner, 200)
	call("PATCH", otherCrew, map[string]any{"membershipId": second.MembershipID, "role": "driver", "canDrive": true}, owner, 409)
	call("PATCH", base+"/trips/"+trip, map[string]any{"status": "in_progress"}, manager, 200)
	call("PATCH", base+"/trips/"+trip, map[string]any{"status": "completed"}, manager, 200)
	if status := row(`SELECT status FROM bookings WHERE id=$1`, booking); status == "cancelled" {
		t.Fatalf("unpaid transported booking cancelled: %s", status)
	}
	call("POST", base+"/finance/workspace", map[string]any{"action": "receive", "requestId": row(`SELECT gen_random_uuid()::text`), "bookingId": booking, "amountMinor": 10000, "currency": "EUR"}, manager, 200)
	if settled := row(`SELECT coalesce(sum(settled_minor),0)::text FROM money_receipts WHERE booking_id=$1`, booking); settled != "10000" {
		t.Fatalf("late receipt did not settle: %s", settled)
	}
	call("POST", base+"/gps-points", gps, second, 409)
}
