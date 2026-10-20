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
	"net/url"
	"strings"
	"testing"
)

func TestDeveloperDeletionPostgres(t *testing.T) {
	ctx := context.Background()
	db := deliveryTestDatabase(t)
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
	company := row(`INSERT INTO tenants(slug,name,subscription_status) VALUES('deletion-qa','Delete QA','suspended') RETURNING id::text`)
	other := row(`INSERT INTO tenants(slug,name) VALUES('deletion-other','Other') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('delete@test.invalid','Developer') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'developer') RETURNING id::text`, company, user)
	actor := identity{TenantID: company, TenantSlug: "deletion-qa", MembershipID: member, Role: "developer"}
	request := func(method, entity, id string, body any, who identity, status int) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, fmt.Sprintf("/api/v1/tenants/deletion-qa/entity-details/%s/%s/deletion", url.PathEscape(entity), id), bytes.NewReader(raw))
		r.Header.Set("Content-Type", "application/json")
		r.SetPathValue("slug", "deletion-qa")
		r.SetPathValue("entity", entity)
		r.SetPathValue("recordID", id)
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		app.requestAudit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { app.beginAudit(r, who); app.entityDeletion(w, r) })).ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s want %d got %d %s", method, entity, status, w.Code, w.Body)
		}
		return w
	}
	preview := func(entity, id string) deletionPreview {
		t.Helper()
		var p deletionPreview
		w := request("GET", entity, id, nil, actor, 200)
		if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
			t.Fatal(err)
		}
		if len(p.Token) != 64 || len(p.Effects) == 0 {
			t.Fatal("missing preview")
		}
		return p
	}
	remove := func(entity, id string) {
		t.Helper()
		p := preview(entity, id)
		request("DELETE", entity, id, map[string]string{"token": p.Token}, actor, 200)
		request("GET", entity, id, nil, actor, 404)
	}
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Delete passenger','+380501234567') RETURNING id::text`, company)
	foreign := row(`INSERT INTO customers(tenant_id,phone_e164) VALUES($1,'+380501234568') RETURNING id::text`, other)
	for _, role := range []string{"owner", "admin", "dispatcher", "driver"} {
		who := actor
		who.Role = role
		request("GET", "customers", customer, nil, who, 403)
		request("DELETE", "customers", customer, nil, who, 403)
	}
	request("GET", "customers", foreign, nil, actor, 404)
	outside := actor
	outside.TenantID = other
	request("DELETE", "customers", customer, nil, outside, 403)
	request("GET", "payments;DROP TABLE customers", customer, nil, actor, 404)
	request("DELETE", "customers", customer, nil, actor, 400)
	stale := preview("customers", customer)
	exec(`UPDATE customers SET full_name='Changed after preview' WHERE id=$1`, customer)
	request("DELETE", "customers", customer, map[string]string{"token": stale.Token}, actor, 409)

	// Full access also applies to inactive subscriptions, without granting other roles a bypass.
	for _, role := range []string{"developer", "owner", "dispatcher"} {
		who := actor
		who.Role = role
		called := false
		r := httptest.NewRequest("POST", "/", nil)
		r.SetPathValue("slug", "deletion-qa")
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		app.requireActiveSubscription(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(204) })(w, r)
		if called != (role == "developer") {
			t.Fatalf("subscription bypass role %s", role)
		}
	}

	makeTrip := func(status string) string {
		return row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual',$2,'Kyiv','Warsaw',now()+interval '1 day',now()+interval '2 days',17,'EUR') RETURNING id::text`, company, status)
	}
	makeBooking := func(trip, customer string) string {
		return row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,currency) VALUES($1,$2,$3,'confirmed',2,'EUR') RETURNING id::text`, company, trip, customer)
	}
	makePayment := func(booking string) string {
		return row(`INSERT INTO payments(tenant_id,booking_id,provider,status,amount_minor,currency,idempotency_key,provider_payload) VALUES($1,$2::uuid,'internal','paid',1000,'EUR',$2::text,'{"secret":"never-preview"}') RETURNING id::text`, company, booking)
	}
	trip := makeTrip("in_progress")
	booking := makeBooking(trip, customer)
	payment := makePayment(booking)
	p := preview("trips", trip)
	if len(p.Effects) != 3 {
		t.Fatalf("trip dependencies missing: %+v", p)
	}
	if strings.Contains(request("GET", "trips", trip, nil, actor, 200).Body.String(), "never-preview") {
		t.Fatal("provider payload leaked")
	}
	exec(`UPDATE payments SET amount_minor=1100 WHERE id=$1`, payment)
	request("DELETE", "trips", trip, map[string]string{"token": p.Token}, actor, 409)
	var present int
	db.QueryRow(ctx, `SELECT count(*) FROM bookings WHERE id=$1`, booking).Scan(&present)
	if present != 1 {
		t.Fatal("stale delete partially mutated children")
	}
	beforeNotifications := 0
	db.QueryRow(ctx, `SELECT count(*) FROM app_notifications`).Scan(&beforeNotifications)
	remove("trips", trip)
	for _, check := range []struct{ table, id string }{{"trips", trip}, {"bookings", booking}, {"payments", payment}} {
		db.QueryRow(ctx, "SELECT count(*) FROM "+check.table+" WHERE id=$1", check.id).Scan(&present)
		if present != 0 {
			t.Fatalf("orphan %s", check.table)
		}
		db.QueryRow(ctx, `SELECT count(*) FROM activity_events WHERE tenant_id=$1 AND action='record_deleted' AND entity_id=$2`, company, check.id).Scan(&present)
		if present != 1 {
			t.Fatalf("deletion audit missing or duplicated %s: %d", check.table, present)
		}
	}
	var afterNotifications int
	db.QueryRow(ctx, `SELECT count(*) FROM app_notifications`).Scan(&afterNotifications)
	if afterNotifications != beforeNotifications {
		t.Fatal("deletion sent a fake payment/status notification")
	}

	// If activity persistence fails, the financial/record removal rolls back too.
	faultTrip := makeTrip("assigned")
	faultBooking := makeBooking(faultTrip, customer)
	faultPayment := makePayment(faultBooking)
	exec(`CREATE FUNCTION reject_delete_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='record_deleted' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_delete_audit BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION reject_delete_audit()`)
	faultPreview := preview("trips", faultTrip)
	request("DELETE", "trips", faultTrip, map[string]string{"token": faultPreview.Token}, actor, 503)
	db.QueryRow(ctx, `SELECT count(*) FROM trips WHERE id=$1`, faultTrip).Scan(&present)
	if present != 1 {
		t.Fatal("audit failure committed a deletion")
	}
	db.QueryRow(ctx, `SELECT count(*) FROM payments WHERE id=$1`, faultPayment).Scan(&present)
	if present != 1 {
		t.Fatal("audit failure removed a payment")
	}
	db.QueryRow(ctx, `SELECT count(*) FROM bookings WHERE id=$1`, faultBooking).Scan(&present)
	if present != 1 {
		t.Fatal("audit failure removed a booking")
	}
	exec(`DROP TRIGGER reject_delete_audit ON activity_events; DROP FUNCTION reject_delete_audit()`)
	remove("trips", faultTrip)

	// Customer cascades include only that customer's bookings/requests, preserving the trip.
	trip = makeTrip("completed")
	booking = makeBooking(trip, customer)
	makePayment(booking)
	enquiry := row(`INSERT INTO individual_transfer_requests(tenant_id,customer_id,origin_name,destination_name,requested_departure_at,passenger_name,passenger_phone_e164,passenger_birth_date,seats) VALUES($1,$2,'Kyiv','Warsaw',now()+interval '1 day','Passenger','+380501234567','1990-01-01',1) RETURNING id::text`, company, customer)
	remove("customers", customer)
	db.QueryRow(ctx, `SELECT count(*) FROM trips WHERE id=$1`, trip).Scan(&present)
	if present != 1 {
		t.Fatal("customer deletion removed independent trip")
	}
	db.QueryRow(ctx, `SELECT count(*) FROM individual_transfer_requests WHERE id=$1`, enquiry).Scan(&present)
	if present != 0 {
		t.Fatal("customer request orphan")
	}
	db.QueryRow(ctx, `SELECT count(*) FROM customers WHERE id=$1`, foreign).Scan(&present)
	if present != 1 {
		t.Fatal("foreign customer changed")
	}

	route := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency) VALUES($1,'Route','Kyiv','Warsaw','EUR') RETURNING id::text`, company)
	block := row(`INSERT INTO availability_blocks(tenant_id,route_id,starts_at,ends_at) VALUES($1,$2,now(),now()+interval '1 hour') RETURNING id::text`, company, route)
	exec(`UPDATE trips SET route_id=$2 WHERE id=$1`, trip, route)
	remove("routes", route)
	db.QueryRow(ctx, `SELECT count(*) FROM trips WHERE id=$1 AND route_id IS NULL`, trip).Scan(&present)
	if present != 1 {
		t.Fatal("route delete lost trip")
	}
	db.QueryRow(ctx, `SELECT count(*) FROM activity_events WHERE entity_id=$1 AND action='record_deleted'`, block).Scan(&present)
	if present != 1 {
		t.Fatal("cascaded block not audited")
	}
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Bus','QA','bus',17) RETURNING id::text`, company)
	exec(`UPDATE trips SET vehicle_id=$2 WHERE id=$1`, trip, vehicle)
	remove("fleet", vehicle)
	db.QueryRow(ctx, `SELECT count(*) FROM trips WHERE id=$1 AND vehicle_id IS NULL`, trip).Scan(&present)
	if present != 1 {
		t.Fatal("vehicle deletion lost trip")
	}
	// Direct child removal and a second request are safe and release bookable seats.
	customer = row(`INSERT INTO customers(tenant_id,phone_e164) VALUES($1,'+380501234569') RETURNING id::text`, company)
	booking = makeBooking(trip, customer)
	makePayment(booking)
	remove("bookings", booking)
	enquiry = row(`INSERT INTO individual_transfer_requests(tenant_id,customer_id,origin_name,destination_name,requested_departure_at,passenger_name,passenger_phone_e164,passenger_birth_date,seats) VALUES($1,$2,'Kyiv','Warsaw',now()+interval '1 day','Passenger','+380501234569','1990-01-01',1) RETURNING id::text`, company, customer)
	remove("requests", enquiry)
	block = row(`INSERT INTO availability_blocks(tenant_id,starts_at,ends_at) VALUES($1,now(),now()+interval '1 hour') RETURNING id::text`, company)
	remove("availability", block)
}
