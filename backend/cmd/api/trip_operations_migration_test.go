package main

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestTripOperationsMigration(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	row := func(q string, args ...any) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, q, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	down, err := os.ReadFile("../../migrations/000053_trip_operations.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(down))
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('trip-migration-qa','Migration QA') RETURNING id::text`)
	vehicle := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Migration bus','MIG-53','bus',8) RETURNING id::text`, tenant)
	makeTrip := func(status string, capacity int) string {
		return row(`INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual',$2,'A','B',now()+interval '1 day',now()+interval '2 days',$3,'EUR') RETURNING id::text`, tenant, status, capacity)
	}
	plain := makeTrip("delayed", 8)
	boarded := makeTrip("delayed", 8)
	moving := makeTrip("in_progress_delayed", 8)
	actual := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond)
	exec(`UPDATE trips SET actual_started_at=$2 WHERE id=$1`, moving, actual)
	exec(`INSERT INTO activity_events(tenant_id,actor_kind,action,entity_type,entity_id,details,created_at) VALUES($1,'human','record_updated','trips',$2,'{"changes":[{"field":"status","before":"assigned","after":"boarding"}]}',$3)`, tenant, boarded, actual)
	repair := makeTrip("assigned", 9)
	exec(`UPDATE trips SET vehicle_id=$2 WHERE id=$1`, repair, vehicle)
	reduced := makeTrip("assigned", 6)
	booked := makeTrip("assigned", 9)
	historical := makeTrip("completed", 9)
	// Distinct vehicles keep the schedule constraint independent of seat policy.
	for _, id := range []string{reduced, booked, historical} {
		v := row(`INSERT INTO vehicles(tenant_id,name,registration_number,vehicle_class,capacity) VALUES($1,'Other migration bus',$2,'bus',8) RETURNING id::text`, tenant, id)
		exec(`UPDATE trips SET vehicle_id=$2 WHERE id=$1`, id, v)
	}
	customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Migration passenger','+301') RETURNING id::text`, tenant)
	exec(`INSERT INTO bookings(tenant_id,trip_id,customer_id,status,seats,currency) VALUES($1,$2,$3,'cash_on_boarding',9,'EUR')`, tenant, booked, customer)
	up, err := os.ReadFile("../../migrations/000053_trip_operations.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(up))
	for id, want := range map[string]string{plain: "assigned", boarded: "boarding", moving: "in_progress"} {
		if got := row(`SELECT status FROM trips WHERE id=$1`, id); got != want {
			t.Fatal("wrong legacy stage", got, want)
		}
	}
	for id, want := range map[string]string{repair: "8", reduced: "6", booked: "9", historical: "9"} {
		if got := row(`SELECT capacity::text FROM trips WHERE id=$1`, id); got != want {
			t.Fatal("migration changed seat policy", got, want)
		}
	}
	var boardingAt, departedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT actual_boarding_started_at,actual_started_at FROM trips WHERE id=$1`, boarded).Scan(&boardingAt, &departedAt); err != nil || boardingAt == nil || !boardingAt.Equal(actual) || departedAt != nil {
		t.Fatal("boarding history was invented or lost", err)
	}
	if err := db.QueryRow(ctx, `SELECT actual_boarding_started_at,actual_started_at FROM trips WHERE id=$1`, plain).Scan(&boardingAt, &departedAt); err != nil || boardingAt != nil || departedAt != nil {
		t.Fatal("delay invented actual timestamps", err)
	}
	if got := row(`SELECT count(*)::text FROM activity_events WHERE tenant_id=$1 AND details->'changes' @> '[{"field":"capacity","before":9,"after":8}]'::jsonb`, tenant); got != "1" {
		t.Fatal("capacity correction not journaled", got)
	}
}
