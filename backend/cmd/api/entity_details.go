package main

import (
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"regexp"
)

var entityRecordID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func validEntityCollection(entity string) bool {
	switch entity {
	case "customers", "bookings", "team", "routes", "fleet", "requests", "availability", "trips", "cash-balances":
		return true
	}
	return false
}

// Only explicit projections are exposed; credentials, tokens and tenant configuration
// never enter this endpoint. Every record and relation is scoped to the session tenant.
var entityDetailQueries = map[string]string{
	"customers":    `SELECT to_jsonb(c)-'tenant_id' FROM customers c WHERE c.id=$1 AND c.tenant_id=$2`,
	"routes":       `SELECT to_jsonb(c)-'tenant_id' FROM routes c WHERE c.id=$1 AND c.tenant_id=$2`,
	"availability": `SELECT (to_jsonb(c)-'tenant_id') || jsonb_build_object('route_name',r.name) FROM availability_blocks c LEFT JOIN routes r ON r.id=c.route_id AND r.tenant_id=c.tenant_id WHERE c.id=$1 AND c.tenant_id=$2`,
	"requests":     `SELECT to_jsonb(c)-'tenant_id' FROM individual_transfer_requests c WHERE c.id=$1 AND c.tenant_id=$2`,
	"trips":        `SELECT (to_jsonb(c)-'tenant_id') || jsonb_build_object('vehicle_name',v.name,'driver_name',d.full_name,'route_name',r.name) FROM trips c LEFT JOIN vehicles v ON v.id=c.vehicle_id AND v.tenant_id=c.tenant_id LEFT JOIN drivers d ON d.id=c.driver_id AND d.tenant_id=c.tenant_id LEFT JOIN routes r ON r.id=c.route_id AND r.tenant_id=c.tenant_id WHERE c.id=$1 AND c.tenant_id=$2`,
	"bookings":     `SELECT (to_jsonb(c)-'tenant_id') || jsonb_build_object('customer_name',u.full_name,'customer_phone',u.phone_e164,'origin_name',t.origin_name,'destination_name',t.destination_name,'starts_at',t.starts_at,'payment_status',p.status,'payment_method',p.payment_method) FROM bookings c JOIN customers u ON u.id=c.customer_id AND u.tenant_id=c.tenant_id JOIN trips t ON t.id=c.trip_id AND t.tenant_id=c.tenant_id LEFT JOIN LATERAL (SELECT status,payment_method FROM payments WHERE booking_id=c.id AND tenant_id=c.tenant_id ORDER BY created_at DESC LIMIT 1) p ON true WHERE c.id=$1 AND c.tenant_id=$2`,
	"fleet":        `SELECT (to_jsonb(c)-'tenant_id') || jsonb_build_object('last_location',(SELECT jsonb_build_object('latitude',latitude,'longitude',longitude,'accuracy_meters',accuracy_meters,'recorded_at',recorded_at) FROM gps_points WHERE vehicle_id=c.id AND tenant_id=c.tenant_id ORDER BY recorded_at DESC LIMIT 1)) FROM vehicles c WHERE c.id=$1 AND c.tenant_id=$2`,
	"team":         `SELECT jsonb_build_object('id',m.id,'display_name',u.display_name,'email',u.email,'role',m.role,'is_active',m.is_active,'is_system',u.is_system,'created_at',m.created_at,'user_id',u.id,'driver_id',d.id,'driver_phone',d.phone_e164) FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN drivers d ON d.membership_id=m.id AND d.tenant_id=m.tenant_id WHERE m.id=$1 AND m.tenant_id=$2`,
}

type entityRelation struct {
	ID     string          `json:"id"`
	Entity string          `json:"entity"`
	Label  string          `json:"label"`
	Meta   json.RawMessage `json:"meta,omitempty"`
}
type entityActivity struct {
	Action    string `json:"action"`
	Actor     string `json:"actor"`
	Kind      string `json:"kind"`
	CreatedAt string `json:"createdAt"`
}

func (app *application) entityDetails(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	actor, ok := identityFromContext(r.Context())
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "authentication is required"})
		return
	}
	if actor.TenantID != company.ID {
		writeJSON(w, 403, map[string]string{"error": "Доступ до компанії заборонено."})
		return
	}
	if actor.Role != "owner" && actor.Role != "admin" && actor.Role != "developer" && actor.Role != "dispatcher" {
		writeJSON(w, 403, map[string]string{"error": "Доступ до колекції заборонено."})
		return
	}
	entity, id := r.PathValue("entity"), r.PathValue("recordID")
	query, exists := entityDetailQueries[entity]
	if !exists {
		writeJSON(w, 404, map[string]string{"error": "Колекцію не знайдено."})
		return
	}
	if entity == "team" && actor.Role != "owner" && actor.Role != "admin" && actor.Role != "developer" {
		writeJSON(w, 403, map[string]string{"error": "Доступ до команди заборонено."})
		return
	}
	if !entityRecordID.MatchString(id) {
		writeJSON(w, 400, map[string]string{"error": "Некоректний ID."})
		return
	}
	var item json.RawMessage
	err := app.db.QueryRow(r.Context(), query, id, company.ID).Scan(&item)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Запис не знайдено."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	related := make([]entityRelation, 0)
	var relationQuery string
	switch entity {
	case "customers":
		relationQuery = `SELECT b.id::text,'bookings',t.origin_name||' → '||t.destination_name,jsonb_strip_nulls(jsonb_build_object('status',b.status,'seats',b.seats,'starts_at',t.starts_at,'source',b.source)) FROM bookings b JOIN trips t ON t.id=b.trip_id AND t.tenant_id=b.tenant_id WHERE b.customer_id=$1 AND b.tenant_id=$2 ORDER BY b.created_at DESC LIMIT 20`
	case "trips":
		relationQuery = `SELECT b.id::text,'bookings',coalesce(c.full_name,c.phone_e164),jsonb_strip_nulls(jsonb_build_object('status',b.status,'seats',b.seats,'source',b.source,'created_at',b.created_at)) FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id WHERE b.trip_id=$1 AND b.tenant_id=$2 ORDER BY b.created_at DESC LIMIT 20`
	case "routes":
		relationQuery = `SELECT t.id::text,'trips',t.origin_name||' → '||t.destination_name,jsonb_strip_nulls(jsonb_build_object('status',t.status,'occupied_seats',COALESCE((SELECT sum(b.seats) FROM bookings b WHERE b.trip_id=t.id AND (b.status IN ('pending','cash_on_boarding','confirmed','completed') OR (b.status='awaiting_payment' AND b.payment_hold_expires_at>now()))),0),'capacity',t.capacity,'starts_at',t.starts_at)) FROM trips t WHERE t.route_id=$1 AND t.tenant_id=$2 ORDER BY t.starts_at DESC LIMIT 20`
	case "fleet":
		relationQuery = `SELECT t.id::text,'trips',t.origin_name||' → '||t.destination_name,jsonb_strip_nulls(jsonb_build_object('status',t.status,'occupied_seats',COALESCE((SELECT sum(b.seats) FROM bookings b WHERE b.trip_id=t.id AND (b.status IN ('pending','cash_on_boarding','confirmed','completed') OR (b.status='awaiting_payment' AND b.payment_hold_expires_at>now()))),0),'capacity',t.capacity,'starts_at',t.starts_at)) FROM trips t WHERE t.vehicle_id=$1 AND t.tenant_id=$2 ORDER BY t.starts_at DESC LIMIT 20`
	}
	if relationQuery != "" {
		rows, err := app.db.Query(r.Context(), relationQuery, id, company.ID)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		for rows.Next() {
			var ref entityRelation
			if err = rows.Scan(&ref.ID, &ref.Entity, &ref.Label, &ref.Meta); err != nil {
				rows.Close()
				app.publicFailure(w, err)
				return
			}
			related = append(related, ref)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			app.publicFailure(w, err)
			return
		}
	}
	events := make([]entityActivity, 0)
	rows, err := app.db.Query(r.Context(), `SELECT e.action,coalesce(u.display_name,'Система'),e.actor_kind,e.created_at::text FROM activity_events e LEFT JOIN memberships m ON m.id=e.actor_membership_id AND m.tenant_id=e.tenant_id LEFT JOIN users u ON u.id=m.user_id WHERE e.tenant_id=$2 AND (e.entity_id=$1 OR ($3='team' AND e.actor_membership_id::text=$1)) ORDER BY e.created_at DESC LIMIT 30`, id, company.ID, entity)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	for rows.Next() {
		var event entityActivity
		if err = rows.Scan(&event.Action, &event.Actor, &event.Kind, &event.CreatedAt); err != nil {
			rows.Close()
			app.publicFailure(w, err)
			return
		}
		events = append(events, event)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"item": item, "related": related, "activity": events, "timezone": company.Timezone})
}
