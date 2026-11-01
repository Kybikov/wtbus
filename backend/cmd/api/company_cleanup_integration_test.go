package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
)

func TestCompanyCleanupPostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	row := func(query string, args ...any) string {
		t.Helper()
		var value string
		if err := db.QueryRow(ctx, query, args...).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('cleanup-qa','Cleanup QA') RETURNING id::text`)
	other := row(`INSERT INTO tenants(slug,name) VALUES('cleanup-other','Other company') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('cleanup@test.invalid','Cleanup actor') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'developer') RETURNING id::text`, tenant, user)
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Fixture passenger','+380501234567') RETURNING id::text`, tenant)
	row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Other passenger','+380501234568') RETURNING id::text`, other)
	route := row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency) VALUES($1,'Fixture route','Kyiv','Warsaw','EUR') RETURNING id::text`, tenant)
	trip := row(`INSERT INTO trips(tenant_id,route_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,'regular','assigned','Kyiv','Warsaw',now()+interval '1 day',now()+interval '2 days',17,'EUR') RETURNING id::text`, tenant, route)
	booking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,currency) VALUES($1,$2,$3,'cash_on_boarding',1,'EUR') RETURNING id::text`, tenant, trip, customer)
	driver := row(`INSERT INTO drivers(tenant_id,full_name,phone_e164) VALUES($1,'Fixture driver','+380501234571') RETURNING id::text`, tenant)
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Fixture bus','QA-001','Bus',17) RETURNING id::text`, tenant)
	exec(`INSERT INTO gps_points(tenant_id,vehicle_id,trip_id,recorded_at,latitude,longitude) VALUES($1,$2,$3,now(),50.45,30.52)`, tenant, vehicle, trip)
	row(`INSERT INTO payments(tenant_id,booking_id,provider,amount_minor,currency,idempotency_key) VALUES($1,$2,'internal',1000,'EUR','cleanup-payment') RETURNING id::text`, tenant, booking)
	row(`INSERT INTO individual_transfer_requests(tenant_id,customer_id,booking_id,origin_name,destination_name,requested_departure_at,passenger_name,passenger_phone_e164,passenger_birth_date,seats) VALUES($1,$2,$3,'Kyiv','Warsaw',now()+interval '1 day','Fixture passenger','+380501234567','1990-01-01',1) RETURNING id::text`, tenant, customer, booking)
	expense := row(`INSERT INTO operational_expenses(tenant_id,driver_id,trip_id,category,amount_minor,currency) VALUES($1,$2,$3,'driver_pay',500,'EUR') RETURNING id::text`, tenant, driver, trip)
	row(`INSERT INTO driver_payroll_accruals(tenant_id,driver_id,expense_id,trip_id,gross_minor,currency) VALUES($1,$2,$3,$4,500,'EUR') RETURNING id::text`, tenant, driver, expense, trip)
	exec(`INSERT INTO driver_payroll_settings(tenant_id,driver_id,income_tax_bps,levy_tax_bps,employer_tax_bps) VALUES($1,$2,0,0,0)`, tenant, driver)
	handover := row(`INSERT INTO driver_cash_handovers(tenant_id,driver_id,amount_minor,currency,request_id) VALUES($1,$2,1000,'EUR',gen_random_uuid()) RETURNING id::text`, tenant, driver)
	row(`INSERT INTO driver_cash_ledger(tenant_id,driver_id,trip_id,amount_minor,currency,kind,handover_id) VALUES($1,$2,$3,1000,'EUR','collection',$4) RETURNING id::text`, tenant, driver, trip, handover)
	exec(`INSERT INTO public_booking_requests(tenant_id,request_key,request_hash,booking_id) VALUES($1,gen_random_uuid(),decode('deadbeef','hex'),$2)`, tenant, booking)
	exec(`INSERT INTO entity_views(tenant_id,owner_membership_id,entity,name,visibility,config) VALUES($1,$2,'customers','Keep this view','private','{}')`, tenant, member)
	exec(`INSERT INTO tenant_branding(tenant_id) VALUES($1) ON CONFLICT DO NOTHING`, tenant)
	exec(`INSERT INTO bank_statement_transactions(tenant_id,account_id,provider_id,amount_minor,currency,balance_minor,occurred_at) VALUES($1,'qa','qa-transfer',1000,'UAH',1000,now())`, tenant)
	memberships := row(`SELECT count(*)::text FROM memberships WHERE tenant_id=$1`, tenant)
	branding := row(`SELECT to_jsonb(b)::text FROM tenant_branding b WHERE tenant_id=$1`, tenant)
	counter := row(`SELECT next_value::text FROM record_number_settings WHERE tenant_id=$1 AND entity='customers'`, tenant)
	actor := identity{TenantID: tenant, MembershipID: member, Role: "developer"}
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	call := func(method, token string, who identity, status int) deletionPreview {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"token": token})
		r := httptest.NewRequest(method, "/", bytes.NewReader(body))
		r.SetPathValue("slug", "cleanup-qa")
		r.SetPathValue("entity", "company")
		r.SetPathValue("recordID", "current")
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		app.entityDeletion(w, r)
		if w.Code != status {
			t.Fatalf("%s expected %d got %d: %s", method, status, w.Code, w.Body)
		}
		var preview deletionPreview
		if err := json.Unmarshal(w.Body.Bytes(), &preview); err != nil {
			t.Fatal(err)
		}
		return preview
	}
	call("GET", "", identity{TenantID: tenant, Role: "owner"}, 403)
	call("GET", "", identity{TenantID: other, Role: "developer"}, 403)
	preview := call("GET", "", actor, 200)
	if preview.Token == "" || len(preview.Effects) == 0 {
		t.Fatal("missing concrete preview")
	}
	call("DELETE", "", actor, 400)
	row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Changed preview','+380501234569') RETURNING id::text`, tenant)
	call("DELETE", preview.Token, actor, 409)
	preview = call("GET", "", actor, 200)
	// Force a failure after child deletions and assert that the whole operation rolls back.
	exec(`CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER reject_cleanup BEFORE DELETE ON routes FOR EACH ROW EXECUTE FUNCTION reject_cleanup()`)
	call("DELETE", preview.Token, actor, 503)
	if row(`SELECT count(*)::text FROM bookings WHERE tenant_id=$1`, tenant) != "1" || row(`SELECT count(*)::text FROM customers WHERE tenant_id=$1`, tenant) != "2" {
		t.Fatal("partial cleanup escaped rollback")
	}
	exec(`DROP TRIGGER reject_cleanup ON routes; DROP FUNCTION reject_cleanup()`)
	preview = call("GET", "", actor, 200)
	call("DELETE", preview.Token, actor, 200)
	for _, table := range []string{"customers", "bookings", "trips", "routes", "drivers", "vehicles", "gps_points", "driver_cash_ledger", "driver_cash_handovers", "driver_payroll_settings", "driver_payroll_accruals", "operational_expenses", "individual_transfer_requests", "public_booking_requests", "payments", "bank_statement_transactions", "finance_ledger_entries"} {
		if row("SELECT count(*)::text FROM "+table+" WHERE tenant_id=$1", tenant) != "0" {
			t.Fatal("operational data retained in " + table)
		}
	}
	if row(`SELECT count(*)::text FROM memberships WHERE tenant_id=$1`, tenant) != memberships || row(`SELECT to_jsonb(b)::text FROM tenant_branding b WHERE tenant_id=$1`, tenant) != branding || row(`SELECT count(*)::text FROM users WHERE id=$1`, user) != "1" {
		t.Fatal("users or settings removed")
	}
	if row(`SELECT count(*)::text FROM customers WHERE tenant_id=$1`, other) != "1" {
		t.Fatal("another company changed")
	}
	if row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1 AND actor_membership_id=$2 AND action='record_deleted'`, tenant, member) != "14" {
		t.Fatal("per-record actor-attributed audit missing")
	}
	if row(`SELECT count(*)::text FROM entity_views WHERE tenant_id=$1 AND name='Keep this view'`, tenant) != "1" {
		t.Fatal("saved view removed")
	}
	if row(`SELECT next_value::text FROM record_number_settings WHERE tenant_id=$1 AND entity='customers'`, tenant) == counter {
		t.Fatal("fixture did not exercise counter advancement")
	}
	next := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'New test','+380501234570') RETURNING id::text`, tenant)
	if row(`SELECT number FROM record_numbers WHERE tenant_id=$1 AND record_id=$2`, tenant, next) != "CL-00003" {
		t.Fatal("deleted numbers were recycled")
	}
}
