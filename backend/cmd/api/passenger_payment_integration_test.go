package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/vivat-bus/tms/internal/ibanpayment"
)

func TestPassengerPaymentJourneyPostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	t.Cleanup(func() { _ = cache.Close() })
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
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
	tenant := row(`INSERT INTO tenants(slug,name,base_currency,timezone,subscription_status) VALUES('passenger-qa','Passenger QA','UAH','UTC','active') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('passenger-driver@test.invalid','Driver QA') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'driver') RETURNING id::text`, tenant, user)
	driver := row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'Driver QA','+380500004001') RETURNING id::text`, tenant, member)
	trip := row(`INSERT INTO trips(tenant_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency) VALUES($1,$2,'regular','assigned','Kyiv','Lviv',now()+interval '1 day',now()+interval '1 day 8 hours',8,125000,'UAH') RETURNING id::text`, tenant, driver)
	exec(`INSERT INTO tenant_payment_configs(tenant_id,provider,merchant_name,iban,edrpou,bank_name,is_enabled) VALUES($1,'internal','ФОП QA','UA599999990000000000000000001','0000000000','Test bank',true)`, tenant)
	session, err := app.createSession(ctx, identity{UserID: user, MembershipID: member, TenantID: tenant, TenantSlug: "passenger-qa", Role: "driver"})
	if err != nil {
		t.Fatal(err)
	}
	router := app.routes()
	call := func(method, path string, body any, token string, want int) []byte {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/api/v1/"+path, bytes.NewReader(data))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, strings.Split(path, "?")[0], w.Code, want, w.Body)
		}
		return w.Body.Bytes()
	}
	create := func(phone, method string) publicConfirmation {
		t.Helper()
		input := publicBookingInput{RequestKey: row(`SELECT gen_random_uuid()::text`), TripID: trip, QuotedPriceMinor: 125000, Seats: 1, PassengerPhone: phone, Passengers: []publicPassenger{{FirstName: "Ivan", LastName: "Test", BirthDate: "1990-01-01"}}, PaymentMethod: method, Consent: true}
		var result struct {
			Item publicConfirmation `json:"item"`
		}
		if err := json.Unmarshal(call("POST", "public/passenger-qa/bookings", input, "", 201), &result); err != nil {
			t.Fatal(err)
		}
		return result.Item
	}
	web := create("+380500004002", "bank_transfer")
	if web.Payment == nil || web.Payment.Status != "pending" || web.Status != "awaiting_payment" {
		t.Fatalf("web payment missing: %+v", web)
	}
	statusPath := func(c publicConfirmation) string {
		return "public/passenger-qa/payments/" + c.Reference + "?token=" + c.Payment.CheckoutToken
	}
	qrPath := func(c publicConfirmation) string {
		return "public/passenger-qa/payments/" + c.Reference + "/qr?token=" + c.Payment.CheckoutToken
	}
	call("GET", statusPath(web), nil, "", 200)
	if data := call("GET", qrPath(web), nil, "", 200); !bytes.HasPrefix(data, []byte{137, 80, 78, 71}) {
		t.Fatal("invalid payment QR")
	}
	// A lost response/retry must commit the replacement token before returning it.
	var input publicBookingInput
	var requestHash []byte
	if err := db.QueryRow(ctx, `SELECT request_key::text,request_hash FROM public_booking_requests WHERE tenant_id=$1 AND booking_id=$2`, tenant, web.Reference).Scan(&input.RequestKey, &requestHash); err != nil {
		t.Fatal(err)
	}
	input.TripID = trip
	input.QuotedPriceMinor = 125000
	input.Seats = 1
	input.PassengerPhone = "+380500004002"
	input.Passengers = []publicPassenger{{FirstName: "Ivan", LastName: "Test", BirthDate: "1990-01-01"}}
	input.PaymentMethod = "bank_transfer"
	input.Consent = true
	var replay struct {
		Item publicConfirmation `json:"item"`
	}
	if err := json.Unmarshal(call("POST", "public/passenger-qa/bookings", input, "", 200), &replay); err != nil {
		t.Fatal(err)
	}
	call("GET", statusPath(replay.Item), nil, "", 200)
	call("GET", qrPath(replay.Item), nil, "", 200)
	call("GET", statusPath(web), nil, "", 404)
	web = replay.Item
	cash := create("+380500004003", "cash_on_boarding")
	var manifest struct {
		Items []driverManifestBooking `json:"items"`
	}
	readManifest := func() {
		t.Helper()
		if err := json.Unmarshal(call("GET", "tenants/passenger-qa/driver/passengers?tripId="+trip, nil, session.SessionToken, 200), &manifest); err != nil {
			t.Fatal(err)
		}
	}
	find := func(id string) driverManifestBooking {
		t.Helper()
		for _, item := range manifest.Items {
			if item.ID == id {
				return item
			}
		}
		t.Fatalf("booking %s absent from driver manifest", id)
		return driverManifestBooking{}
	}
	readManifest()
	if m := find(web.Reference); m.PaymentMethod != "bank_transfer" || m.PaymentStatus != "pending" || m.AmountMinor != 125000 {
		t.Fatalf("incorrect bank manifest before payment: %+v", m)
	}
	if m := find(cash.Reference); m.PaymentMethod != "cash_on_boarding" || m.PaymentStatus != "pending" {
		t.Fatalf("incorrect cash manifest: %+v", m)
	}
	// Same bank-reconciliation path handles a Telegram-created checkout.
	tgCustomer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164,telegram_id) VALUES($1,'Telegram QA','+380500004004',990004004) RETURNING id::text`, tenant)
	tgBooking := row(`INSERT INTO bookings(tenant_id,customer_id,trip_id,status,seats,price_minor,currency,source,payment_hold_expires_at) VALUES($1,$2,$3,'awaiting_payment',1,125000,'UAH','telegram',now()+interval '30 minutes') RETURNING id::text`, tenant, tgCustomer, trip)
	tgPayment := row(`INSERT INTO payments(tenant_id,booking_id,provider,status,amount_minor,currency,payment_method,idempotency_key) VALUES($1,$2,'internal','pending',125000,'UAH','bank_transfer','telegram-qa') RETURNING id::text`, tenant, tgBooking)
	webPayment := row(`SELECT id::text FROM payments WHERE booking_id=$1`, web.Reference)
	transactions := []bankTransaction{
		{ID: "wrong-amount", Amount: 124999, Time: time.Now().Unix(), Description: ibanpayment.Purpose(webPayment)},
		{ID: "wrong-purpose", Amount: 125000, Time: time.Now().Unix(), Description: "Unrelated transfer"},
		{ID: "held-credit", Amount: 125000, Time: time.Now().Unix(), Description: ibanpayment.Purpose(webPayment), Hold: true},
		{ID: "outgoing", Amount: -125000, Time: time.Now().Unix(), Description: ibanpayment.Purpose(webPayment)},
		{ID: "web-bank-qa", Amount: 125000, Balance: 125000, Time: time.Now().Unix(), Description: ibanpayment.Purpose(webPayment)}, {ID: "tg-bank-qa", Amount: 125000, Balance: 250000, Time: time.Now().Unix() + 1, Comment: ibanpayment.Purpose(tgPayment)}}
	bank := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/personal/client-info" {
			io.WriteString(w, `{"managedClients":[{"accounts":[{"id":"qa-fop","iban":"UA599999990000000000000000001","currencyCode":980,"balance":250000}]}]}`)
			return
		}
		json.NewEncoder(w).Encode(transactions)
	}))
	defer bank.Close()
	app.bankBaseURL = bank.URL
	app.bankHTTPClient = bank.Client()
	if err := app.syncBank(ctx, tenant, "test-token", "UA599999990000000000000000001"); err != nil {
		t.Fatal(err)
	}
	if got := row(`SELECT provider_payment_id FROM payments WHERE id=$1`, webPayment); got != "web-bank-qa" {
		t.Fatalf("unsettled or unrelated credit confirmed booking: %s", got)
	}
	paid := call("GET", statusPath(web), nil, "", 200)
	if !bytes.Contains(paid, []byte(`"paymentStatus":"paid"`)) || !bytes.Contains(paid, []byte(`"bookingStatus":"confirmed"`)) {
		t.Fatalf("web payment not confirmed: %s", paid)
	}
	call("GET", qrPath(web), nil, "", 410)
	readManifest()
	for _, id := range []string{web.Reference, tgBooking} {
		if m := find(id); m.PaymentMethod != "bank_transfer" || m.PaymentStatus != "paid" {
			t.Fatalf("driver cannot distinguish prepaid passenger: %+v", m)
		}
	}
	exec(`UPDATE payment_reconciliation_state SET last_attempt_at=now()-interval '70 seconds' WHERE tenant_id=$1`, tenant)
	if err := app.syncBank(ctx, tenant, "test-token", "UA599999990000000000000000001"); err != nil {
		t.Fatal(err)
	}
	if got := row(`SELECT count(*)::text FROM telegram_notification_outbox WHERE tenant_id=$1 AND kind='payment_confirmed'`, tenant); got != "1" {
		t.Fatalf("duplicate or missing Telegram confirmation: %s", got)
	}
	expired := create("+380500004005", "bank_transfer")
	exec(`UPDATE bookings SET payment_hold_expires_at=now()-interval '1 second' WHERE id=$1`, expired.Reference)
	if data := call("GET", statusPath(expired), nil, "", 200); !bytes.Contains(data, []byte(`"bookingStatus":"expired"`)) {
		t.Fatalf("elapsed hold still payable: %s", data)
	}
	call("GET", qrPath(expired), nil, "", 410)
	readManifest()
	for _, m := range manifest.Items {
		if m.ID == expired.Reference {
			t.Fatal("expired passenger still appears for boarding")
		}
	}
	call("PATCH", "tenants/passenger-qa/trips/"+trip, changeTripStatusRequest{Status: "in_progress"}, session.SessionToken, 200)
	var cashDue struct {
		Item driverCashSummaryItem `json:"item"`
	}
	if err := json.Unmarshal(call("GET", "tenants/passenger-qa/driver/cash-summary", nil, session.SessionToken, 200), &cashDue); err != nil {
		t.Fatal(err)
	}
	if cashDue.Item.AmountMinor != 125000 {
		t.Fatalf("driver is asked to collect prepaid passengers again: %+v", cashDue.Item)
	}
	call("POST", "tenants/passenger-qa/driver/cash-received", confirmDriverCashReceivedRequest{TripID: trip}, session.SessionToken, 200)
	readManifest()
	if m := find(cash.Reference); m.PaymentStatus != "paid" || m.PaymentMethod != "cash_on_boarding" {
		t.Fatalf("cash receipt missing from manifest: %+v", m)
	}
	call("PATCH", "tenants/passenger-qa/trips/"+trip, changeTripStatusRequest{Status: "completed"}, session.SessionToken, 200)
}
