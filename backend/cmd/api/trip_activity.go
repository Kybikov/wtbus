package main

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// The journal is part of the trip transaction, including every series instance.
func recordTripCreation(ctx context.Context, tx pgx.Tx, tenant, id string, actor identity) error {
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT jsonb_build_object('route_id',t.route_id,'vehicle_id',t.vehicle_id,'driver_id',t.driver_id,'status',t.status,'starts_at',t.starts_at,'ends_at',t.ends_at,'capacity',t.capacity,'price_minor',t.price_minor,'driver_pay_minor',t.driver_pay_minor,'currency',t.currency,'route_name',r.name,'vehicle_name',v.name,'driver_name',d.full_name) FROM trips t LEFT JOIN routes r ON r.id=t.route_id AND r.tenant_id=t.tenant_id LEFT JOIN vehicles v ON v.id=t.vehicle_id AND v.tenant_id=t.tenant_id LEFT JOIN drivers d ON d.id=t.driver_id AND d.tenant_id=t.tenant_id WHERE t.id=$1 AND t.tenant_id=$2`, id, tenant).Scan(&raw); err != nil {
		return err
	}
	var snapshot map[string]any
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return err
	}
	changes := auditChanges(map[string]any{}, snapshot)
	for i := range changes {
		if field := map[string]string{"route_id": "route_name", "vehicle_id": "vehicle_name", "driver_id": "driver_name"}[changes[i].Field]; field != "" {
			changes[i].AfterLabel, _ = snapshot[field].(string)
		}
	}
	details, _ := json.Marshal(map[string]any{"changes": changes})
	_, err := tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,NULLIF($2,'')::uuid,'human','record_created','trips',$3,$4)`, tenant, actor.MembershipID, id, details)
	return err
}

func tripCreationAuditDone(r *http.Request) {
	if capture, ok := r.Context().Value(auditContextKey{}).(*auditCapture); ok {
		capture.activityRecorded = true
	}
}
