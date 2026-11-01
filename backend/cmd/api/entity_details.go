package main

import (
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
	"bookings":     `SELECT (to_jsonb(c)-'tenant_id') || jsonb_build_object('customer_name',u.full_name,'customer_phone',u.phone_e164,'origin_name',t.origin_name,'destination_name',t.destination_name,'starts_at',t.starts_at,'payment_status',COALESCE(p.status::text,CASE WHEN ci.cash_minor>=c.price_minor THEN 'paid' WHEN ci.cash_minor>0 THEN 'partial' ELSE 'pending' END),'payment_method',COALESCE(p.payment_method,CASE WHEN ci.cash_minor>0 OR c.status='cash_on_boarding' THEN 'cash' END),'cash_received_minor',ci.cash_minor,'boarding',ci.boarding) FROM bookings c JOIN customers u ON u.id=c.customer_id AND u.tenant_id=c.tenant_id JOIN trips t ON t.id=c.trip_id AND t.tenant_id=c.tenant_id LEFT JOIN driver_booking_checkins ci ON ci.booking_id=c.id AND ci.tenant_id=c.tenant_id LEFT JOIN LATERAL (SELECT status,payment_method FROM payments WHERE booking_id=c.id AND tenant_id=c.tenant_id ORDER BY created_at DESC LIMIT 1) p ON true WHERE c.id=$1 AND c.tenant_id=$2`,
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
	ID            string             `json:"id"`
	ActorID       string             `json:"actorId,omitempty"`
	Action        string             `json:"action"`
	Actor         string             `json:"actor"`
	Kind          string             `json:"kind"`
	CreatedAt     string             `json:"createdAt"`
	ChangedFields []string           `json:"changedFields,omitempty"`
	Changes       []auditFieldChange `json:"changes,omitempty"`
	Entity        string             `json:"entity,omitempty"`
	EntityID      string             `json:"entityId,omitempty"`
	RecordLabel   string             `json:"recordLabel,omitempty"`
	Summary       json.RawMessage    `json:"summary,omitempty"`
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
	numberedQuery := `SELECT base.item || jsonb_build_object('record_number',n.number) FROM (` + query + `) AS base(item) LEFT JOIN record_numbers n ON n.record_id=$1::uuid AND n.tenant_id=$2 AND n.entity=$3`
	err := app.db.QueryRow(r.Context(), numberedQuery, id, company.ID, entity).Scan(&item)
	// Numbering is optional read metadata during a rolling deployment. An API
	// update can precede migration 46; existing records must remain accessible.
	// Check the specific missing relation so unrelated database failures still fail.
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && databaseError.Code == "42P01" {
		var numberingMissing bool
		if checkErr := app.db.QueryRow(r.Context(), `SELECT to_regclass('record_numbers') IS NULL`).Scan(&numberingMissing); checkErr == nil && numberingMissing {
			app.log.Warn("record details read without numbering; apply migration 46", "entity", entity)
			err = app.db.QueryRow(r.Context(), query, id, company.ID).Scan(&item)
		}
	}
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
		relationQuery = `SELECT t.id::text,'trips',t.origin_name||' → '||t.destination_name,jsonb_strip_nulls(jsonb_build_object('status',t.status,'occupied_seats',COALESCE((SELECT sum(b.seats) FROM bookings b WHERE b.trip_id=t.id AND (workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('pending','confirmed','completed') OR (workflow_status_phase(b.tenant_id,'bookings',b.status)='awaiting_payment' AND b.payment_hold_expires_at>now()))),0),'capacity',t.capacity,'starts_at',t.starts_at)) FROM trips t WHERE t.route_id=$1 AND t.tenant_id=$2 ORDER BY t.starts_at DESC LIMIT 20`
	case "requests":
		relationQuery = `SELECT b.id::text,'bookings',t.origin_name||' → '||t.destination_name,jsonb_strip_nulls(jsonb_build_object('status',b.status,'seats',b.seats,'starts_at',t.starts_at,'source',b.source)) FROM individual_transfer_requests r JOIN bookings b ON b.id=r.booking_id AND b.tenant_id=r.tenant_id JOIN trips t ON t.id=b.trip_id AND t.tenant_id=b.tenant_id WHERE r.id=$1 AND r.tenant_id=$2 LIMIT 1`
	case "bookings":
		relationQuery = `SELECT r.id::text,'requests',r.origin_name||' → '||r.destination_name,jsonb_strip_nulls(jsonb_build_object('status',r.status,'seats',r.seats,'starts_at',r.requested_departure_at)) FROM individual_transfer_requests r WHERE r.booking_id=$1 AND r.tenant_id=$2 LIMIT 1`
	case "fleet":
		relationQuery = `SELECT t.id::text,'trips',t.origin_name||' → '||t.destination_name,jsonb_strip_nulls(jsonb_build_object('status',t.status,'occupied_seats',COALESCE((SELECT sum(b.seats) FROM bookings b WHERE b.trip_id=t.id AND (workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('pending','confirmed','completed') OR (workflow_status_phase(b.tenant_id,'bookings',b.status)='awaiting_payment' AND b.payment_hold_expires_at>now()))),0),'capacity',t.capacity,'starts_at',t.starts_at)) FROM trips t WHERE t.vehicle_id=$1 AND t.tenant_id=$2 ORDER BY t.starts_at DESC LIMIT 20`
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
	direct, err := app.directEntityRelations(r.Context(), actor, item)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	related = append(direct, related...)
	events := make([]entityActivity, 0)
	rows, err := app.db.Query(r.Context(), entityHistoryQuery, id, company.ID, entity)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	for rows.Next() {
		var event entityActivity
		if err = rows.Scan(&event.ID, &event.ActorID, &event.Action, &event.Actor, &event.Kind, &event.CreatedAt, &event.ChangedFields, &event.Changes, &event.Entity, &event.EntityID, &event.RecordLabel, &event.Summary); err != nil {
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
	// Old records may predate journaling. Preserve the known creation time without inventing an author or assignment history.
	if entity == "trips" && len(events) < 500 {
		created := false
		for _, event := range events {
			if event.EntityID == id && event.Action == "record_created" {
				created = true
			}
		}
		var fields map[string]any
		if !created && json.Unmarshal(item, &fields) == nil {
			if at, ok := fields["created_at"].(string); ok {
				events = append(events, entityActivity{ID: "legacy-created:" + id, Action: "record_created", Actor: "Автор не записан", Kind: "legacy", CreatedAt: at, Entity: entity, EntityID: id})
			}
		}
	}
	restriction := ""
	if entity == "fleet" && actor.Role == "dispatcher" {
		restriction = "Изменять автомобиль может администратор или владелец компании."
	}
	if entity == "trips" && actor.Role != "developer" {
		var fields map[string]any
		if json.Unmarshal(item, &fields) == nil && fields["status"] != "new" && fields["status"] != "assigned" {
			restriction = "Детали можно менять у нового или назначенного рейса."
		}
	}
	writeJSON(w, 200, map[string]any{"item": item, "related": related, "activity": events, "timezone": company.Timezone, "editRestriction": restriction})
}
