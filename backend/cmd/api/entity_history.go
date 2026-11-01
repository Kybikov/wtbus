package main

import (
	"context"
	"encoding/json"
)

// Descendants belong to this record, not every record linked to its route/vehicle.
// All hops and event rows remain inside the session company.
const entityHistoryQuery = `WITH root_trips AS (
 SELECT t.id,t.origin_name||' → '||t.destination_name AS label FROM trips t
 WHERE t.tenant_id=$2 AND (($3='trips' AND t.id::text=$1) OR ($3='routes' AND t.route_id::text=$1) OR ($3='fleet' AND t.vehicle_id::text=$1))
), root_bookings AS (
 SELECT b.id,coalesce(c.full_name,'Бронирование') AS label FROM bookings b
 LEFT JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
 WHERE b.tenant_id=$2 AND (b.trip_id IN (SELECT id FROM root_trips) OR ($3='bookings' AND b.id::text=$1) OR ($3='customers' AND b.customer_id::text=$1))
), targets AS (
 SELECT $1::text AS id,$3::text AS entity,''::text AS label
 UNION SELECT id::text,'trips',label FROM root_trips
 UNION SELECT id::text,'bookings',label FROM root_bookings
 UNION SELECT p.id::text,'payments','Оплата · '||b.label FROM payments p JOIN root_bookings b ON b.id=p.booking_id WHERE p.tenant_id=$2
)
SELECT e.id::text,coalesce(e.actor_membership_id::text,'system'),e.action,
 coalesce(e.details->>'actorLabel',u.display_name,CASE WHEN e.details->>'source'='telegram' THEN 'Пассажир · Telegram' WHEN e.details->>'source'='web' THEN 'Пассажир · сайт' ELSE 'Система' END),
 e.actor_kind,e.created_at::text,coalesce(e.details->'changedFields','[]'::jsonb),coalesce(e.details->'changes','[]'::jsonb),
 CASE e.entity_type WHEN 'trip' THEN 'trips' WHEN 'booking' THEN 'bookings' WHEN 'payment' THEN 'payments' ELSE e.entity_type END,
 coalesce(e.entity_id,''),coalesce((SELECT max(nullif(t.label,'')) FROM targets t WHERE t.id=e.entity_id),''),
 jsonb_strip_nulls(jsonb_build_object('amountMinor',e.details->'amountMinor','currency',e.details->'currency','boarding',e.details->'boarding','passengerIndex',e.details->'passengerIndex','source',e.details->'source'))
FROM activity_events e
LEFT JOIN memberships m ON m.id=e.actor_membership_id AND m.tenant_id=e.tenant_id
LEFT JOIN users u ON u.id=m.user_id
WHERE e.tenant_id=$2 AND (e.entity_id IN (SELECT id FROM targets)
 OR e.details->>'tripId' IN (SELECT id::text FROM root_trips)
 OR e.details->>'bookingId' IN (SELECT id::text FROM root_bookings)
 OR ($3='team' AND e.actor_membership_id::text=$1))
ORDER BY e.created_at DESC,e.id DESC LIMIT 500`

func (app *application) directEntityRelations(ctx context.Context, actor identity, item json.RawMessage) ([]entityRelation, error) {
	var fields map[string]any
	if err := json.Unmarshal(item, &fields); err != nil {
		return nil, err
	}
	refs := []entityRelation{}
	for _, target := range []struct{ field, entity, query string }{
		{"route_id", "routes", `SELECT id::text,name,jsonb_build_object('status',status,'status_label',(SELECT label FROM workflow_statuses WHERE tenant_id=routes.tenant_id AND entity_type='routes' AND key=routes.status),'status_tone',(SELECT tone FROM workflow_statuses WHERE tenant_id=routes.tenant_id AND entity_type='routes' AND key=routes.status),'origin_name',origin_name,'destination_name',destination_name,'created_at',created_at) FROM routes WHERE id=$1 AND tenant_id=$2`},
		{"vehicle_id", "fleet", `SELECT id::text,name,jsonb_build_object('status',status,'status_label',(SELECT label FROM workflow_statuses WHERE tenant_id=vehicles.tenant_id AND entity_type='vehicles' AND key=vehicles.status),'status_tone',(SELECT tone FROM workflow_statuses WHERE tenant_id=vehicles.tenant_id AND entity_type='vehicles' AND key=vehicles.status),'registration_number',registration_number,'capacity',capacity,'created_at',created_at) FROM vehicles WHERE id=$1 AND tenant_id=$2`},
		{"trip_id", "trips", `SELECT id::text,origin_name||' → '||destination_name,jsonb_build_object('status',status,'starts_at',starts_at,'capacity',capacity,'created_at',created_at) FROM trips WHERE id=$1 AND tenant_id=$2`},
		{"customer_id", "customers", `SELECT id::text,coalesce(full_name,phone_e164),jsonb_build_object('phone_e164',phone_e164) FROM customers WHERE id=$1 AND tenant_id=$2`},
		{"booking_id", "bookings", `SELECT id::text,'Бронирование',jsonb_build_object('status',status,'seats',seats) FROM bookings WHERE id=$1 AND tenant_id=$2`},
		{"driver_id", "team", `SELECT m.id::text,d.full_name,jsonb_build_object('created_at',d.created_at,'role',m.role,'status',CASE WHEN d.is_active AND m.is_active THEN 'active' ELSE 'inactive' END) FROM drivers d JOIN memberships m ON m.id=d.membership_id AND m.tenant_id=d.tenant_id WHERE d.id=$1 AND d.tenant_id=$2`},
	} {
		id, ok := fields[target.field].(string)
		if !ok || !entityRecordID.MatchString(id) {
			continue
		}
		if target.entity == "team" && actor.Role != "owner" && actor.Role != "admin" && actor.Role != "developer" {
			continue
		}
		rows, err := app.db.Query(ctx, target.query, id, actor.TenantID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			ref := entityRelation{Entity: target.entity}
			if err = rows.Scan(&ref.ID, &ref.Label, &ref.Meta); err != nil {
				rows.Close()
				return nil, err
			}
			refs = append(refs, ref)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return refs, nil
}
