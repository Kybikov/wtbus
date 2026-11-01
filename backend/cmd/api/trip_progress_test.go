package main

import (
	"context"
	"testing"
	"time"
)

func TestTripDelayProgressPostgres(t *testing.T) {
	db := deliveryTestDatabase(t)
	ctx := context.Background()
	app := &application{db: db}
	var tenant string
	if err := db.QueryRow(ctx, `INSERT INTO tenants(slug,name) VALUES('delay-check','Delay check') RETURNING id::text`).Scan(&tenant); err != nil {
		t.Fatal(err)
	}
	// Statuses are normally seeded from existing companies; isolated tests explicitly seed this one too.
	_, err := db.Exec(ctx, `INSERT INTO workflow_statuses(tenant_id,entity_type,key,label,semantic_phase) VALUES($1,'trips','in_progress_delayed','В пути · задержка','in_progress') ON CONFLICT DO NOTHING`, tenant)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2030, 12, 1, 12, 0, 0, 0, time.UTC)
	makeTrip := func(status string, start, end time.Time) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, `INSERT INTO trips(tenant_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'individual',$2,'A','B',$3,$4,8,'EUR') RETURNING id::text`, tenant, status, start, end).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	future := makeTrip("assigned", now.Add(time.Hour), now.Add(2*time.Hour))
	onTime := makeTrip("boarding", now.Add(-14*time.Minute), now.Add(time.Hour))
	late := makeTrip("boarding", now.Add(-15*time.Minute), now.Add(time.Hour))
	moving := makeTrip("in_progress", now.Add(-2*time.Hour), now.Add(-15*time.Minute))
	completed := makeTrip("completed", now.Add(-2*time.Hour), now.Add(-time.Hour))
	if err = app.updateTripDelays(ctx, now); err != nil {
		t.Fatal(err)
	}
	if err = app.updateTripDelays(ctx, now); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]string{future: "assigned", onTime: "boarding", late: "delayed", moving: "in_progress_delayed", completed: "completed"} {
		var got string
		if err = db.QueryRow(ctx, `SELECT status FROM trips WHERE id=$1`, id).Scan(&got); err != nil || got != want {
			t.Fatalf("status %s want %s: %v", got, want, err)
		}
	}
	var events int
	if err = db.QueryRow(ctx, `SELECT count(*) FROM activity_events WHERE tenant_id=$1 AND entity_type='trips'`, tenant).Scan(&events); err != nil || events != 2 {
		t.Fatalf("automatic transitions must be audited once: %d %v", events, err)
	}
}
