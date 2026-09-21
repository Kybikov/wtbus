package main

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestExpiredBookingIsAttributedToSystemActor(t *testing.T) {
	databaseURL := os.Getenv("AUTOMATION_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set AUTOMATION_TEST_DATABASE_URL to a migrated disposable database")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	suffix := time.Now().UnixNano()
	slug := fmt.Sprintf("automation-test-%d", suffix)
	var tenantID, systemUserID, systemMembershipID, tripID, customerID, bookingID string
	row := func(query string, destination *string, arguments ...any) {
		t.Helper()
		if err := db.QueryRow(ctx, query, arguments...).Scan(destination); err != nil {
			t.Fatal(err)
		}
	}
	row(`INSERT INTO tenants(slug,name) VALUES($1,'Automation Test') RETURNING id::text`, &tenantID, slug)
	defer func() {
		if _, err := db.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenantID); err != nil {
			t.Error(err)
		}
		if systemUserID != "" {
			if _, err := db.Exec(ctx, `DELETE FROM users WHERE id=$1`, systemUserID); err != nil {
				t.Error(err)
			}
		}
	}()
	row(`INSERT INTO users(email,display_name,is_system) VALUES($1,'Vivat Pilot',true) RETURNING id::text`, &systemUserID, fmt.Sprintf("automation-%d@test.invalid", suffix))
	row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin') RETURNING id::text`, &systemMembershipID, tenantID, systemUserID)
	row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'regular','new','A','B',now()+interval '1 day',now()+interval '1 day 2 hours',8,'EUR') RETURNING id::text`, &tripID, tenantID)
	row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Passenger',$2) RETURNING id::text`, &customerID, tenantID, fmt.Sprintf("+3805%08d", suffix%100000000))
	row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,price_minor,currency,source,payment_hold_expires_at) VALUES($1,$2,$3,'awaiting_payment',1,1200,'EUR','telegram',now()-interval '1 minute') RETURNING id::text`, &bookingID, tenantID, tripID, customerID)
	if _, err := db.Exec(ctx, `INSERT INTO payments(tenant_id,booking_id,provider,status,amount_minor,currency,idempotency_key) VALUES($1,$2,'internal_iban','pending',1200,'EUR',$3)`, tenantID, bookingID, fmt.Sprintf("automation-%d", suffix)); err != nil {
		t.Fatal(err)
	}

	if err := expireBookingHoldsWith(ctx, db, tenantID, systemMembershipID); err != nil {
		t.Fatal(err)
	}
	var bookingStatus, paymentStatus, actorID, action string
	if err := db.QueryRow(ctx, `SELECT b.status::text,p.status::text FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.id=$1`, bookingID).Scan(&bookingStatus, &paymentStatus); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `SELECT actor_membership_id::text,action FROM activity_events WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, tenantID).Scan(&actorID, &action); err != nil {
		t.Fatal(err)
	}
	if bookingStatus != "expired" || paymentStatus != "cancelled" {
		t.Fatalf("statuses = %s/%s, want expired/cancelled", bookingStatus, paymentStatus)
	}
	if actorID != systemMembershipID || action != "booking.holds.expired" {
		t.Fatalf("activity actor/action = %s/%s", actorID, action)
	}
}
