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
)

func TestTripBoardingAndEarlyDeparturePostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(q string, args ...any) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, q, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('boarding-qa','Boarding QA') RETURNING id::text`)
	makeMember := func(role, email string) identity {
		user := row(`INSERT INTO users(email,display_name) VALUES($1,$2) RETURNING id::text`, email, role)
		member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) RETURNING id::text`, tenant, user, role)
		return identity{TenantID: tenant, TenantSlug: "boarding-qa", UserID: user, MembershipID: member, Role: role}
	}
	staff := makeMember("dispatcher", "boarding-staff@test.invalid")
	driverActor := makeMember("driver", "boarding-driver@test.invalid")
	driver := row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'QA Driver','+201') RETURNING id::text`, tenant, driverActor.MembershipID)
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'QA Bus','BOARDING','bus',8) RETURNING id::text`, tenant)
	trip := row(`INSERT INTO trips(tenant_id,vehicle_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,$3,'individual','assigned','A','B',now()+interval '1 hour',now()+interval '3 hours',8,'EUR') RETURNING id::text`, tenant, vehicle, driver)
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'QA Passenger','+202') RETURNING id::text`, tenant)
	booking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,currency) VALUES($1,$2,$3,'cash_on_boarding',2,'EUR') RETURNING id::text`, tenant, trip, customer)

	status := func(who identity, input changeTripStatusRequest) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(input)
		r := httptest.NewRequest("PATCH", "/", bytes.NewReader(raw))
		r.SetPathValue("slug", who.TenantSlug)
		r.SetPathValue("tripID", trip)
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		app.changeTripStatus(w, r)
		return w
	}
	checkin := func(index int, value string) {
		t.Helper()
		raw, _ := json.Marshal(driverCheckinRequest{TripID: trip, BookingID: booking, PassengerIndex: &index, Boarding: value})
		r := httptest.NewRequest("POST", "/", bytes.NewReader(raw))
		r.SetPathValue("slug", driverActor.TenantSlug)
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, driverActor))
		w := httptest.NewRecorder()
		app.driverCheckin(w, r)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
	}
	getOps := func() *tripOperations {
		t.Helper()
		all, err := readTripOperations(ctx, db, tenant, []string{trip})
		if err != nil {
			t.Fatal(err)
		}
		return all[trip]
	}
	approve := func() {
		t.Helper()
		if w := status(staff, changeTripStatusRequest{Action: "approve_early_departure"}); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
	}
	t.Run("driver can start boarding early without recording departure", func(t *testing.T) {
		if w := status(driverActor, changeTripStatusRequest{Status: "boarding"}); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		if op := getOps(); op.BoardingStartedAt == nil || op.DepartedAt != nil || !op.BeforeDeparture {
			t.Fatal("boarding was conflated with departure")
		}
		started := row(`SELECT actual_boarding_started_at::text FROM trips WHERE id=$1`, trip)
		if w := status(driverActor, changeTripStatusRequest{Status: "boarding"}); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		if row(`SELECT actual_boarding_started_at::text FROM trips WHERE id=$1`, trip) != started {
			t.Fatal("retry changed actual boarding time")
		}
	})
	t.Run("early departure requires every passenger, not just resolved attendance", func(t *testing.T) {
		for _, arrival := range []string{"waiting", "absent"} {
			if arrival != "waiting" {
				checkin(1, arrival)
			}
			checkin(0, "boarded")
			w := status(driverActor, changeTripStatusRequest{Status: "in_progress"})
			if w.Code != 409 || !strings.Contains(w.Body.String(), "До времени отправления") {
				t.Fatal("early departure bypass", w.Code, w.Body)
			}
		}
		if w := status(driverActor, changeTripStatusRequest{Action: "approve_early_departure"}); w.Code != 403 {
			t.Fatal("driver approved own early departure", w.Code)
		}
	})
	t.Run("dispatcher approval is idempotent and bound to bookings and plan", func(t *testing.T) {
		approve()
		approve()
		if !getOps().EarlyDepartureApproved {
			t.Fatal("approval missing")
		}
		if n := row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1 AND action='trip.early_departure_approved'`, tenant); n != "1" {
			t.Fatal("approval retry duplicated audit", n)
		}
		exec(`UPDATE trips SET starts_at=starts_at+interval '1 minute' WHERE id=$1`, trip)
		exec(`UPDATE trips SET starts_at=starts_at-interval '1 minute' WHERE id=$1`, trip)
		if getOps().EarlyDepartureApproved {
			t.Fatal("plan change and reversal preserved stale approval")
		}
		approve()
		exec(`UPDATE bookings SET updated_at=now()+interval '1 millisecond' WHERE id=$1`, booking)
		if getOps().EarlyDepartureApproved {
			t.Fatal("booking change preserved stale approval")
		}
		approve()
		if w := status(driverActor, changeTripStatusRequest{Status: "in_progress"}); w.Code != 200 {
			t.Fatal("approved departure failed", w.Code, w.Body)
		}
		op := getOps()
		if op.DepartedAt == nil || op.EarlyDepartureApproved {
			t.Fatal("actual departure not recorded")
		}
		departed := *op.DepartedAt
		if w := status(driverActor, changeTripStatusRequest{Status: "in_progress"}); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		if !getOps().DepartedAt.Equal(departed) {
			t.Fatal("retry changed actual departure")
		}
	})
	t.Run("all boarded allows early departure without approval", func(t *testing.T) {
		exec(`UPDATE trips SET status='assigned',actual_started_at=NULL,early_departure_approved_at=NULL,early_departure_approved_by=NULL,early_departure_approval_key=NULL WHERE id=$1`, trip)
		checkin(1, "boarded")
		if !getOps().AllPassengersBoarded {
			t.Fatal("all boarded not detected")
		}
		if w := status(driverActor, changeTripStatusRequest{Status: "in_progress"}); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
	})
	t.Run("late first arrival starts boarding and delay stays separate", func(t *testing.T) {
		exec(`UPDATE trips SET status='assigned',starts_at=now()-interval '30 minutes',actual_started_at=NULL,actual_boarding_started_at=NULL WHERE id=$1`, trip)
		checkin(0, "boarded")
		if got := row(`SELECT status FROM trips WHERE id=$1`, trip); got != "boarding" {
			t.Fatal("late boarding not started", got)
		}
		if op := getOps(); !op.DepartureDelayed || op.BoardingStartedAt == nil || op.DepartedAt != nil {
			t.Fatal("late boarding metadata incorrect")
		}
		for range 2 {
			getOps()
		}
		if got := row(`SELECT status FROM trips WHERE id=$1`, trip); got != "boarding" {
			t.Fatal("clock replaced boarding stage")
		}
	})
	t.Run("departure rejects a vehicle that no longer fits booked passengers", func(t *testing.T) {
		exec(`UPDATE vehicles SET capacity=1 WHERE id=$1`, vehicle)
		w := status(driverActor, changeTripStatusRequest{Status: "in_progress"})
		if w.Code != 409 || !strings.Contains(w.Body.String(), "вместимость автомобиля: 1") {
			t.Fatal("over-capacity departure accepted", w.Code, w.Body)
		}
		if getOps().DepartedAt != nil {
			t.Fatal("rejected departure recorded actual time")
		}
	})

}
