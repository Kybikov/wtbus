package main

import (
	"context"
	"github.com/jackc/pgx/v5"
)

func (app *app) writeBookingActivity(ctx context.Context, tx pgx.Tx, id, action string) error {
	_, err := tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_kind,action,entity_type,entity_id,details)
 SELECT b.tenant_id,'system',$3,'bookings',b.id::text,
 jsonb_build_object('source','telegram','actorLabel',coalesce(c.full_name,'Пассажир')||' · Telegram','tripId',b.trip_id::text,'amountMinor',b.price_minor,'currency',b.currency,
 'changes',jsonb_build_array(jsonb_build_object('field','status','before',NULL,'after',b.status),jsonb_build_object('field','seats','before',NULL,'after',b.seats),jsonb_build_object('field','payment_method','before',NULL,'after',p.payment_method),jsonb_build_object('field','payment_status','before',NULL,'after',p.status)))
 FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id LEFT JOIN LATERAL (SELECT status,payment_method FROM payments WHERE booking_id=b.id AND tenant_id=b.tenant_id ORDER BY created_at DESC LIMIT 1) p ON true WHERE b.id=$1 AND b.tenant_id=$2`, id, app.tenantID, action)
	return err
}
