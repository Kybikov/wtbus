package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestTripCrewPostgres(t *testing.T) {
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
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('crew-test','Crew') RETURNING id::text`)
	foreign := row(`INSERT INTO tenants(slug,name) VALUES('crew-other','Other') RETURNING id::text`)
	member := func(name, company, role string) string {
		u := row(`INSERT INTO users(email,display_name) VALUES($1,$2) RETURNING id::text`, name+"@crew.invalid", name)
		return row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) RETURNING id::text`, company, u, role)
	}
	owner := member("owner", tenant, "owner")
	first := member("first", tenant, "driver")
	second := member("second", tenant, "driver")
	manager := member("manager", tenant, "dispatcher")
	outsider := member("outsider", foreign, "driver")
	driver := row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'First','+380500001001') RETURNING id::text`, tenant, first)
	trip := row(`INSERT INTO trips(tenant_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency,driver_pay_minor) VALUES($1,$2,'regular','new','Kyiv','Berlin',now()+interval '1 day',now()+interval '2 days',8,10000,'EUR',10000) RETURNING id::text`, tenant, driver)
	actor := identity{TenantID: tenant, TenantSlug: "crew-test", MembershipID: owner, Role: "owner"}
	call := func(method string, body any, who identity) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/", bytes.NewReader(raw))
		r.SetPathValue("slug", "crew-test")
		r.SetPathValue("tripID", trip)
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		app.tripCrew(w, r)
		return w
	}
	patch := func(data map[string]any) {
		t.Helper()
		w := call("PATCH", data, actor)
		if w.Code != 200 {
			t.Fatalf("patch %d: %s", w.Code, w.Body)
		}
	}
	can := func(m, cap string, want bool) {
		t.Helper()
		got, err := tripCrewCan(ctx, db, tenant, trip, m, cap)
		if err != nil || got != want {
			t.Fatalf("capability %s/%s=%v want %v: %v", m, cap, got, want, err)
		}
	}
	can(first, "gps", true)
	patch(map[string]any{"membershipId": second, "role": "driver", "canDrive": true, "canBoard": true, "canGPS": true, "payMinor": 5000, "payCurrency": "EUR"})
	can(first, "gps", false)
	can(second, "gps", true)
	can(first, "drive", true)
	patch(map[string]any{"membershipId": manager, "role": "manager", "canCollect": true, "canBoard": true, "payMinor": 2000, "payCurrency": "PLN"})
	can(manager, "collect", true)
	can(manager, "drive", false)
	can(manager, "gps", false)
	can(outsider, "read", false)
	if w := call("PATCH", map[string]any{"membershipId": outsider, "role": "driver"}, actor); w.Code != 400 {
		t.Fatalf("foreign member: %d", w.Code)
	}
	if w := call("PATCH", map[string]any{"membershipId": manager, "canGPS": true}, actor); w.Code != 400 {
		t.Fatalf("manager GPS: %d", w.Code)
	}
	who := identity{TenantID: tenant, TenantSlug: "crew-test", MembershipID: second, Role: "driver"}
	w := call("GET", nil, who)
	var manifest struct {
		Eligible []any            `json:"eligibleMembers"`
		Items    []tripCrewMember `json:"items"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &manifest) != nil || len(manifest.Eligible) != 0 || len(manifest.Items) != 3 {
		t.Fatalf("staff roster: %d %s", w.Code, w.Body)
	}
	if w = call("PATCH", map[string]any{"membershipId": manager, "canManage": true}, who); w.Code != 403 {
		t.Fatalf("staff changed crew: %d", w.Code)
	}
	exec(`UPDATE memberships SET is_active=false WHERE id=$1`, manager)
	can(manager, "collect", false)
	exec(`UPDATE memberships SET is_active=true WHERE id=$1`, manager)
	patch(map[string]any{"membershipId": second, "canCollect": true})
	var preserved bool
	if err := db.QueryRow(ctx, `SELECT can_board AND can_drive AND can_gps AND can_collect FROM trip_crew WHERE trip_id=$1 AND membership_id=$2`, trip, second).Scan(&preserved); err != nil || !preserved {
		t.Fatalf("partial update erased capabilities: %v", err)
	}
	// Legacy fallback is available only if no explicit row revokes that assignment.
	exec(`DELETE FROM trip_crew WHERE trip_id=$1 AND membership_id=$2`, trip, first)
	can(first, "drive", true)
	exec(`UPDATE trips SET driver_id=NULL WHERE id=$1`, trip)
	exec(`UPDATE trips SET driver_id=$2 WHERE id=$1`, trip, driver)
	patch(map[string]any{"membershipId": first, "role": "driver", "canDrive": true, "payMinor": 10000})
	owns, err := tripCrewOwnsPrimaryPayroll(ctx, db, tenant, trip)
	if err != nil || !owns {
		t.Fatalf("custom primary ownership: %v %v", owns, err)
	}
	exec(`UPDATE trips SET status='completed' WHERE id=$1`, trip)
	for i := 0; i < 2; i++ {
		tx, err := db.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err = app.accrueTripCrewPay(ctx, tx, tenant, trip, actor); err != nil {
			tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err = tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err = db.QueryRow(ctx, `SELECT count(*) FROM crew_payroll_accruals WHERE trip_id=$1`, trip).Scan(&count); err != nil || count != 3 {
		t.Fatalf("pay once per member: %d %v", count, err)
	}
	if err = db.QueryRow(ctx, `SELECT count(*) FROM operational_expenses WHERE trip_id=$1 AND source_key LIKE 'crew-pay:%'`, trip).Scan(&count); err != nil || count != 3 {
		t.Fatalf("expense once per member: %d %v", count, err)
	}
	if w = call("PATCH", map[string]any{"membershipId": manager, "payMinor": 4000}, actor); w.Code != 409 {
		t.Fatalf("closed payroll edited: %d", w.Code)
	}

	// A manager without a driver profile can receive a partial salary payment.
	accrual := row(`SELECT id::text FROM crew_payroll_accruals WHERE trip_id=$1 AND membership_id=$2`, trip, manager)
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := moneyAccount(ctx, tx, tenant, "company", tenant, "PLN")
	if err != nil {
		t.Fatal(err)
	}
	system, err := moneyAccount(ctx, tx, tenant, "system", tenant, "PLN")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = moneyPost(ctx, tx, actor, "opening", "crew-test-opening", "Opening", "", "", time.Now(), map[string]int64{wallet: 3000, system: -3000}); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	payout := func(body any, who identity) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest("POST", "/", bytes.NewReader(raw))
		r.SetPathValue("slug", "crew-test")
		r = r.WithContext(context.WithValue(ctx, identityContextKey{}, who))
		w := httptest.NewRecorder()
		app.crewPayroll(w, r)
		return w
	}
	requestID := row(`SELECT gen_random_uuid()::text`)
	pay := map[string]any{"accrualId": accrual, "accountId": wallet, "amountMinor": 1000, "requestId": requestID}
	for i := 0; i < 2; i++ {
		if w = payout(pay, actor); w.Code != 200 {
			t.Fatalf("manager payout %d: %s", w.Code, w.Body)
		}
	}
	if err = db.QueryRow(ctx, `SELECT count(*) FROM crew_payroll_payouts WHERE accrual_id=$1`, accrual).Scan(&count); err != nil || count != 1 {
		t.Fatalf("payout idempotency %d %v", count, err)
	}
	pay["amountMinor"] = 1500
	if w = payout(pay, actor); w.Code != 409 {
		t.Fatalf("idempotency payload changed: %d", w.Code)
	}
	pay["requestId"] = row(`SELECT gen_random_uuid()::text`)
	if w = payout(pay, actor); w.Code != 400 {
		t.Fatalf("overpaid manager salary: %d", w.Code)
	}
	if w = payout(pay, who); w.Code != 403 {
		t.Fatalf("driver paid salary: %d", w.Code)
	}
	if err = db.QueryRow(ctx, `SELECT count(*) FROM operational_expenses WHERE trip_id=$1 AND source_key LIKE 'crew-pay:%'`, trip).Scan(&count); err != nil || count != 3 {
		t.Fatalf("payout charged profit twice: %d %v", count, err)
	}
	// Existing trips gain their primary assignment when a driver is linked later.
	lateMember := member("late", tenant, "driver")
	lateDriver := row(`INSERT INTO drivers(tenant_id,full_name,phone_e164) VALUES($1,'Late','+380500001099') RETURNING id::text`, tenant)
	lateTrip := row(`INSERT INTO trips(tenant_id,driver_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency,driver_pay_minor) VALUES($1,$2,'regular','new','Kyiv','Berlin',now()+interval '5 days',now()+interval '6 days',8,10000,'EUR',8000) RETURNING id::text`, tenant, lateDriver)
	exec(`UPDATE drivers SET membership_id=$2 WHERE id=$1`, lateDriver, lateMember)
	allowed, err := tripCrewCan(ctx, db, tenant, lateTrip, lateMember, "drive")
	if err != nil || !allowed {
		t.Fatalf("late legacy linkage: %v %v", allowed, err)
	}
	exec(`UPDATE trips SET status='completed' WHERE id=$1`, lateTrip)
	tx, err = db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = app.accrueTripCrewPay(ctx, tx, tenant, lateTrip, actor); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(ctx, `SELECT count(*) FROM crew_payroll_accruals WHERE trip_id=$1`, lateTrip).Scan(&count); err != nil || count != 0 {
		t.Fatalf("legacy primary accrued twice: %d %v", count, err)
	}
	// Operational deletion retains immutable payroll references and money history.
	removedTrip := row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency) VALUES($1,'regular','completed','A','B',now()+interval '8 days',now()+interval '9 days',8,10000,'EUR') RETURNING id::text`, tenant)
	exec(`INSERT INTO trip_crew(tenant_id,trip_id,membership_id,role,pay_minor,pay_currency) VALUES($1,$2,$3,'manager',3000,'EUR')`, tenant, removedTrip, manager)
	tx, err = db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = app.accrueTripCrewPay(ctx, tx, tenant, removedTrip, actor); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	retainedAccrual := row(`SELECT id::text FROM crew_payroll_accruals WHERE trip_id=$1`, removedTrip)
	retainedExpense := row(`SELECT expense_id::text FROM crew_payroll_accruals WHERE id=$1`, retainedAccrual)
	exec(`DELETE FROM trips WHERE tenant_id=$1 AND id=$2`, tenant, removedTrip)
	if err = db.QueryRow(ctx, `SELECT count(*) FROM trip_crew WHERE trip_id=$1`, removedTrip).Scan(&count); err != nil || count != 0 {
		t.Fatalf("operational crew did not cascade: %d %v", count, err)
	}
	exec(`DELETE FROM operational_expenses WHERE tenant_id=$1 AND id=$2`, tenant, retainedExpense)
	if got := row(`SELECT trip_id::text||':'||expense_id::text FROM crew_payroll_accruals WHERE id=$1`, retainedAccrual); got != removedTrip+":"+retainedExpense {
		t.Fatalf("historical payroll reference changed: %s", got)
	}
	if err = db.QueryRow(ctx, `SELECT count(*) FROM money_journal WHERE tenant_id=$1 AND source_key='operational_expenses:'||$2::text`, tenant, retainedExpense).Scan(&count); err != nil || count != 1 {
		t.Fatalf("financial history deleted with operational expense: %d %v", count, err)
	}
	if _, err = db.Exec(ctx, `UPDATE crew_payroll_accruals SET gross_minor=1 WHERE id=$1`, retainedAccrual); err == nil {
		t.Fatal("retained payroll became editable after operational deletion")
	}
	exec(`DELETE FROM memberships WHERE tenant_id=$1 AND id=$2`, tenant, manager)
	if err = db.QueryRow(ctx, `SELECT count(*) FROM crew_payroll_accruals WHERE membership_id=$1`, manager).Scan(&count); err != nil || count != 2 {
		t.Fatalf("member removal discarded payroll: %d %v", count, err)
	}
	if err = db.QueryRow(ctx, `SELECT count(*) FROM crew_payroll_payouts WHERE accrual_id=$1`, accrual).Scan(&count); err != nil || count != 1 {
		t.Fatalf("member removal discarded payouts: %d %v", count, err)
	}
}
