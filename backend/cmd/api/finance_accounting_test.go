package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"github.com/vivat-bus/tms/internal/ibanpayment"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPayrollIntegerRounding(t *testing.T) {
	for _, tc := range []struct {
		gross int64
		rates payrollRates
		want  payrollAmounts
	}{{10001, payrollRates{1800, 500, 2200}, payrollAmounts{1800, 500, 2200}}, {1, payrollRates{5000, 5000, 0}, payrollAmounts{1, 0, 0}}, {999, payrollRates{}, payrollAmounts{}}} {
		got, err := calculatePayroll(tc.gross, tc.rates)
		if err != nil || got != tc.want {
			t.Fatalf("%+v: got %+v, %v", tc, got, err)
		}
	}
	if _, err := calculatePayroll(100, payrollRates{10000, 1, 0}); err == nil {
		t.Fatal("over-withholding accepted")
	}
}

func TestFinanceAccountingPostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(sql string, args ...any) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('finance-qa','Finance QA') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('accountant@test.invalid','Бухгалтер QA') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'accountant') RETURNING id::text`, tenant, user)
	driverUser := row(`INSERT INTO users(email,display_name) VALUES('driver@test.invalid','Водитель QA') RETURNING id::text`)
	driverMember := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'driver') RETURNING id::text`, tenant, driverUser)
	driver := row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'Водитель QA','+380500000001') RETURNING id::text`, tenant, driverMember)
	stranger := row(`INSERT INTO drivers(tenant_id,full_name,phone_e164) VALUES($1,'Другой водитель','+380500000002') RETURNING id::text`, tenant)
	actor := identity{TenantID: tenant, MembershipID: member, Role: "accountant"}
	call := func(method, path string, body any, who identity, handler http.HandlerFunc, want int) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		r.SetPathValue("slug", "finance-qa")
		if strings.HasPrefix(path, "/trips/") {
			r.SetPathValue("tripID", strings.TrimPrefix(path, "/trips/"))
		}
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		handler(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, want, w.Body)
		}
		return w
	}
	requestID := func() string { return row(`SELECT gen_random_uuid()::text`) }
	op := func(input accountingOperation, want int) string {
		t.Helper()
		if input.RequestID == "" {
			input.RequestID = requestID()
		}
		w := call("POST", "/finance/operations", input, actor, app.accountingOperation, want)
		var result struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &result)
		return result.ID
	}
	call("PATCH", "/finance/settings", map[string]int{"turnoverTaxBps": 500, "incomeTaxBps": 1000, "levyTaxBps": 0, "employerTaxBps": 2000}, actor, app.accountingSettings, 200)
	cash := accountingOperation{Action: "receipt", RequestID: requestID(), Amount: 100000, Currency: "UAH", Category: "funding", Description: "Взнос в кассу"}
	first := op(cash, 201)
	if id := op(cash, 200); id != first {
		t.Fatal("retry produced a different receipt")
	}
	cash.Amount++
	op(cash, 409)
	op(accountingOperation{Action: "expense", Amount: 100001, Currency: "UAH", Category: "fuel", Source: "cash", Description: "Топливо"}, 409)
	op(accountingOperation{Action: "accrual", DriverID: driver, Amount: 10000, Currency: "UAH"}, 201)
	var gross, withheld, employer int64
	if err := db.QueryRow(ctx, `SELECT gross_minor,income_tax_minor+levy_tax_minor,employer_tax_minor FROM driver_payroll_accruals WHERE tenant_id=$1`, tenant).Scan(&gross, &withheld, &employer); err != nil {
		t.Fatal(err)
	}
	if gross != 10000 || withheld != 1000 || employer != 2000 {
		t.Fatalf("rates not frozen: %d %d %d", gross, withheld, employer)
	}
	call("PATCH", "/finance/settings", map[string]int{"turnoverTaxBps": 0, "incomeTaxBps": 0, "levyTaxBps": 0, "employerTaxBps": 0}, actor, app.accountingSettings, 200)
	op(accountingOperation{Action: "payout", DriverID: driver, Amount: 9001, Currency: "UAH", Source: "cash"}, 409)
	payout := accountingOperation{Action: "payout", RequestID: requestID(), DriverID: driver, Amount: 9000, Currency: "UAH", Source: "cash"}
	op(payout, 201)
	op(payout, 200)
	op(accountingOperation{Action: "payout", DriverID: driver, Amount: 1, Currency: "UAH", Source: "bank"}, 409)
	exec(`INSERT INTO driver_cash_ledger(tenant_id,driver_id,amount_minor,currency,kind) VALUES($1,$2,5000,'UAH','cash_collected'),($1,$3,100,'EUR','cash_collected')`, tenant, driver, stranger)
	who := identity{TenantID: tenant, MembershipID: driverMember, Role: "driver"}
	h := accountingOperation{Action: "request_handover", RequestID: requestID(), DriverID: stranger, Amount: 4000, Currency: "UAH"}
	w := call("POST", "/driver/handovers", h, who, app.accountingOperation, 201)
	var created struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &created)
	h.RequestID = requestID()
	h.Amount = 1001
	call("POST", "/driver/handovers", h, who, app.accountingOperation, 409)
	wallet := call("GET", "/driver/wallet", nil, who, app.accountingSnapshot, 200)
	if strings.Contains(wallet.Body.String(), "Другой водитель") {
		t.Fatal("driver saw another wallet")
	}
	op(accountingOperation{Action: "accept_handover", ID: created.ID}, 201)
	op(accountingOperation{Action: "accept_handover", ID: created.ID}, 200)
	var balance int64
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	balance, err = companyCash(ctx, tx, tenant, "UAH")
	tx.Rollback(ctx)
	if err != nil || balance != 95000 {
		t.Fatalf("cash balance %d %v", balance, err)
	}
	op(accountingOperation{Action: "reject_handover", ID: created.ID}, 409)
	ledger := call("GET", "/finance/ledger?from=2020-01-01&to=2020-01-02", nil, actor, app.accountingLedger, 200)
	if !strings.Contains(ledger.Body.String(), `"items":[]`) {
		t.Fatal(ledger.Body)
	}
	call("GET", "/api/v1/tenants/driver/finance/accounting", nil, actor, app.accountingSnapshot, 200)
	call("POST", "/api/v1/tenants/driver/finance/operations", accountingOperation{Action: "receipt", RequestID: requestID(), Amount: 1, Currency: "UAH", Category: "funding", Description: "Tenant route scope"}, actor, app.accountingOperation, 201)
	today := time.Now().Format("2006-01-02")
	ledger = call("GET", "/finance/ledger?from="+today+"&to="+today, nil, actor, app.accountingLedger, 200)
	if !strings.Contains(ledger.Body.String(), "payroll_payout") {
		t.Fatal(ledger.Body)
	}
	call("PATCH", "/finance/review", map[string]any{"id": "receipt:" + first, "reviewed": true, "note": "Проверено по кассе"}, actor, app.reviewFinanceEntry, 200)
	other := row(`INSERT INTO tenants(slug,name) VALUES('other-finance-qa','Other QA') RETURNING id::text`)
	foreign := row(`INSERT INTO company_cash_receipts(tenant_id,amount_minor,currency,description,request_id) VALUES($1,1,'UAH','Чужие данные',gen_random_uuid()) RETURNING id::text`, other)
	call("PATCH", "/finance/review", map[string]any{"id": "receipt:" + foreign, "reviewed": true}, actor, app.reviewFinanceEntry, 404)
	call("GET", "/finance/report?from="+today+"&to="+today, nil, actor, app.accountingReport, 200)
	resources := call("GET", "/trip-resources", nil, actor, app.listTripResources, 200)
	if strings.Contains(resources.Body.String(), stranger) {
		t.Fatal("unlinked driver offered for planning")
	}
	owner := actor
	owner.Role = "owner"
	call("POST", "/team", createTeamMemberRequest{DisplayName: "Другой водитель", Email: "linked-driver@test.invalid", Password: "qa-test-password-123", Role: "driver", DriverID: stranger, DriverPhone: "+380500000002"}, owner, app.createTeamMember, 201)
	resources = call("GET", "/trip-resources", nil, owner, app.listTripResources, 200)
	if !strings.Contains(resources.Body.String(), stranger) {
		t.Fatal("connected driver missing from planning")
	}
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'QA Bus','FIN-QA','bus',8) RETURNING id::text`, tenant)
	trip := row(`INSERT INTO trips(tenant_id,driver_id,vehicle_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,driver_pay_minor,currency) VALUES($1,$2,$3,'individual','in_progress','A','B',now()-interval '1 hour',now()+interval '1 hour',8,2000,'UAH') RETURNING id::text`, tenant, driver, vehicle)
	call("PATCH", "/trips/"+trip, changeTripStatusRequest{Status: "completed"}, who, app.changeTripStatus, 200)
	call("PATCH", "/trips/"+trip, changeTripStatusRequest{Status: "completed"}, who, app.changeTripStatus, 200)
	var salaryCount int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM driver_payroll_accruals WHERE tenant_id=$1 AND trip_id=$2`, tenant, trip).Scan(&salaryCount); err != nil || salaryCount != 1 {
		t.Fatalf("duplicate or missing trip payroll %d %v", salaryCount, err)
	}
	exec(`INSERT INTO company_cash_receipts(tenant_id,amount_minor,currency,description,request_id) SELECT $1,1,'USD','Pagination',gen_random_uuid() FROM generate_series(1,101)`, tenant)
	next := ""
	seen := map[string]bool{}
	for {
		page := call("GET", "/finance/ledger?from="+today+"&to="+today+"&currency=USD&cursor="+next, nil, actor, app.accountingLedger, 200)
		var result struct {
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
			Next string `json:"nextCursor"`
		}
		json.Unmarshal(page.Body.Bytes(), &result)
		for _, item := range result.Items {
			if seen[item.ID] {
				t.Fatal("duplicate keyset entry")
			}
			seen[item.ID] = true
		}
		next = result.Next
		if next == "" {
			break
		}
	}
	if len(seen) != 101 {
		t.Fatalf("ledger lost entries: %d", len(seen))
	}
	op(accountingOperation{Action: "tax_payment", DriverID: driver, Amount: 1000, Currency: "UAH", Source: "cash", Category: "income"}, 201)
	op(accountingOperation{Action: "tax_payment", DriverID: driver, Amount: 1, Currency: "UAH", Source: "cash", Category: "income"}, 409)
	op(accountingOperation{Action: "tax_payment", DriverID: driver, Amount: 2000, Currency: "UAH", Source: "bank", Category: "employer"}, 201)
	var expenses int64
	if err := db.QueryRow(ctx, `SELECT sum(amount_minor) FROM operational_expenses WHERE tenant_id=$1`, tenant).Scan(&expenses); err != nil || expenses != 14000 {
		t.Fatalf("tax remittance duplicated expense: %d %v", expenses, err)
	}
	// Two cashiers cannot pay the same remaining salary concurrently.
	operations := []accountingOperation{{Action: "payout", RequestID: requestID(), DriverID: driver, Amount: 2000, Currency: "UAH", Source: "cash"}, {Action: "payout", RequestID: requestID(), DriverID: driver, Amount: 2000, Currency: "UAH", Source: "cash"}}
	results := make(chan int, 2)
	for _, input := range operations {
		go func(input accountingOperation) {
			data, _ := json.Marshal(input)
			r := httptest.NewRequest("POST", "/finance/operations", bytes.NewReader(data))
			r.SetPathValue("slug", "finance-qa")
			r = r.WithContext(context.WithValue(ctx, identityContextKey{}, actor))
			w := httptest.NewRecorder()
			app.accountingOperation(w, r)
			results <- w.Code
		}(input)
	}
	statuses := map[int]int{}
	statuses[<-results]++
	statuses[<-results]++
	if statuses[201] != 1 || statuses[409] != 1 {
		t.Fatalf("concurrent payout exceeded liability: %v", statuses)
	}
	hash := sha256.Sum256([]byte("finance-accountant-test-session"))
	exec(`INSERT INTO user_sessions(user_id,membership_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')`, user, member, hash[:])
	protected := app.routes()
	for _, check := range []struct {
		path   string
		status int
	}{{"/finance/accounting", 200}, {"/finance/settings", 200}, {"/team", 403}, {"/trip-resources", 403}, {"/integration-secrets", 403}, {"/fleet", 403}} {
		r := httptest.NewRequest("GET", "/api/v1/tenants/finance-qa"+check.path, nil)
		r.Header.Set("Authorization", "Bearer finance-accountant-test-session")
		w := httptest.NewRecorder()
		protected.ServeHTTP(w, r)
		if w.Code != check.status {
			t.Fatalf("accountant %s: %d %s", check.path, w.Code, w.Body)
		}
	}
	// A failure writing audit rolls back the money operation and its retry key.
	exec(`CREATE FUNCTION reject_finance_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='finance.receipt' THEN RAISE EXCEPTION 'audit unavailable'; END IF;RETURN NEW;END $$; CREATE TRIGGER reject_finance_audit BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION reject_finance_audit()`)
	failed := accountingOperation{Action: "receipt", RequestID: requestID(), Amount: 123, Currency: "UAH", Category: "income", Description: "Не записывать"}
	op(failed, 503)
	var count int
	db.QueryRow(ctx, `SELECT count(*) FROM company_cash_receipts WHERE tenant_id=$1 AND request_id=$2`, tenant, failed.RequestID).Scan(&count)
	if count != 0 {
		t.Fatal("money persisted without audit")
	}
}

func TestBankStatementManagedFOPPostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	var tenant string
	if err := db.QueryRow(ctx, `INSERT INTO tenants(slug,name) VALUES('bank-qa','Bank QA') RETURNING id::text`).Scan(&tenant); err != nil {
		t.Fatal(err)
	}
	var payment, booking string
	if err := db.QueryRow(ctx, `WITH customer AS (INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Bank passenger','+380500002020') RETURNING id),trip AS (INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual','planned','A','B',now()+interval '1 day',now()+interval '2 days',8,'UAH') RETURNING id),booking AS (INSERT INTO bookings(tenant_id,customer_id,trip_id,status,seats,price_minor,currency,payment_hold_expires_at) SELECT $1,c.id,t.id,'awaiting_payment',1,5000,'UAH',now()+interval '20 minutes' FROM customer c,trip t RETURNING id) INSERT INTO payments(tenant_id,booking_id,provider,payment_method,status,amount_minor,currency,idempotency_key) SELECT $1,id,'internal','bank_transfer','pending',5000,'UAH','bank-qa-payment' FROM booking RETURNING id::text,booking_id::text`, tenant).Scan(&payment, &booking); err != nil {
		t.Fatal(err)
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Token") != "private-token" {
			t.Error("missing auth")
		}
		if r.URL.Path == "/personal/client-info" {
			io.WriteString(w, `{"accounts":[],"managedClients":[{"accounts":[{"id":"fop","iban":"UA123","currencyCode":980,"balance":5000}]}]}`)
			return
		}
		calls++
		json.NewEncoder(w).Encode([]bankTransaction{{ID: "statement-1", Amount: 5000, Balance: 5000, Time: time.Now().Unix() - 1, Description: ibanpayment.Reference(payment)}, {ID: "statement-2", Amount: -300, Balance: 4700, Time: time.Now().Unix(), Description: "Fee"}})
	}))
	defer server.Close()
	app := &application{db: db, bankBaseURL: server.URL, bankHTTPClient: server.Client(), log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := app.syncBank(ctx, tenant, "private-token", "UA123"); err != nil {
		t.Fatal(err)
	}
	if err := app.syncBank(ctx, tenant, "private-token", "UA123"); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("bank rate limit bypassed")
	}
	db.Exec(ctx, `UPDATE payment_reconciliation_state SET last_attempt_at=now()-interval '70 seconds' WHERE tenant_id=$1`, tenant)
	if err := app.syncBank(ctx, tenant, "private-token", "UA123"); err != nil {
		t.Fatal(err)
	}
	var count int
	var balance int64
	if err := db.QueryRow(ctx, `SELECT count(*) FROM bank_statement_transactions WHERE tenant_id=$1`, tenant).Scan(&count); err != nil || count != 2 {
		t.Fatalf("duplicate statement rows %d %v", count, err)
	}
	if err := db.QueryRow(ctx, `SELECT bank_balance_minor FROM payment_reconciliation_state WHERE tenant_id=$1`, tenant).Scan(&balance); err != nil || balance != 4700 {
		t.Fatalf("bank balance %d %v", balance, err)
	}
	var status string
	if err := db.QueryRow(ctx, `SELECT status FROM bookings WHERE tenant_id=$1 AND id=$2`, tenant, booking).Scan(&status); err != nil || status != "confirmed" {
		t.Fatalf("bank payment not reconciled: %s %v", status, err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM finance_ledger_entries WHERE tenant_id=$1 AND (entry_id LIKE 'bank:%' OR entry_id LIKE 'payment:%')`, tenant).Scan(&count); err != nil || count != 2 {
		t.Fatalf("reconciled payment duplicated ledger: %d %v", count, err)
	}
}
