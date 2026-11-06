package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTripEditingDatabase(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(query string, args ...any) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, query, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('trip-edit-qa','Trip editing QA') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('trip-owner@test.invalid','Owner') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner') RETURNING id::text`, tenant, user)
	oldDriver := row(`INSERT INTO drivers(tenant_id,full_name,phone_e164,is_active) VALUES($1,'Retired profile','+100',false) RETURNING id::text`, tenant)
	driverUser := row(`INSERT INTO users(email,display_name) VALUES('trip-driver@test.invalid','Active driver') RETURNING id::text`)
	driverMember := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'driver') RETURNING id::text`, tenant, driverUser)
	driver := row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'Active driver','+101') RETURNING id::text`, tenant, driverMember)
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'QA Volkswagen','TRIP-EDIT','bus',8) RETURNING id::text`, tenant)
	exec(`INSERT INTO workflow_statuses(tenant_id,entity_type,key,label,semantic_phase,is_terminal) VALUES
		($1,'trips','qa_wait','Custom waiting','assigned',false),
		($1,'trips','qa_closed','Custom final','assigned',true)`, tenant)
	actor := identity{TenantID: tenant, TenantSlug: "trip-edit-qa", UserID: user, MembershipID: member, Role: "owner"}
	call := func(method, trip string, body any, role string) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/", bytes.NewReader(raw))
		r.SetPathValue("slug", actor.TenantSlug)
		r.SetPathValue("tripID", trip)
		r.SetPathValue("entity", "trips")
		r.SetPathValue("recordID", trip)
		who := actor
		who.Role = role
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		if method == "GET" {
			app.entityDetails(w, r)
		} else if method == "POST" {
			app.createTrip(w, r)
		} else {
			app.updateTrip(w, r)
		}
		return w
	}
	cases := []struct {
		status, role string
		allowed      bool
	}{
		{"new", "owner", true}, {"assigned", "dispatcher", true},
		{"boarding", "owner", true}, {"assigned", "owner", true},
		{"qa_wait", "admin", true}, {"qa_closed", "owner", false},
		{"in_progress", "owner", false},
		{"completed", "owner", false}, {"cancelled", "dispatcher", false},
		{"completed", "developer", true},
	}
	var delayedTrip string
	var delayedInput createTripRequest
	var newTrip string
	var newInput createTripRequest
	for index, tc := range cases {
		t.Run(tc.status+"/"+tc.role, func(t *testing.T) {
			start := fmt.Sprintf("2035-02-%02dT10:00", index+1)
			end := fmt.Sprintf("2035-02-%02dT12:00", index+1)
			trip := row(`INSERT INTO trips(tenant_id,vehicle_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,$3,'individual',$4,'A','B',$5::timestamp AT TIME ZONE 'Europe/Kyiv',$6::timestamp AT TIME ZONE 'Europe/Kyiv',8,'EUR') RETURNING id::text`, tenant, vehicle, oldDriver, tc.status, start, end)
			input := createTripRequest{VehicleID: vehicle, DriverID: oldDriver, Kind: "individual", Origin: "A", Destination: "B", StartsAt: start, EndsAt: end, PricingMode: "per_passenger"}
			detail := call("GET", trip, nil, tc.role)
			if detail.Code != 200 {
				t.Fatal(detail.Code, detail.Body)
			}
			var payload struct{ EditRestriction string }
			if err := json.Unmarshal(detail.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if (payload.EditRestriction == "") != tc.allowed {
				t.Fatalf("wrong plus availability: %s", detail.Body)
			}
			updated := call("PUT", trip, input, tc.role)
			if tc.allowed && updated.Code != 200 || !tc.allowed && updated.Code != 409 {
				t.Fatalf("update: %d %s", updated.Code, updated.Body)
			}
			if tc.status == "boarding" {
				delayedTrip, delayedInput = trip, input
			}
			if tc.status == "new" {
				newTrip, newInput = trip, input
			}
		})
	}
	t.Run("fix seats while retaining retired driver then replace driver", func(t *testing.T) {
		exec(`UPDATE trips SET capacity=9 WHERE id=$1`, delayedTrip)
		seats := int16(8)
		input := delayedInput
		input.Capacity = &seats
		if w := call("PUT", delayedTrip, input, "owner"); w.Code != 200 {
			t.Fatalf("retired driver blocked seat correction: %d %s", w.Code, w.Body)
		}
		input.DriverID = driver
		if w := call("PUT", delayedTrip, input, "owner"); w.Code != 200 {
			t.Fatalf("active replacement failed: %d %s", w.Code, w.Body)
		}
		input.DriverID = oldDriver
		if w := call("PUT", delayedTrip, input, "owner"); w.Code != 400 || !strings.Contains(w.Body.String(), "активного водителя") {
			t.Fatalf("retired driver was offered for reassignment: %d %s", w.Code, w.Body)
		}
		input.DriverID = driver
		exec(`UPDATE memberships SET is_active=false WHERE id=$1`, driverMember)
		exec(`UPDATE vehicles SET is_active=false WHERE id=$1`, vehicle)
		seats = 7
		if w := call("PUT", delayedTrip, input, "owner"); w.Code != 200 {
			t.Fatalf("unchanged account status blocked edit: %d %s", w.Code, w.Body)
		}
		// The unchanged relation is retained even after its account is disabled.
		if got := row(`SELECT driver_id::text FROM trips WHERE id=$1`, delayedTrip); got != driver {
			t.Fatal("driver changed unexpectedly")
		}
		replacement := newInput
		replacement.DriverID = driver
		if w := call("PUT", newTrip, replacement, "owner"); w.Code != 400 {
			t.Fatalf("disabled account accepted for new assignment: %d %s", w.Code, w.Body)
		}
		otherTenant := row(`INSERT INTO tenants(slug,name) VALUES('trip-edit-other','Other company') RETURNING id::text`)
		otherUser := row(`INSERT INTO users(email,display_name) VALUES('other-driver@test.invalid','Other driver') RETURNING id::text`)
		otherMember := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'driver') RETURNING id::text`, otherTenant, otherUser)
		otherDriver := row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'Other driver','+103') RETURNING id::text`, otherTenant, otherMember)
		replacement.DriverID = otherDriver
		if w := call("PUT", newTrip, replacement, "owner"); w.Code != 400 {
			t.Fatalf("cross-company driver accepted: %d %s", w.Code, w.Body)
		}
	})
	t.Run("capacity errors distinguish vehicle limit from occupied seats", func(t *testing.T) {
		input := delayedInput
		input.DriverID = driver
		seats := int16(9)
		input.Capacity = &seats
		if w := call("PUT", delayedTrip, input, "owner"); w.Code != 409 || !strings.Contains(w.Body.String(), "QA Volkswagen") || !strings.Contains(w.Body.String(), "9 мест") || !strings.Contains(w.Body.String(), "— 8") {
			t.Fatalf("missing vehicle capacity explanation: %d %s", w.Code, w.Body)
		}
		customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Capacity test','+102') RETURNING id::text`, tenant)
		exec(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,currency) VALUES($1,$2,$3,'cash_on_boarding',2,'EUR')`, tenant, delayedTrip, customer)
		seats = 1
		if w := call("PUT", delayedTrip, input, "owner"); w.Code != 409 || !strings.Contains(w.Body.String(), "Занято мест по бронированиям: 2") {
			t.Fatalf("missing occupied seat explanation: %d %s", w.Code, w.Body)
		}
		if got := row(`SELECT capacity::text FROM trips WHERE id=$1`, delayedTrip); got != "7" {
			t.Fatal("failed validation changed capacity")
		}
	})
	t.Run("vehicle replacement inherits capacity and rejects undersized replacement atomically", func(t *testing.T) {
		input := delayedInput
		input.DriverID = driver
		stale := int16(99)
		input.Capacity = &stale
		small := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Small car','CAP-SMALL','car',1) RETURNING id::text`, tenant)
		large := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Large bus','CAP-LARGE','bus',12) RETURNING id::text`, tenant)
		input.VehicleID = small
		if w := call("PUT", delayedTrip, input, "owner"); w.Code != 409 {
			t.Fatal("oversold replacement accepted", w.Code, w.Body)
		}
		if got := row(`SELECT vehicle_id::text||':'||capacity FROM trips WHERE id=$1`, delayedTrip); got != vehicle+":7" {
			t.Fatal("failed replacement changed trip", got)
		}
		input.VehicleID = large
		if w := call("PUT", delayedTrip, input, "owner"); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		if got := row(`SELECT capacity::text FROM trips WHERE id=$1`, delayedTrip); got != "12" {
			t.Fatal("vehicle capacity was not inherited", got)
		}
		// Correct a legacy snapshot using the unchanged vehicle on the next save.
		exec(`UPDATE trips SET capacity=13 WHERE id=$1`, delayedTrip)
		stale = 13
		if w := call("PUT", delayedTrip, input, "owner"); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		if got := row(`SELECT capacity::text FROM trips WHERE id=$1`, delayedTrip); got != "12" {
			t.Fatal("legacy capacity not corrected")
		}
		exec(`UPDATE memberships SET is_active=true WHERE id=$1`, driverMember)
		input.StartsAt = "2035-03-01T10:00"
		input.EndsAt = "2035-03-01T12:00"
		created := call("POST", "", input, "owner")
		if created.Code != 201 {
			t.Fatal(created.Code, created.Body)
		}
		var response struct{ Item tripResponse }
		if err := json.Unmarshal(created.Body.Bytes(), &response); err != nil || response.Item.Capacity != 12 {
			t.Fatal("creation default is not vehicle capacity", created.Body, err)
		}
	})
}
