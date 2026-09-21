package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestEntityDetailsDatabasePrivacyAndRelations(t *testing.T) {
	url := os.Getenv("ENTITY_VIEWS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set disposable migrated ENTITY_VIEWS_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	slug := fmt.Sprintf("detail-test-%d", time.Now().UnixNano())
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
	tenant := row(`INSERT INTO tenants(slug,name) VALUES($1,'Detail test') RETURNING id::text`, slug)
	other := row(`INSERT INTO tenants(slug,name) VALUES($1,'Other detail test') RETURNING id::text`, slug+"-other")
	user := row(`INSERT INTO users(email,display_name) VALUES($1,'Detail operator') RETURNING id::text`, slug+"@test.invalid")
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'developer') RETURNING id::text`, tenant, user)
	defer func() {
		db.Exec(ctx, `DELETE FROM payments WHERE tenant_id=$1`, tenant)
		db.Exec(ctx, `DELETE FROM bookings WHERE tenant_id=$1`, tenant)
		db.Exec(ctx, `DELETE FROM individual_transfer_requests WHERE tenant_id=$1`, tenant)
		db.Exec(ctx, `DELETE FROM tenants WHERE id=ANY($1::uuid[])`, []string{tenant, other})
		db.Exec(ctx, `DELETE FROM users WHERE id=$1`, user)
	}()
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Ivan Test','+380501234567') RETURNING id::text`, tenant)
	outsider := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Private other passenger','+380501234567') RETURNING id::text`, other)
	route := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency) VALUES($1,'Kyiv Warsaw','Kyiv','Warsaw','EUR') RETURNING id::text`, tenant)
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Test bus','DETAIL-1','Bus',17) RETURNING id::text`, tenant)
	trip := row(`INSERT INTO trips(tenant_id,route_id,vehicle_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,$3,'regular','assigned','Kyiv','Warsaw',now()+interval '1 day',now()+interval '2 days',17,'EUR') RETURNING id::text`, tenant, route, vehicle)
	booking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,currency) VALUES($1,$2,$3,'cash_on_boarding',1,'EUR') RETURNING id::text`, tenant, trip, customer)
	exec(`INSERT INTO payments(tenant_id,booking_id,provider,amount_minor,currency,idempotency_key,payment_method,checkout_token_hash,provider_payload) VALUES($1,$2,'internal',7900,'EUR','details-secret-fixture','cash',decode('deadbeef','hex'),'{"secret":"not exposed"}')`, tenant, booking)
	block := row(`INSERT INTO availability_blocks(tenant_id,route_id,starts_at,ends_at) VALUES($1,$2,now()+interval '3 days',now()+interval '4 days') RETURNING id::text`, tenant, route)
	enquiry := row(`INSERT INTO individual_transfer_requests(tenant_id,customer_id,origin_name,destination_name,requested_departure_at,passenger_name,passenger_phone_e164,passenger_birth_date,seats) VALUES($1,$2,'Kyiv','Warsaw',now()+interval '5 days','Ivan Test','+380501234567','1990-01-01',1) RETURNING id::text`, tenant, customer)
	exec(`INSERT INTO gps_points(tenant_id,vehicle_id,recorded_at,latitude,longitude) VALUES($1,$2,now(),50.45,30.52)`, tenant, vehicle)
	exec(`INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,$2,'human','test_action','customer',$3,'{"secret":"not exposed"}')`, tenant, member, customer)
	exec(`INSERT INTO activity_events(tenant_id,actor_kind,action,entity_type,entity_id) VALUES($1,'system','other_company_action','customer',$2)`, other, customer)
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	call := func(entity, id string, who *identity, status int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("GET", "/", nil)
		r.SetPathValue("slug", slug)
		r.SetPathValue("entity", entity)
		r.SetPathValue("recordID", id)
		if who != nil {
			r = r.WithContext(context.WithValue(ctx, identityContextKey{}, *who))
		}
		w := httptest.NewRecorder()
		app.entityDetails(w, r)
		if w.Code != status {
			t.Fatalf("%s expected %d got %d: %s", entity, status, w.Code, w.Body)
		}
		return w
	}
	actor := identity{TenantID: tenant, MembershipID: member, Role: "developer"}
	for entity, id := range map[string]string{"customers": customer, "bookings": booking, "team": member, "routes": route, "fleet": vehicle, "requests": enquiry, "availability": block, "trips": trip} {
		t.Run(entity, func(t *testing.T) {
			w := call(entity, id, &actor, 200)
			var payload struct {
				Item     map[string]any
				Related  []entityRelation
				Activity []entityActivity
				Timezone string
			}
			if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.Item["id"] != id || payload.Timezone == "" {
				t.Fatal("record identity/timezone missing")
			}
			if _, exists := payload.Item["tenant_id"]; exists {
				t.Fatal("tenant internals exposed")
			}
			for _, secret := range []string{"password_hash", "checkout_token_hash", "provider_payload", "not exposed", "other_company_action"} {
				if strings.Contains(w.Body.String(), secret) {
					t.Fatalf("exposed %s", secret)
				}
			}
			if entity == "customers" && (len(payload.Related) != 1 || payload.Related[0].ID != booking || len(payload.Activity) != 1) {
				t.Fatal("related records/activity are missing or cross-tenant")
			}
			if entity == "customers" && (!strings.Contains(string(payload.Related[0].Meta), `"status":"cash_on_boarding"`) || !strings.Contains(string(payload.Related[0].Meta), `"starts_at"`)) {
				t.Fatalf("related record metrics are missing: %s", payload.Related[0].Meta)
			}
			if entity == "fleet" && payload.Item["last_location"] == nil {
				t.Fatal("GPS missing")
			}
			call(entity, "00000000-0000-0000-0000-000000000000", &actor, 404)
		})
	}
	call("customers", outsider, &actor, 404)
	foreign := identity{TenantID: other, Role: "developer"}
	call("customers", customer, &foreign, 403)
	dispatcher := identity{TenantID: tenant, Role: "dispatcher"}
	call("team", member, &dispatcher, 403)
	call("customers", customer, &dispatcher, 200)
	driver := identity{TenantID: tenant, Role: "driver"}
	call("customers", customer, &driver, 403)
	call("customers", customer, nil, 401)
	call("customers", "bad-id", &actor, 400)
	call("unknown", customer, &actor, 404)
	// A limited list must still report its exact matching total to the shared footer.
	exec(`INSERT INTO individual_transfer_requests(tenant_id,customer_id,origin_name,destination_name,requested_departure_at,passenger_name,passenger_phone_e164,passenger_birth_date,seats) SELECT tenant_id,customer_id,origin_name,destination_name,requested_departure_at,passenger_name,passenger_phone_e164,passenger_birth_date,seats FROM individual_transfer_requests WHERE id=$1`, enquiry)
	r := httptest.NewRequest("GET", "/?limit=1", nil)
	r.SetPathValue("slug", slug)
	w := httptest.NewRecorder()
	app.listIndividualTransferRequests(w, r)
	var listing struct {
		Items []individualTransferRequestListItem
		Total int
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &listing) != nil || len(listing.Items) != 1 || listing.Total != 2 {
		t.Fatalf("limited list count wrong: %s", w.Body)
	}
}
