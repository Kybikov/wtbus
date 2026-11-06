package main

import (
	"context"
	"encoding/json"

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
