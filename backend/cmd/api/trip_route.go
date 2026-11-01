package main

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Atomically promote a planned trip to a reusable route without rebuilding or
// dropping the trip's selected road. Replays return its existing route.
func (app *application) createRouteFromTrip(w http.ResponseWriter, r *http.Request) {
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	tripID := r.PathValue("tripID")
	if !publicUUID.MatchString(tripID) {
		writeJSON(w, 400, map[string]string{"error": "Выберите рейс."})
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		writeJSON(w, 400, map[string]string{"error": "Укажите название маршрута."})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len([]rune(input.Name)) > 160 {
		writeJSON(w, 400, map[string]string{"error": "Название маршрута — от 1 до 160 символов."})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var existing *string
	var origin, destination, currency, pricing, phase string
	var price, pay int64
	var navigation []byte
	err = tx.QueryRow(r.Context(), `SELECT route_id::text,origin_name,destination_name,currency,pricing_mode,price_minor,driver_pay_minor,navigation,workflow_status_phase(tenant_id,'trips',status) FROM trips WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, company.ID, tripID).Scan(&existing, &origin, &destination, &currency, &pricing, &price, &pay, &navigation, &phase)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Рейс не найден."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if existing != nil {
		writeJSON(w, 200, map[string]string{"routeId": *existing})
		return
	}
	if phase != "draft" && phase != "planned" && phase != "assigned" {
		writeJSON(w, 409, map[string]string{"error": "Маршрут можно создать до начала рейса."})
		return
	}
	var routeID string
	var road routeNavigation
	_ = json.Unmarshal(navigation, &road)
	distanceKM := math.Round(road.DistanceMeters/10) / 100
	err = tx.QueryRow(r.Context(), `INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency,default_price_minor,default_pricing_mode,driver_pay_minor,navigation,distance_km,is_active,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'active') RETURNING id::text`, company.ID, input.Name, origin, destination, currency, price, pricing, pay, navigation, distanceKM).Scan(&routeID)
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE trips SET route_id=$3,kind='regular',updated_at=now() WHERE tenant_id=$1 AND id=$2`, company.ID, tripID, routeID)
	}
	actor, _ := identityFromContext(r.Context())
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,NULLIF($2,'')::uuid,'human','route.created_from_trip','routes',$3,jsonb_build_object('tripId',$4::text)),($1,NULLIF($2,'')::uuid,'human','trip.route_created','trips',$4,jsonb_build_object('routeId',$3::text))`, company.ID, actor.MembershipID, routeID, tripID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	financeAuditDone(r)
	writeJSON(w, 201, map[string]string{"routeId": routeID})
}
