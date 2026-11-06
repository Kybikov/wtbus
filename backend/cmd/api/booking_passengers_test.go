package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
)

func TestBookingPassengerManagement(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	app := &application{db: db, log: slog.New(slog.NewTextHandler(os.Stderr, nil))}
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
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('manifest-test','Manifest') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('manifest@test.invalid','Dispatcher') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'dispatcher') RETURNING id::text`, tenant, user)
	actor := identity{TenantID: tenant, TenantSlug: "manifest-test", MembershipID: member, Role: "dispatcher"}
	trip := row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency) VALUES($1,'regular','new','Kyiv','Warsaw',now()+interval '1 day',now()+interval '2 days',4,10000,'EUR') RETURNING id::text`, tenant)
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Alla Test','+380500000001') RETURNING id::text`, tenant)
	booking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,seats,status,price_minor,currency,source,custom_data) VALUES($1,$2,$3,1,'cash_on_boarding',10000,'EUR','dispatcher','{"passenger_birth_date":"1990-01-01"}') RETURNING id::text`, tenant, trip, customer)
	call := func(method string, body any, who identity) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/", bytes.NewReader(raw))
		r.SetPathValue("slug", actor.TenantSlug)
		r.SetPathValue("bookingID", booking)
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		app.bookingPassengers(w, r)
		return w
	}
	type result struct {
		Items     []managedPassenger `json:"items"`
		Seats     int                `json:"seats"`
		Available int                `json:"availableSeats"`
		Price     int64              `json:"priceMinor"`
	}
	read := func(w *httptest.ResponseRecorder) result {
		t.Helper()
		if w.Code != 200 {
			t.Fatalf("%d: %s", w.Code, w.Body)
		}
		var got result
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		return got
	}
	initial := read(call("GET", nil, actor))
	if len(initial.Items) != 1 || initial.Items[0].FirstName != "Alla" || initial.Items[0].Phone != "+380500000001" || initial.Available != 3 {
		t.Fatalf("legacy %+v", initial)
	}
	changed := read(call("PATCH", map[string]any{"fields": map[string]string{"0.firstName": "Алла", "0.phone": "+380500000002"}}, actor))
	if changed.Items[0].FirstName != "Алла" || changed.Items[0].BirthDate != "1990-01-01" {
		t.Fatalf("patch %+v", changed)
	}
	if w := call("PATCH", map[string]any{"fields": map[string]string{"0.birthDate": "2026-02-31"}}, actor); w.Code != 400 {
		t.Fatalf("bad date %d", w.Code)
	}
	wrong := actor
	wrong.TenantID = "00000000-0000-4000-8000-000000000001"
	if w := call("GET", nil, wrong); w.Code != 403 {
		t.Fatalf("tenant %d", w.Code)
	}
	wrong = actor
	wrong.Role = "driver"
	if w := call("PATCH", map[string]any{"fields": map[string]string{"0.firstName": "wrong"}}, wrong); w.Code != 403 {
		t.Fatalf("driver %d", w.Code)
	}
	exec(`INSERT INTO driver_booking_checkins(tenant_id,booking_id,cash_minor,boarding) VALUES($1,$2,10000,'{"0":"boarded"}')`, tenant, booking)
	added := read(call("POST", map[string]any{"expectedSeats": 1, "passenger": managedPassenger{FirstName: "Ivan", BirthDate: "2000-02-29"}}, actor))
	if added.Seats != 2 || added.Price != 20000 || added.Available != 2 || len(added.Items) != 2 {
		t.Fatalf("add %+v", added)
	}
	if w := call("POST", map[string]any{"expectedSeats": 1, "passenger": managedPassenger{FirstName: "Repeat"}}, actor); w.Code != 409 {
		t.Fatalf("stale %d", w.Code)
	}
	var cash int64
	var boarding string
	if err := db.QueryRow(ctx, `SELECT cash_minor,boarding->>'0' FROM driver_booking_checkins WHERE booking_id=$1`, booking).Scan(&cash, &boarding); err != nil || cash != 10000 || boarding != "boarded" {
		t.Fatalf("cash %d %s %v", cash, boarding, err)
	}
	// Only one contender may take the last seat, even from different bookings.
	secondCustomer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Other','+380500000003') RETURNING id::text`, tenant)
	other := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,seats,status,price_minor,currency,source) VALUES($1,$2,$3,1,'cash_on_boarding',10000,'EUR','dispatcher') RETURNING id::text`, tenant, trip, secondCustomer)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for _, id := range []string{booking, other} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			n := 1
			if id == booking {
				n = 2
			}
			raw, _ := json.Marshal(map[string]any{"expectedSeats": n, "passenger": managedPassenger{FirstName: "Last"}})
			r := httptest.NewRequest("POST", "/", bytes.NewReader(raw))
			r.SetPathValue("slug", actor.TenantSlug)
			r.SetPathValue("bookingID", id)
			r = r.WithContext(context.WithValue(ctx, identityContextKey{}, actor))
			w := httptest.NewRecorder()
			app.bookingPassengers(w, r)
			codes <- w.Code
		}(id)
	}
	wg.Wait()
	close(codes)
	success, conflict := 0, 0
	for code := range codes {
		if code == 200 {
			success++
		} else if code == 409 {
			conflict++
		} else {
			t.Fatalf("concurrent status %d", code)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("capacity results %d/%d", success, conflict)
	}
	// Expired holds and cancelled bookings do not reduce reported free seats.
	exec(`UPDATE bookings SET status='cancelled' WHERE id=$1`, other)
	exec(`INSERT INTO bookings(tenant_id,trip_id,customer_id,seats,status,price_minor,currency,source,payment_hold_expires_at) VALUES($1,$2,$3,1,'awaiting_payment',10000,'EUR','dispatcher',now()-interval '1 minute')`, tenant, trip, secondCustomer)
	r := httptest.NewRequest("GET", "/", nil)
	r.SetPathValue("slug", actor.TenantSlug)
	w := httptest.NewRecorder()
	app.listTrips(w, r)
	if w.Code != 200 {
		t.Fatalf("trips %d %s", w.Code, w.Body)
	}
	var list struct {
		Items []tripResponse `json:"items"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	current := read(call("GET", nil, actor))
	if len(list.Items) != 1 || list.Items[0].AvailableSeats != 4-current.Seats {
		t.Fatalf("available %+v current %+v", list, current)
	}
	if got := read(call("PATCH", map[string]any{"fields": map[string]string{"0.phone": ""}}, actor)); got.Items[0].Phone != "" {
		t.Fatal("phone not cleared")
	}
	if got := read(call("GET", nil, actor)); got.Items[0].Phone != "" {
		t.Fatal("phone restored from customer")
	}
	exec(`UPDATE trips SET pricing_mode='per_booking' WHERE id=$1`, trip)
	current = read(call("GET", nil, actor))
	next := read(call("POST", map[string]any{"expectedSeats": current.Seats, "passenger": managedPassenger{FirstName: "Fixed fare"}}, actor))
	if next.Price != current.Price {
		t.Fatal("per booking price changed")
	}
	var activities int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM activity_events WHERE entity_id=$1 AND actor_membership_id=$2 AND action='booking.passenger_added'`, booking, member).Scan(&activities); err != nil || activities < 2 {
		t.Fatalf("activity %d %v", activities, err)
	}
}
