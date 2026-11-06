package main

import (
	"context"
	"testing"
	"time"
)

func TestTripTimingReadOnlyPostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	var tenant string
	if err := db.QueryRow(ctx, `INSERT INTO tenants(slug,name) VALUES('timing-check','Timing check') RETURNING id::text`).Scan(&tenant); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Minute)
	makeTrip := func(status string, start, end time.Time) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, `INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual',$2,'A','B',$3,$4,8,'EUR') RETURNING id::text`, tenant, status, start, end).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	future := makeTrip("assigned", now.Add(time.Hour), now.Add(2*time.Hour))
	boarding := makeTrip("boarding", now.Add(-20*time.Minute), now.Add(time.Hour))
	moving := makeTrip("in_progress", now.Add(-2*time.Hour), now.Add(-20*time.Minute))
	completed := makeTrip("completed", now.Add(-2*time.Hour), now.Add(-time.Hour))
	if _, err := db.Exec(ctx, `UPDATE trips SET actual_started_at=$2,actual_completed_at=$3 WHERE id=$1`, completed, now.Add(-100*time.Minute), now.Add(-55*time.Minute)); err != nil {
		t.Fatal(err)
	}
	ids := []string{future, boarding, moving, completed}
	for range 2 {
		ops, err := readTripOperations(ctx, db, tenant, ids)
		if err != nil {
			t.Fatal(err)
		}
		if !ops[future].BeforeDeparture || ops[future].DepartureDelayed || ops[future].AllPassengersBoarded {
			t.Fatal("empty future trip must need early approval")
		}
		if !ops[boarding].DepartureDelayed || ops[boarding].DepartureDelayMinutes < 20 || ops[boarding].ArrivalDelayed {
			t.Fatal("boarding delay must be independent of stage")
		}
		if !ops[moving].ArrivalDelayed {
			t.Fatal("late arrival not computed")
		}
		if ops[completed].DepartureDelayMinutes != 20 || ops[completed].ArrivalDelayMinutes != 5 || ops[completed].ArrivalDelayed {
			t.Fatal("historical timing must use actual timestamps")
		}
	}
	for id, want := range map[string]string{future: "assigned", boarding: "boarding", moving: "in_progress", completed: "completed"} {
		var got string
		if err := db.QueryRow(ctx, `SELECT status FROM trips WHERE id=$1`, id).Scan(&got); err != nil || got != want {
			t.Fatal("reading timing mutated stage", got, err)
		}
	}
	var events int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM activity_events WHERE tenant_id=$1`, tenant).Scan(&events); err != nil || events != 0 {
		t.Fatal("reading delay invented activity", events, err)
	}
}
