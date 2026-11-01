package main

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

// Payment, boarding and trip completion are independent business events.
func recordAutomaticStatus(ctx context.Context, tx pgx.Tx, tenant, entity, id, before, after, member string) error {
	details, err := json.Marshal(map[string]any{"changes": auditChanges(map[string]any{"status": before}, map[string]any{"status": after})})
	if err != nil {
		return err
	}
	kind := "system"
	if member != "" {
		kind = "human"
	}
	_, err = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,NULLIF($2,'')::uuid,$3,'record_updated',$4,$5,$6)`, tenant, member, kind, entity, id, details)
	return err
}

func (app *application) updateTripDelays(ctx context.Context, now time.Time) error {
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT t.tenant_id::text,t.id::text,t.status,
 CASE WHEN t.status IN ('assigned','boarding','new') THEN 'delayed' ELSE 'in_progress_delayed' END
 FROM trips t WHERE (t.status IN ('assigned','boarding','new') AND t.actual_started_at IS NULL AND t.starts_at <= $1::timestamptz-interval '15 minutes')
 OR (t.status='in_progress' AND t.actual_completed_at IS NULL AND t.ends_at <= $1::timestamptz-interval '15 minutes')
 ORDER BY t.starts_at LIMIT 200 FOR UPDATE SKIP LOCKED`, now)
	if err != nil {
		return err
	}
	type transition struct{ tenant, id, before, after string }
	var items []transition
	for rows.Next() {
		var item transition
		if err = rows.Scan(&item.tenant, &item.id, &item.before, &item.after); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, item := range items {
		// Never replace a company's custom workflow status or terminal state.
		tag, e := tx.Exec(ctx, `UPDATE trips SET status=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND EXISTS(SELECT 1 FROM workflow_statuses WHERE tenant_id=$1 AND entity_type='trips' AND key=$3)`, item.tenant, item.id, item.after)
		if e != nil {
			return e
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		if e = recordAutomaticStatus(ctx, tx, item.tenant, "trips", item.id, item.before, item.after, ""); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}

func (app *application) tripProgressWorker(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		check, stop := context.WithTimeout(ctx, 10*time.Second)
		err := app.updateTripDelays(check, time.Now())
		stop()
		if err != nil && ctx.Err() == nil {
			app.log.Error("update trip delays", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
