package main

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vivat-bus/tms/internal/ibanpayment"
)

// A payment request can wait behind another dispatcher for longer than the
// remaining seat hold. PostgreSQL now() stays frozen at transaction start.
func TestPaymentHoldExpiresWhileWaitingPostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(t *testing.T, q string, args ...any) string {
		t.Helper()
		var result string
		if err := db.QueryRow(ctx, q, args...).Scan(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	tenantID := row(t, `INSERT INTO tenants(slug,name) VALUES('hold-race','Hold race QA') RETURNING id::text`)
	tripID := row(t, `INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'regular','assigned','A','B',now()+interval '1 day',now()+interval '2 days',4,'UAH') RETURNING id::text`, tenantID)
	for _, path := range []string{"bank reconciliation", "manual confirmation"} {
		t.Run(path, func(t *testing.T) {
			customer := row(t, `INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Hold QA',$2) RETURNING id::text`, tenantID, "+38050000800"+map[string]string{"bank reconciliation": "1", "manual confirmation": "2"}[path])
			booking := row(t, `INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,price_minor,currency,payment_hold_expires_at) VALUES($1,$2,$3,'awaiting_payment',1,5000,'UAH',now()+interval '10 minutes') RETURNING id::text`, tenantID, tripID, customer)
			payment := row(t, `INSERT INTO payments(tenant_id,booking_id,provider,status,payment_method,amount_minor,currency,idempotency_key) VALUES($1,$2,'internal','pending','bank_transfer',5000,'UAH',$3) RETURNING id::text`, tenantID, booking, booking)
			blocker, err := db.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer blocker.Rollback(context.Background())
			var pid int
			if err := blocker.QueryRow(ctx, `SELECT pg_backend_pid() FROM bookings WHERE id=$1 FOR UPDATE`, booking).Scan(&pid); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			response := httptest.NewRecorder()
			go func() {
				if path == "manual confirmation" {
					r := httptest.NewRequest("POST", "/", nil).WithContext(ctx)
					r.SetPathValue("slug", "hold-race")
					r.SetPathValue("bookingID", booking)
					app.confirmBookingPayment(response, r)
					done <- nil
					return
				}
				tx, err := db.Begin(ctx)
				if err == nil {
					defer tx.Rollback(context.Background())
					err = app.matchBankPayment(ctx, tx, tenantID, bankTransaction{ID: "expired-credit", Amount: 5000, Time: time.Now().Unix(), Description: ibanpayment.Purpose(payment)})
					if err == nil {
						err = tx.Commit(ctx)
					}
				}
				done <- err
			}()
			deadline := time.Now().Add(3 * time.Second)
			for {
				var waiting bool
				if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, pid).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("payment request did not wait for the booking lock")
				}
				time.Sleep(10 * time.Millisecond)
			}
			if _, err := blocker.Exec(ctx, `UPDATE bookings SET payment_hold_expires_at=clock_timestamp()-interval '1 millisecond' WHERE id=$1`, booking); err != nil {
				t.Fatal(err)
			}
			if err := blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			if path == "manual confirmation" && response.Code != 409 {
				t.Fatalf("expired manual confirmation returned %d: %s", response.Code, response.Body)
			}
			if got := row(t, `SELECT b.status||':'||p.status FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.id=$1`, booking); got != "awaiting_payment:pending" {
				t.Fatalf("expired hold was confirmed after waiting: %s", got)
			}
			if got := row(t, `SELECT count(*)::text FROM activity_events WHERE tenant_id=$1 AND action='payment.reconciled'`, tenantID); got != "0" {
				t.Fatal("expired hold generated a payment confirmation activity")
			}
		})
	}
}
