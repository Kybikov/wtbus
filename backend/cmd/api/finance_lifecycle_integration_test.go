package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// Exercise the public authenticated router, including account creation and real
// password login. The disposable schema is destroyed by deliveryTestDatabase.
func TestDriverAccountingLifecyclePostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	t.Cleanup(func() { _ = cache.Close() })
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(query string, args ...any) string {
		t.Helper()
		var value string
		if err := db.QueryRow(ctx, query, args...).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	tenant := row(`INSERT INTO tenants(slug,name,subscription_status,base_currency,timezone) VALUES('lifecycle-qa','Lifecycle QA','active','UAH','Europe/Kyiv') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('developer-lifecycle@test.invalid','Разработчик QA') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'developer') RETURNING id::text`, tenant, user)
	session, err := app.createSession(ctx, identity{UserID: user, MembershipID: member, TenantID: tenant, TenantSlug: "lifecycle-qa", Role: "developer"})
	if err != nil {
		t.Fatal(err)
	}
	router := app.routes()
	call := func(token, method, path string, body any, want int) []byte {
		t.Helper()
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, "/api/v1/"+path, bytes.NewReader(data))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, want, w.Body)
		}
		return w.Body.Bytes()
	}
	company := "tenants/lifecycle-qa"
	dev := session.SessionToken
	decode := func(data []byte, result any) {
		t.Helper()
		if err := json.Unmarshal(data, result); err != nil {
			t.Fatal(err)
		}
	}
	orphan := row(`INSERT INTO drivers(tenant_id,full_name,phone_e164) VALUES($1,'Профиль QA','+380500003001') RETURNING id::text`, tenant)
	var driverAccount teamMemberResponse
	decode(call(dev, "POST", company+"/team", createTeamMemberRequest{DisplayName: "Водитель QA", Email: "driver-lifecycle@test.invalid", Password: "disposable-driver-password", Role: "driver", DriverPhone: "+380500003001", DriverID: orphan}, 201), &driverAccount)
	if driverAccount.DriverID == nil || *driverAccount.DriverID != orphan {
		t.Fatal("onboarding replaced the existing driver profile")
	}
	call(dev, "POST", company+"/team", createTeamMemberRequest{DisplayName: "Бухгалтер QA", Email: "accountant-lifecycle@test.invalid", Password: "disposable-accountant-password", Role: "accountant"}, 201)
	call(dev, "POST", company+"/team", createTeamMemberRequest{DisplayName: "Другой водитель QA", Email: "other-driver-lifecycle@test.invalid", Password: "disposable-other-password", Role: "driver", DriverPhone: "+380500003002"}, 201)
	login := func(email, password, role string) string {
		t.Helper()
		var result loginResponse
		decode(call("", "POST", "auth/login", loginRequest{Email: email, Password: password}, 200), &result)
		if result.SessionToken == "" || result.Role != role || result.TenantSlug != "lifecycle-qa" {
			t.Fatalf("unexpected login role/tenant: %s %s", result.Role, result.TenantSlug)
		}
		return result.SessionToken
	}
	driver := login("driver-lifecycle@test.invalid", "disposable-driver-password", "driver")
	accountant := login("accountant-lifecycle@test.invalid", "disposable-accountant-password", "accountant")
	other := login("other-driver-lifecycle@test.invalid", "disposable-other-password", "driver")
	call("", "POST", "auth/login", loginRequest{Email: "driver-lifecycle@test.invalid", Password: "wrong-password"}, 401)
	call(accountant, "PATCH", company+"/finance/settings", accountingSettings{payrollRates: payrollRates{Income: 1000, Levy: 500, Employer: 2000}}, 200)
	var vehicleResult struct{ Item vehicleResponse }
	decode(call(dev, "POST", company+"/fleet", vehicleInput{Name: "QA Bus", RegistrationNumber: "LIFE-QA", VehicleClass: "bus", Capacity: 8, IsActive: true, Status: "ready"}, 201), &vehicleResult)
	vehicle := vehicleResult.Item.ID
	var routeResult struct{ Item routeResponse }
	decode(call(dev, "POST", company+"/routes", routeInput{Name: "Киев — Львов QA", Origin: "Киев", Destination: "Львов", Currency: "UAH", DefaultPriceMinor: 100000, DefaultPricingMode: "per_passenger", DriverPayMinor: 20000, Status: "active", TariffMode: "fixed"}, 201), &routeResult)
	route := routeResult.Item.ID
	if vehicle == "" || route == "" || vehicleResult.Item.Capacity != 8 || routeResult.Item.DriverPayMinor != 20000 {
		t.Fatal("resource creation lost identity, capacity or driver pay")
	}
	location, _ := time.LoadLocation("Europe/Kyiv")
	start := time.Now().In(location).Add(24 * time.Hour).Truncate(time.Minute)
	var created struct {
		Item tripResponse `json:"item"`
	}
	decode(call(dev, "POST", company+"/trips", createTripRequest{Kind: "regular", RouteID: route, VehicleID: vehicle, DriverID: orphan, StartsAt: start.Format("2006-01-02T15:04"), EndsAt: start.Add(8 * time.Hour).Format("2006-01-02T15:04")}, 201), &created)
	trip := created.Item.ID
	if trip == "" || created.Item.Driver != "Водитель QA" || created.Item.PriceMinor != 100000 {
		t.Fatalf("unexpected planned trip: %+v", created.Item)
	}
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Пассажир QA','+380500003003') RETURNING id::text`, tenant)
	var booked struct{ Item struct{ ID string } }
	decode(call(dev, "POST", company+"/bookings", createBookingRequest{TripID: trip, CustomerID: customer, Seats: 2, PassengerName: "Пассажир QA", PassengerPhone: "+380500003003", PassengerBirthDate: "1990-01-01"}, 201), &booked)
	passengerBooking := booked.Item.ID
	absentCustomer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'No show QA','+380500003004') RETURNING id::text`, tenant)
	decode(call(dev, "POST", company+"/bookings", createBookingRequest{TripID: trip, CustomerID: absentCustomer, Seats: 1, PassengerName: "No show QA", PassengerPhone: "+380500003004", PassengerBirthDate: "1990-01-01"}, 201), &booked)
	absentBooking := booked.Item.ID
	if got := row(`SELECT (capacity-(SELECT sum(seats) FROM bookings WHERE trip_id=t.id))::text FROM trips t WHERE id=$1`, trip); got != "5" {
		t.Fatalf("reserved seats: %s", got)
	}
	// The customer has a reservation but has not paid anything yet.
	var customerResult struct{ Item customerResponse }
	decode(call(dev, "GET", company+"/customers/"+customer, nil, 200), &customerResult)
	if len(customerResult.Item.LifetimeValue) != 0 {
		t.Fatal("unpaid reservations counted as received money")
	}
	zeroIndex, secondIndex := 0, 1
	cash := int64(50000)
	check := driverCheckinRequest{TripID: trip, BookingID: passengerBooking, CashMinor: &cash}
	call(driver, "POST", company+"/driver/checkin", check, 409)
	call(other, "POST", company+"/driver/checkin", driverCheckinRequest{TripID: trip, BookingID: passengerBooking, PassengerIndex: &zeroIndex, Boarding: "boarded"}, 404)
	call(driver, "POST", company+"/driver/checkin", driverCheckinRequest{TripID: trip, BookingID: passengerBooking, PassengerIndex: &zeroIndex, Boarding: "boarded"}, 200)
	call(driver, "POST", company+"/driver/checkin", driverCheckinRequest{TripID: trip, BookingID: absentBooking, PassengerIndex: &zeroIndex, Boarding: "absent"}, 200)
	for i := 0; i < 2; i++ {
		call(driver, "POST", company+"/driver/checkin", check, 200)
	}
	if got := row(`SELECT sum(amount_minor)::text FROM driver_cash_ledger WHERE tenant_id=$1 AND kind='cash_collected'`, tenant); got != "50000" {
		t.Fatalf("cash retry duplicated money: %s", got)
	}
	decode(call(dev, "GET", company+"/customers/"+customer, nil, 200), &customerResult)
	if len(customerResult.Item.LifetimeValue) != 1 || customerResult.Item.LifetimeValue[0].AmountMinor != 50000 {
		t.Fatalf("partial cash missing from customer: %+v", customerResult.Item)
	}
	var partialFinance financeSummaryResponse
	decode(call(dev, "GET", company+"/finance/summary", nil, 200), &partialFinance)
	if partialFinance.ConfirmedRevenueMinor != 50000 || partialFinance.PendingRevenueMinor != 250000 {
		t.Fatalf("partial finance totals: %+v", partialFinance)
	}
	var manifestResult struct{ Items []driverManifestBooking }
	decode(call(driver, "GET", company+"/driver/passengers?tripId="+trip, nil, 200), &manifestResult)
	for _, b := range manifestResult.Items {
		if b.ID == passengerBooking && (b.CashMinor != 50000 || b.PaymentStatus != "partial" || b.Boarding["0"] != "boarded") {
			t.Fatalf("manifest partial/boarding lost: %+v", b)
		}
		if b.ID == absentBooking && b.PaymentStatus == "paid" {
			t.Fatal("one receipt marked every booking paid")
		}
	}
	cash = 200001
	call(driver, "POST", company+"/driver/checkin", check, 409)
	cash = 40000
	call(driver, "POST", company+"/driver/checkin", check, 409)
	cash = 0
	call(driver, "POST", company+"/driver/checkin", check, 409)
	cash = 200000

	call(driver, "POST", company+"/driver/cash-received", confirmDriverCashReceivedRequest{TripID: trip}, 409)
	call(other, "PATCH", company+"/trips/"+trip, changeTripStatusRequest{Status: "in_progress"}, 404)
	call(driver, "PATCH", company+"/trips/"+trip, changeTripStatusRequest{Status: "in_progress"}, 200)
	call(driver, "PATCH", company+"/trips/"+trip, changeTripStatusRequest{Status: "completed"}, 409)
	call(other, "POST", company+"/driver/cash-received", confirmDriverCashReceivedRequest{TripID: trip}, 409)
	var bookingList struct{ Items []bookingListItem }
	decode(call(dev, "GET", company+"/bookings", nil, 200), &bookingList)
	for _, booking := range bookingList.Items {
		if booking.ID == passengerBooking && booking.PaymentStatus != "partial" {
			t.Fatalf("partial payment absent from booking list: %+v", booking)
		}
	}
	// Partial receipt prevents completion. An unresolved second passenger also blocks it.
	call(driver, "POST", company+"/driver/cash-received", confirmDriverCashReceivedRequest{TripID: trip}, 409)
	call(driver, "PATCH", company+"/trips/"+trip, changeTripStatusRequest{Status: "completed"}, 409)
	// Simultaneous retries must create only one top-up receipt.
	payload, _ := json.Marshal(check)
	receiptsResult := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		go func() {
			r := httptest.NewRequest("POST", "/api/v1/"+company+"/driver/checkin", bytes.NewReader(payload))
			r.Header.Set("Authorization", "Bearer "+driver)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			receiptsResult <- w
		}()
	}
	for i := 0; i < 2; i++ {
		w := <-receiptsResult
		if w.Code != 200 {
			t.Fatalf("concurrent cash: %d %s", w.Code, w.Body)
		}
	}
	detailMoney := call(dev, "GET", company+"/entity-details/bookings/"+passengerBooking, nil, 200)
	if !bytes.Contains(detailMoney, []byte(`"cash_received_minor":200000`)) || !bytes.Contains(detailMoney, []byte(`"boarding":{`)) || !bytes.Contains(detailMoney, []byte(`"payment_status":"paid"`)) || !bytes.Contains(detailMoney, []byte(`"payment_method":"cash"`)) {
		t.Fatalf("dispatcher detail lost driver data: %s", detailMoney)
	}

	call(driver, "PATCH", company+"/trips/"+trip, changeTripStatusRequest{Status: "completed"}, 409)
	call(driver, "POST", company+"/driver/checkin", driverCheckinRequest{TripID: trip, BookingID: passengerBooking, PassengerIndex: &secondIndex, Boarding: "boarded"}, 200)
	call(driver, "POST", company+"/driver/checkin", driverCheckinRequest{TripID: trip, BookingID: passengerBooking, PassengerIndex: &zeroIndex, Boarding: "absent"}, 200)
	call(driver, "POST", company+"/driver/checkin", driverCheckinRequest{TripID: trip, BookingID: passengerBooking, PassengerIndex: &secondIndex, Boarding: "absent"}, 409)
	call(driver, "POST", company+"/driver/checkin", driverCheckinRequest{TripID: trip, BookingID: passengerBooking, PassengerIndex: &zeroIndex, Boarding: "boarded"}, 200)
	call(driver, "PATCH", company+"/trips/"+trip, changeTripStatusRequest{Status: "completed"}, 200)
	if got := row(`SELECT status FROM bookings WHERE id=$1`, absentBooking); got != "cancelled" {
		t.Fatalf("no-show not cancelled: %s", got)
	}
	if got := row(`SELECT (actual_started_at<starts_at AND actual_completed_at>=actual_started_at)::text FROM trips WHERE id=$1`, trip); got != "true" {
		t.Fatalf("early actual times not retained: %s", got)
	}
	call(driver, "POST", company+"/driver/checkin", check, 409)
	if got := row(`SELECT (capacity-(SELECT sum(seats) FROM bookings b WHERE b.trip_id=t.id AND workflow_status_phase(b.tenant_id,'bookings',b.status)='completed'))::text FROM trips t WHERE id=$1`, trip); got != "6" {
		t.Fatalf("no-show still occupies seats: %s", got)
	}
	completedAt := row(`SELECT updated_at::text FROM trips WHERE id=$1`, trip)
	call(driver, "PATCH", company+"/trips/"+trip, changeTripStatusRequest{Status: "completed"}, 200)
	if row(`SELECT updated_at::text FROM trips WHERE id=$1`, trip) != completedAt {
		t.Fatal("completion retry mutated the already completed trip")
	}
	var snapshot struct {
		Balances []struct {
			DriverID string `json:"driverId"`
			Cash     int64  `json:"cashMinor"`
			Gross    int64  `json:"grossMinor"`
			Payable  int64  `json:"payableMinor"`
		} `json:"balances"`
		CompanyCash []moneyBalance `json:"companyCash"`
	}
	decode(call(driver, "GET", company+"/driver/wallet", nil, 200), &snapshot)
	if len(snapshot.Balances) != 1 || snapshot.Balances[0].Cash != 200000 || snapshot.Balances[0].Gross != 20000 || snapshot.Balances[0].Payable != 17000 {
		t.Fatalf("incorrect collected cash or trip payroll: %+v", snapshot)
	}
	if bytes.Contains(call(other, "GET", company+"/driver/wallet", nil, 200), []byte(orphan)) {
		t.Fatal("another driver can see the first driver's wallet")
	}
	call(driver, "GET", company+"/finance/accounting", nil, 403)
	call(driver, "POST", company+"/finance/operations", accountingOperation{Action: "receipt", Amount: 1}, 403)
	call(accountant, "GET", company+"/team", nil, 403)
	requestID := func() string { return row(`SELECT gen_random_uuid()::text`) }
	request := accountingOperation{Action: "request_handover", RequestID: requestID(), Amount: 200000, Currency: "UAH"}
	var handover struct {
		ID string `json:"id"`
	}
	decode(call(driver, "POST", company+"/driver/handovers", request, 201), &handover)
	call(driver, "POST", company+"/driver/handovers", accountingOperation{Action: "request_handover", RequestID: requestID(), Amount: 1, Currency: "UAH"}, 409)
	call(other, "POST", company+"/driver/handovers", accountingOperation{Action: "cancel_handover", ID: handover.ID}, 403)
	call(accountant, "POST", company+"/finance/operations", accountingOperation{Action: "accept_handover", ID: handover.ID}, 201)
	call(accountant, "POST", company+"/finance/operations", accountingOperation{Action: "accept_handover", ID: handover.ID}, 200)
	payout := accountingOperation{Action: "payout", RequestID: requestID(), DriverID: orphan, Amount: 17000, Currency: "UAH", Source: "cash"}
	call(accountant, "POST", company+"/finance/operations", payout, 201)
	call(accountant, "POST", company+"/finance/operations", payout, 200)
	for _, tax := range []struct {
		kind   string
		amount int64
	}{{"income", 2000}, {"levy", 1000}, {"employer", 4000}} {
		call(accountant, "POST", company+"/finance/operations", accountingOperation{Action: "tax_payment", RequestID: requestID(), DriverID: orphan, Amount: tax.amount, Currency: "UAH", Source: "cash", Category: tax.kind}, 201)
	}
	var summary financeSummaryResponse
	decode(call(accountant, "GET", company+"/finance/summary", nil, 200), &summary)
	if summary.ConfirmedRevenueMinor != 200000 || summary.OperationalExpensesMinor != 24000 || summary.NetProfitMinor != 176000 || summary.DriverCashBalanceMinor != 0 {
		t.Fatalf("incorrect lifecycle financial result: %+v", summary)
	}
	var officeCash int64
	decode(call(accountant, "GET", company+"/finance/accounting", nil, 200), &snapshot)
	for _, balance := range snapshot.CompanyCash {
		if balance.Currency == "UAH" {
			officeCash = balance.BalanceMinor
		}
	}
	if officeCash != 176000 {
		t.Fatalf("incorrect remaining office cash after salary and taxes: %d", officeCash)
	}
	if err := db.QueryRow(ctx, `SELECT coalesce(sum(amount_minor),0) FROM driver_cash_ledger WHERE tenant_id=$1 AND kind='collection'`, tenant).Scan(&officeCash); err != nil || officeCash != 200000 {
		t.Fatalf("handover duplicated or missing: %d %v", officeCash, err)
	}
	var accruals, receipts int
	if err := db.QueryRow(ctx, `SELECT (SELECT count(*) FROM driver_payroll_accruals WHERE tenant_id=$1),(SELECT count(*) FROM driver_cash_ledger WHERE tenant_id=$1 AND kind='cash_collected')`, tenant).Scan(&accruals, &receipts); err != nil || accruals != 1 || receipts != 2 {
		t.Fatalf("duplicate money after retries: accruals=%d receipts=%d %v", accruals, receipts, err)
	}
	var cashActor, payrollActor string
	if err := db.QueryRow(ctx, `SELECT l.actor_membership_id::text,e.actor_membership_id::text FROM driver_cash_ledger l JOIN operational_expenses e ON e.trip_id=l.trip_id AND e.category='driver_pay' WHERE l.tenant_id=$1 AND l.kind='cash_collected'`, tenant).Scan(&cashActor, &payrollActor); err != nil || cashActor != driverAccount.MembershipID || payrollActor != driverAccount.MembershipID {
		t.Fatalf("lost driver attribution: %s %s %v", cashActor, payrollActor, err)
	}
	lateTrip := row(`INSERT INTO trips(tenant_id,vehicle_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,$3,'individual','assigned','Late A','Late B',now()-interval '2 hours',now()-interval '1 hour',8,'UAH') RETURNING id::text`, tenant, vehicle, orphan)
	call(driver, "PATCH", company+"/trips/"+lateTrip, changeTripStatusRequest{Status: "in_progress"}, 200)
	if got := row(`SELECT (actual_started_at>ends_at)::text FROM trips WHERE id=$1`, lateTrip); got != "true" {
		t.Fatal("late departure not recorded")
	}
	nextTrip := row(`INSERT INTO trips(tenant_id,vehicle_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,$3,'individual','assigned','Next A','Next B',now()+interval '3 hours',now()+interval '4 hours',8,'UAH') RETURNING id::text`, tenant, vehicle, orphan)
	call(driver, "PATCH", company+"/trips/"+nextTrip, changeTripStatusRequest{Status: "in_progress"}, 409)
	call(driver, "PATCH", company+"/trips/"+lateTrip, changeTripStatusRequest{Status: "completed"}, 200)
	call(dev, "PATCH", company+"/team/"+driverAccount.MembershipID, updateTeamMemberRequest{IsActive: func() *bool { v := false; return &v }()}, 200)
	call(driver, "GET", company+"/driver/wallet", nil, 401)
}
