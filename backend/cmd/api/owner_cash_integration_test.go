package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"io"
	"log/slog"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestOwnerCashPostgres(t *testing.T) {
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
	tenant := row(`INSERT INTO tenants(slug,name,subscription_status,base_currency) VALUES('owner-cash-qa','Cash QA','active','UAH') RETURNING id::text`)
	createActor := func(role, name string) (identity, string) {
		u := row(`INSERT INTO users(email,display_name) VALUES($1,$2) RETURNING id::text`, name+"@test.invalid", name)
		m := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) RETURNING id::text`, tenant, u, role)
		who := identity{UserID: u, MembershipID: m, TenantID: tenant, TenantSlug: "owner-cash-qa", Role: role}
		s, err := app.createSession(ctx, who)
		if err != nil {
			t.Fatal(err)
		}
		return who, s.SessionToken
	}
	owner, token := createActor("owner", "Cash Owner")
	_, owner2 := createActor("owner", "Other Owner")
	_, accountant := createActor("accountant", "Accountant")
	driverIdentity, driverToken := createActor("driver", "Cash Driver")
	_, developer := createActor("developer", "Cash Developer")
	driver := row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'Cash Driver','+380501') RETURNING id::text`, tenant, driverIdentity.MembershipID)
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Cash Bus','CASH-QA','bus',8) RETURNING id::text`, tenant)
	trip := row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency,driver_id,vehicle_id) VALUES($1,'individual','assigned','A','B',now()-interval '1 hour',now()+interval '1 hour',8,'UAH',$2,$3) RETURNING id::text`, tenant, driver, vehicle)
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Cash Passenger','+380502') RETURNING id::text`, tenant)
	booking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,price_minor,currency) VALUES($1,$2,$3,'cash_on_boarding',1,1000,'UAH') RETURNING id::text`, tenant, trip, customer)
	router := app.routes()
	request := func(auth, method, path string, body any) *httptest.ResponseRecorder {
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/api/v1/tenants/owner-cash-qa"+path, bytes.NewReader(data))
		r.Header.Set("Authorization", "Bearer "+auth)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	call := func(auth, method, path string, body any, want int) []byte {
		t.Helper()
		w := request(auth, method, path, body)
		if w.Code != want {
			t.Fatalf("%s %s: %d want %d %s", method, path, w.Code, want, w.Body)
		}
		return w.Body.Bytes()
	}
	cash := func(amount int64) driverCheckinRequest {
		return driverCheckinRequest{TripID: trip, BookingID: booking, CashMinor: &amount}
	}
	call(driverToken, "POST", "/finance/booking-cash", cash(100), 403)
	call(accountant, "POST", "/finance/booking-cash", cash(100), 403)
	call(developer, "GET", "/finance/booking-cash?tripId="+trip, nil, 200)
	call(token, "POST", "/finance/booking-cash", cash(100), 200)
	if got := row(`SELECT status FROM trips WHERE id=$1`, trip); got != "assigned" {
		t.Fatal("Cash invented boarding", got)
	}
	if got := row(`SELECT boarding::text FROM driver_booking_checkins WHERE booking_id=$1`, booking); got != "{}" {
		t.Fatal("Cash changed attendance", got)
	}
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- request(token, "POST", "/finance/booking-cash", cash(200)).Code }()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 {
			t.Fatal("Concurrent receipt failed", code)
		}
	}
	call(token, "POST", "/finance/booking-cash", cash(100), 409)
	call(token, "POST", "/finance/booking-cash", cash(1001), 409)
	index := 0
	call(driverToken, "POST", "/driver/checkin", driverCheckinRequest{TripID: trip, BookingID: booking, PassengerIndex: &index, Boarding: "boarded"}, 200)
	call(driverToken, "POST", "/driver/checkin", cash(300), 200)
	call(token, "POST", "/finance/booking-cash", cash(1000), 200)
	if got := row(`SELECT sum(amount_minor)::text FROM driver_cash_ledger WHERE tenant_id=$1 AND collector_membership_id=$2 AND kind='cash_collected'`, tenant, owner.MembershipID); got != "900" {
		t.Fatal("Wrong owner custody", got)
	}
	if got := row(`SELECT sum(amount_minor)::text FROM driver_cash_ledger WHERE tenant_id=$1 AND driver_id=$2 AND kind='cash_collected'`, tenant, driver); got != "100" {
		t.Fatal("Owner cash assigned to driver", got)
	}
	if got := row(`SELECT count(*)::text FROM finance_ledger_entries WHERE tenant_id=$1 AND kind='staff_cash_received'`, tenant); got != "3" {
		t.Fatal("Owner cash missing from journal", got)
	}
	call(driverToken, "PATCH", "/trips/"+trip, changeTripStatusRequest{Status: "in_progress"}, 200)
	call(driverToken, "PATCH", "/trips/"+trip, changeTripStatusRequest{Status: "completed"}, 200)
	call(token, "GET", "/finance/accounting", nil, 200)
	op := accountingOperation{Action: "deposit_own_cash", RequestID: row(`SELECT gen_random_uuid()::text`), Amount: 900, Currency: "UAH"}
	call(accountant, "POST", "/finance/operations", op, 403)
	call(token, "POST", "/finance/operations", op, 201)
	call(token, "POST", "/finance/operations", op, 200)
	call(owner2, "POST", "/finance/operations", op, 409)
	op.RequestID = row(`SELECT gen_random_uuid()::text`)
	op.Amount = 1
	call(token, "POST", "/finance/operations", op, 409)
	if got := row(`SELECT count(*)::text FROM driver_cash_handovers WHERE tenant_id=$1`, tenant); got != "0" {
		t.Fatal("Owner deposit should not await cashier")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	amount, err := companyCash(ctx, tx, tenant, "UAH")
	tx.Rollback(ctx)
	if err != nil || amount != 900 {
		t.Fatal("Wrong company cash", amount, err)
	}
	if got := row(`SELECT sum(amount_minor)::text FROM driver_cash_ledger WHERE tenant_id=$1 AND kind='cash_collected'`, tenant); got != "1000" {
		t.Fatal("Deposit counted as new revenue", got)
	}
	// Bank intent and foreign-company bookings cannot become cash receipts.
	foreign := row(`INSERT INTO tenants(slug,name) VALUES('other-cash-qa','Other') RETURNING id::text`)
	otherTrip := row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual','assigned','A','B',now(),now()+interval '1 hour',8,'UAH') RETURNING id::text`, foreign)
	call(token, "GET", "/finance/booking-cash?tripId="+otherTrip, nil, 403)
	newTrip := row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual','assigned','A','B',now(),now()+interval '1 hour',8,'UAH') RETURNING id::text`, tenant)
	bankBooking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,price_minor,currency,custom_data) VALUES($1,$2,$3,'confirmed',1,1000,'UAH','{"payment_method":"bank_transfer"}') RETURNING id::text`, tenant, newTrip, customer)
	v := int64(1000)
	call(token, "POST", "/finance/booking-cash", driverCheckinRequest{TripID: newTrip, BookingID: bankBooking, CashMinor: &v}, 409)
}
