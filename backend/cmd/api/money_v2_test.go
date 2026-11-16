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
)

func TestMoneyV2Rounding(t *testing.T) {
	for _, v := range []struct {
		n    int64
		r    string
		want int64
	}{{440000, "0.02", 8800}, {1, "0.5", 1}, {10001, "1.234567", 12347}, {100, "1", 100}} {
		n, err := moneyRound(v.n, v.r)
		if err != nil || n != v.want {
			t.Fatalf("%+v: %d %v", v, n, err)
		}
	}
	for _, r := range []string{"0", "-1", "NaN", "1e999"} {
		if _, err := moneyRound(100, r); err == nil {
			t.Fatal("accepted", r)
		}
	}
}
func TestMoneyV2Postgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(sql string, args ...any) string {
		t.Helper()
		var s string
		if err := db.QueryRow(ctx, sql, args...).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	uuid := func() string { return row(`SELECT gen_random_uuid()::text`) }
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('money-qa','Money QA') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('money-owner@test.invalid','Owner') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner') RETURNING id::text`, tenant, user)
	otherUser := row(`INSERT INTO users(email,display_name) VALUES('money-staff@test.invalid','Staff') RETURNING id::text`)
	otherMember := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'driver') RETURNING id::text`, tenant, otherUser)
	actor := identity{TenantID: tenant, MembershipID: member, Role: "owner"}
	staff := identity{TenantID: tenant, MembershipID: otherMember, Role: "driver"}
	trip := row(`INSERT INTO trips(tenant_id,kind,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency,status) VALUES($1,'regular','Kyiv','Berlin',now()+interval '1 day',now()+interval '2 days',18,10000,'EUR','planned') RETURNING id::text`, tenant)
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Passenger','+380500000001') RETURNING id::text`, tenant)
	booking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,price_minor,currency) VALUES($1,$2,$3,10000,'EUR') RETURNING id::text`, tenant, trip, customer)
	call := func(method, path string, in any, a identity, handler http.HandlerFunc, want int) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(in)
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.SetPathValue("slug", "money-qa")
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, a))
		w := httptest.NewRecorder()
		handler(w, r)
		if w.Code != want {
			t.Fatalf("%s %s got%d want%d: %s", method, path, w.Code, want, w.Body)
		}
		return w
	}
	op := func(in moneyCommand, a identity, want int) string {
		t.Helper()
		if in.RequestID == "" {
			in.RequestID = uuid()
		}
		w := call("POST", "/finance/workspace", in, a, app.moneyWorkspace, want)
		var out map[string]string
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out["id"]
	}
	// Historical FX is deliberately absent; do not substitute current rates.
	op(moneyCommand{Action: "receive", BookingID: booking, Amount: 440000, Currency: "UAH"}, actor, 400)
	date := time.Now().Format("2006-01-02")
	op(moneyCommand{Action: "rate", Date: date, Currency: "EUR", RateToUAH: "50", Description: "Historical quote"}, actor, 200)
	receipt := moneyCommand{Action: "receive", RequestID: uuid(), BookingID: booking, Amount: 440000, Currency: "UAH"}
	id := op(receipt, actor, 200)
	if op(receipt, actor, 200) != id {
		t.Fatal("idempotency changed result")
	}
	receipt.Amount++
	op(receipt, actor, 409)
	op(moneyCommand{Action: "receive", BookingID: booking, Amount: 1, Currency: "EUR"}, staff, 403)
	var cash, physical int64
	if err := db.QueryRow(ctx, `SELECT cash_minor FROM driver_booking_checkins WHERE booking_id=$1`, booking).Scan(&cash); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `SELECT sum(amount_minor) FROM driver_cash_ledger WHERE tenant_id=$1`, tenant).Scan(&physical); err != nil {
		t.Fatal(err)
	}
	if cash != 8800 || physical != 440000 {
		t.Fatalf("native/settled mixed: %d %d", cash, physical)
	}
	var ws map[string]any
	w := call("GET", "/finance/workspace", nil, actor, app.moneyWorkspace, 200)
	if err := json.Unmarshal(w.Body.Bytes(), &ws); err != nil {
		t.Fatal(err)
	}
	var account string
	for _, v := range ws["wallets"].([]any) {
		a := v.(map[string]any)
		if a["ownerId"] == member && a["currency"] == "UAH" {
			account = a["accountId"].(string)
		}
	}
	if account == "" {
		t.Fatal("own cash wallet missing")
	}
	transfer := op(moneyCommand{Action: "transfer", AccountID: account, TargetMembershipID: otherMember, Amount: 400000, Currency: "UAH"}, actor, 200)
	op(moneyCommand{Action: "expense", AccountID: account, Amount: 50000, Currency: "UAH", Category: "fuel", TripID: trip}, actor, 409)
	op(moneyCommand{Action: "accept", ID: transfer}, actor, 403)
	op(moneyCommand{Action: "accept", ID: transfer}, staff, 200)
	op(moneyCommand{Action: "accept", ID: transfer}, staff, 409)
	staffWallet := row(`SELECT id::text FROM money_accounts WHERE tenant_id=$1 AND owner_type='member' AND owner_id=$2 AND currency='UAH'`, tenant, otherMember)
	staffWorkspace := call("GET", "/finance/workspace", nil, staff, app.moneyWorkspace, 200)
	if !strings.Contains(staffWorkspace.Body.String(), member) {
		t.Fatal("staff recipient directory missing owner")
	}
	staffTransfer := op(moneyCommand{Action: "transfer", AccountID: staffWallet, TargetMembershipID: member, Amount: 5000, Currency: "UAH"}, staff, 200)
	op(moneyCommand{Action: "accept", ID: staffTransfer}, actor, 200)
	op(moneyCommand{Action: "exchange", AccountID: account, Amount: 10000, Currency: "UAH", TargetCurrency: "EUR", TargetAmount: 200}, actor, 200)
	expense := op(moneyCommand{Action: "expense", AccountID: account, Amount: 10000, Currency: "UAH", Category: "fuel", TripID: trip}, actor, 200)
	op(moneyCommand{Action: "reverse", ID: expense, Description: "Expense correction"}, actor, 200)
	op(moneyCommand{Action: "reverse", ID: expense, Description: "Repeated correction"}, actor, 409)
	call("GET", "/finance/booking-payments?bookingId="+booking, nil, actor, app.bookingPayments, 200)
	call("GET", "/finance/booking-payments?tripId="+trip, nil, staff, app.bookingPayments, 403)
	profit := call("GET", "/finance/trips?tripId="+trip, nil, actor, app.tripMoney, 200)
	if !strings.Contains(profit.Body.String(), `"revenueMinor":8800`) {
		t.Fatal(profit.Body.String())
	}
	var frozen int64
	if err := db.QueryRow(ctx, `SELECT amount_minor FROM money_valuations WHERE tenant_id=$1 AND journal_id=$2 AND reporting_currency='EUR'`, tenant, id).Scan(&frozen); err != nil || frozen != 8800 {
		t.Fatalf("operation snapshot %d %v", frozen, err)
	}
	op(moneyCommand{Action: "deposit", AccountID: account, Amount: 1000, Currency: "UAH"}, actor, 200)
	// An incoming acceptance cannot consume a separate legacy handover's hold.
	reservedTransfer := op(moneyCommand{Action: "transfer", AccountID: account, TargetMembershipID: otherMember, Amount: 1000, Currency: "UAH"}, actor, 200)
	legacyDriver := row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'Owner driver','+380500000009') RETURNING id::text`, tenant, member)
	legacyHold := row(`INSERT INTO driver_cash_handovers(tenant_id,driver_id,amount_minor,currency,requested_by,request_id) VALUES($1,$2,33500,'UAH',$3,$4) RETURNING id::text`, tenant, legacyDriver, member, uuid())
	op(moneyCommand{Action: "accept", ID: reservedTransfer}, staff, 409)
	exec(`UPDATE driver_cash_handovers SET status='cancelled',resolved_by=$2,resolved_at=now() WHERE id=$1`, legacyHold, member)
	op(moneyCommand{Action: "accept", ID: reservedTransfer}, staff, 200)
	// Same-txn bridge is exactly once, immutable, balanced, and cross-tenant safe.
	exec(`SELECT money_bridge('driver_cash_ledger',to_jsonb(l)) FROM driver_cash_ledger l WHERE tenant_id=$1`, tenant)
	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM money_journal WHERE tenant_id=$1 AND kind='receipt'`, tenant).Scan(&count); err != nil || count != 1 {
		t.Fatalf("bridge count %d %v", count, err)
	}
	if _, err := db.Exec(ctx, `UPDATE money_postings SET amount_minor=1 WHERE tenant_id=$1`, tenant); err == nil {
		t.Fatal("mutable ledger")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	system, err := moneyAccount(ctx, tx, tenant, "system", tenant, "UAH")
	if err != nil {
		t.Fatal(err)
	}
	_, err = moneyPost(ctx, tx, actor, "bad", uuid(), "", "", "", time.Now(), map[string]int64{system: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err == nil {
		t.Fatal("unbalanced transaction committed")
	}
	strangerTenant := row(`INSERT INTO tenants(slug,name) VALUES('money-other','Other') RETURNING id::text`)
	if _, err = db.Exec(ctx, `SELECT money_account($1,'member',$2,'UAH')`, strangerTenant, member); err == nil {
		t.Fatal("cross tenant account")
	}
	// Assignment grants collection without making the staff member primary driver.
	exec(`INSERT INTO trip_crew(tenant_id,trip_id,membership_id,role,can_collect,pay_currency) VALUES($1,$2,$3,'manager',true,'EUR')`, tenant, trip, otherMember)
	call("GET", "/finance/booking-payments?tripId="+trip, nil, staff, app.bookingPayments, 200)
	exec(`UPDATE trips SET status='completed' WHERE tenant_id=$1 AND id=$2`, tenant, trip)
	finalReceipt := op(moneyCommand{Action: "receive", BookingID: booking, Amount: 1200, Currency: "EUR"}, staff, 200)
	op(moneyCommand{Action: "receive", BookingID: booking, Amount: 1, Currency: "EUR"}, staff, 409)
	op(moneyCommand{Action: "reverse", ID: finalReceipt, Description: "Passenger refund"}, actor, 200)
	if err := db.QueryRow(ctx, `SELECT cash_minor FROM driver_booking_checkins WHERE booking_id=$1`, booking).Scan(&cash); err != nil || cash != 8800 {
		t.Fatalf("reversed allocation %d %v", cash, err)
	}
	pending := row(`INSERT INTO payments(tenant_id,booking_id,provider,status,amount_minor,currency,idempotency_key,payment_method) VALUES($1,$2,'internal','pending',1200,'EUR','money-pending','bank_transfer') RETURNING id::text`, tenant, booking)
	op(moneyCommand{Action: "receive", BookingID: booking, Amount: 1200, Currency: "EUR"}, staff, 409)
	exec(`UPDATE payments SET status='cancelled' WHERE id=$1`, pending)
	exec(`UPDATE bookings SET status='cancelled' WHERE id=$1`, booking)
	op(moneyCommand{Action: "receive", BookingID: booking, Amount: 1200, Currency: "EUR"}, staff, 409)
	// Reject/cancel release reservations; accepting a handover does not add revenue.
	for _, action := range []string{"reject", "cancel"} {
		tr := op(moneyCommand{Action: "transfer", AccountID: account, TargetMembershipID: otherMember, Amount: 1000, Currency: "UAH"}, actor, 200)
		who := actor
		if action == "reject" {
			who = staff
		}
		op(moneyCommand{Action: action, ID: tr}, who, 200)
	}
	if _, err = db.Exec(ctx, `UPDATE money_rate_history SET rate_to_uah=60 WHERE tenant_id=$1`, tenant); err == nil {
		t.Fatal("historical quote changed")
	}
	// First quote survives repeated daily worker observations, never backfills yesterday.
	old := time.Now().AddDate(0, 0, -3)
	if err := app.storeMoneyRateHistory(ctx, tenant, []monobankRate{{A: 840, B: 980, Date: old.Unix(), Cross: 40}}); err != nil {
		t.Fatal(err)
	}
	if err := app.storeMoneyRateHistory(ctx, tenant, []monobankRate{{A: 840, B: 980, Date: old.Unix(), Cross: 45}}); err != nil {
		t.Fatal(err)
	}
	var quote string
	if err := db.QueryRow(ctx, `SELECT rate_to_uah::text FROM money_rate_history WHERE tenant_id=$1 AND currency='USD'`, tenant).Scan(&quote); err != nil || !strings.HasPrefix(quote, "40.") {
		t.Fatalf("quote %s %v", quote, err)
	}
	if w := call("GET", "/finance/trips?tripId="+trip+"&from=2000-01-01&to=2000-01-01", nil, actor, app.tripMoney, 200); !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatal("date filter", w.Body.String())
	}
}
