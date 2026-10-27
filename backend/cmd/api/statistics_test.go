package main

import (
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

func TestStatisticsCivilDateRange(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Kyiv")
	if err != nil {
		t.Fatal(err)
	}
	today := time.Date(2026, 10, 27, 0, 0, 0, 0, loc)
	for _, tc := range []struct {
		query string
		valid bool
		days  int
	}{
		{"", true, 27}, {"?from=2026-03-28&to=2026-03-30", true, 3}, {"?from=2026-10-24&to=2026-10-26", true, 3},
		{"?from=2024-01-01&to=2024-12-31", true, 366}, {"?from=2024-01-01&to=2025-01-01", false, 0},
		{"?from=2026-02-30", false, 0}, {"?from=2026-10-28&to=2026-10-27", false, 0}, {"?from=1899-01-01", false, 0},
	} {
		a, b, valid := statisticsRange(httptest.NewRequest("GET", "/"+tc.query, nil), today)
		if valid != tc.valid || valid && statisticsDays(a, b) != tc.days {
			t.Fatalf("%s: %v %s %s", tc.query, valid, a, b)
		}
	}
}

func TestStatisticsPostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	t.Cleanup(func() { cache.Close() })
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
	tenant := row(`INSERT INTO tenants(slug,name,timezone,base_currency,subscription_status) VALUES('statistics-qa','Statistics QA','Europe/Kyiv','UAH','active') RETURNING id::text`)
	foreign := row(`INSERT INTO tenants(slug,name) VALUES('statistics-other','Other') RETURNING id::text`)
	driver := row(`INSERT INTO drivers(tenant_id,full_name,phone_e164) VALUES($1,'QA Driver','+380500001001') RETURNING id::text`, tenant)
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'QA Passenger','+380500001002') RETURNING id::text`, tenant)
	trip := row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency) VALUES($1,'regular','completed','Киев','Львов','2026-10-25 07:00Z','2026-10-25 12:00Z',10,10000,'UAH') RETURNING id::text`, tenant)
	exec(`INSERT INTO workflow_statuses(tenant_id,entity_type,key,label,tone,semantic_phase) VALUES($1,'bookings','qa_done','Выполнена QA','success','completed')`, tenant)
	booking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,price_minor,currency,source,created_at) VALUES($1,$2,$3,'qa_done',3,10000,'UAH','web','2026-10-24 21:30Z') RETURNING id::text`, tenant, trip, customer)
	exec(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,price_minor,currency,source,created_at) VALUES($1,$2,$3,'cancelled',2,10000,'EUR','telegram','2026-10-25 08:00Z'),($1,$2,$3,'confirmed',1,10000,'UAH','dispatcher','2026-10-23 08:00Z')`, tenant, trip, customer)
	// Recognize payment once, refund on its own date, and keep currencies separate.
	exec(`INSERT INTO payments(tenant_id,booking_id,provider,status,amount_minor,currency,idempotency_key,paid_at,updated_at) VALUES($1,$2,'internal','paid',10000,'UAH','stats-paid','2026-10-25 10:00Z','2026-10-25 10:00Z'),($1,$2,'internal','refunded',3000,'UAH','stats-refund','2026-10-23 10:00Z','2026-10-25 11:00Z'),($1,$2,'internal','paid',9000,'EUR','stats-eur','2026-10-25 10:00Z','2026-10-25 10:00Z')`, tenant, booking)
	exec(`INSERT INTO driver_cash_ledger(tenant_id,driver_id,kind,amount_minor,currency,occurred_at) VALUES($1,$2,'cash_collected',5000,'UAH','2026-10-25 12:00Z'),($1,$2,'collection',-2000,'UAH','2026-10-25 13:00Z')`, tenant, driver)
	exec(`INSERT INTO company_cash_receipts(tenant_id,amount_minor,currency,description,request_id,kind,occurred_at) VALUES($1,2000,'UAH','QA income',gen_random_uuid(),'income','2026-10-25 12:00Z'),($1,99000,'UAH','QA funding',gen_random_uuid(),'funding','2026-10-25 13:00Z')`, tenant)
	expense := row(`INSERT INTO operational_expenses(tenant_id,category,amount_minor,currency,occurred_at) VALUES($1,'driver_pay',4000,'UAH','2026-10-25 12:00Z') RETURNING id::text`, tenant)
	exec(`INSERT INTO driver_payroll_accruals(tenant_id,driver_id,expense_id,gross_minor,currency,occurred_at) VALUES($1,$2,$3,4000,'UAH','2026-10-25 12:00Z')`, tenant, driver, expense)
	exec(`INSERT INTO driver_payroll_payouts(tenant_id,driver_id,amount_minor,currency,payment_source,request_id,occurred_at) VALUES($1,$2,4000,'UAH','cash',gen_random_uuid(),'2026-10-25 13:00Z')`, tenant, driver)
	exec(`INSERT INTO company_cash_receipts(tenant_id,amount_minor,currency,description,request_id,kind,occurred_at) VALUES($1,999999,'UAH','Other tenant',gen_random_uuid(),'income','2026-10-25 12:00Z')`, foreign)
	router := app.routes()
	call := func(role, slug, query string, want int) statisticsResponse {
		t.Helper()
		user := row(`INSERT INTO users(email,display_name) VALUES(gen_random_uuid()::text||'@test.invalid','QA') RETURNING id::text`)
		member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3::membership_role) RETURNING id::text`, tenant, user, role)
		session, err := app.createSession(ctx, identity{UserID: user, MembershipID: member, TenantID: tenant, TenantSlug: "statistics-qa", Role: role})
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest("GET", "/api/v1/tenants/"+slug+"/statistics"+query, nil)
		r.Header.Set("Authorization", "Bearer "+session.SessionToken)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s: %d %s", role, w.Code, w.Body.String())
		}
		var out statisticsResponse
		if want == 200 {
			if err = json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
		}
		return out
	}
	query := "?from=2026-10-25&to=2026-10-25&currency=UAH"
	result := call("developer", "statistics-qa", query, 200)
	if result.Metrics.Bookings != 2 || result.Metrics.Passengers != 3 || result.Metrics.Confirmed != 1 || result.Metrics.Cancelled != 1 || result.Metrics.Trips != 1 || result.Metrics.Capacity != 10 || result.Metrics.OccupiedSeats != 4 {
		t.Fatalf("metrics %+v", result.Metrics)
	}
	if result.Finance == nil || result.Finance.Totals.Revenue != 14000 || result.Finance.Totals.Expenses != 4000 || result.Finance.Totals.Refunds != 3000 {
		t.Fatalf("money %+v", result.Finance)
	}
	if len(result.Daily) != 1 || result.Daily[0].Date != "2026-10-25" || len(result.Statuses) != 2 || len(result.Sources) != 2 {
		t.Fatalf("dates/statuses %+v", result)
	}
	euro := call("accountant", "statistics-qa", "?from=2026-10-25&to=2026-10-25&currency=EUR", 200)
	if euro.Finance.Totals.Revenue != 9000 || euro.Finance.Totals.Expenses != 0 || euro.Metrics.Bookings != 2 {
		t.Fatal("currencies were mixed")
	}
	dispatcher := call("dispatcher", "statistics-qa", query, 200)
	if dispatcher.Finance != nil {
		t.Fatal("dispatcher saw financials")
	}
	empty := call("owner", "statistics-qa", "?from=2026-03-28&to=2026-03-30", 200)
	if len(empty.Daily) != 3 || empty.Metrics.Bookings != 0 || empty.Finance.Totals.Revenue != 0 {
		t.Fatal("empty DST dates not padded correctly")
	}
	call("driver", "statistics-qa", query, 403)
	call("developer", "statistics-other", query, 403)
	call("developer", "statistics-qa", "?currency=XXX", 400)
	call("developer", "statistics-qa", "?from=2026-10-26&to=2026-10-25", 400)
}
