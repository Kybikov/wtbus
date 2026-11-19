package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

type routeItineraryBatch struct {
	Ready           int            `json:"ready"`
	Unchanged       int            `json:"unchanged"`
	Skipped         map[string]int `json:"skipped"`
	Token           string         `json:"token"`
	TemplateVersion string         `json:"templateVersion"`
}

type itineraryBatchTrip struct {
	ID, Origin, Destination, Currency, Kind, Pricing, Revision string
	Duration                                                   int
	Itinerary, Navigation                                      []byte
	SegmentBookings                                            bool
}

type itineraryBatchUpdate struct {
	ID         string
	Navigation []byte
}

const futureRouteTrips = `t.tenant_id=$1 AND t.route_id=$2 AND t.starts_at>clock_timestamp()
	AND t.actual_started_at IS NULL AND t.actual_boarding_started_at IS NULL AND t.status<>'boarding'
	AND workflow_status_phase(t.tenant_id,'trips',t.status) IN ('planned','assigned')`

func (app *application) applyRouteItinerary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	id := r.PathValue("routeID")
	if !entityRecordID.MatchString(id) {
		writeJSON(w, 400, map[string]string{"error": "Некорректный маршрут."})
		return
	}
	applying := r.Method == http.MethodPost
	var input struct {
		Token string `json:"token"`
	}
	if applying {
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || len(input.Token) != 64 {
			writeJSON(w, 400, map[string]string{"error": "Сначала откройте предварительный просмотр."})
			return
		}
	}

	ctx := r.Context()
	opts := pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}
	if applying {
		opts = pgx.TxOptions{}
	}
	tx, err := app.db.BeginTx(ctx, opts)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	if applying {
		// Booking creation locks the trip first. Read bookings in a fresh
		// statement after all eligible trips have been locked.
		rows, lockErr := tx.Query(ctx, `SELECT t.id FROM trips t WHERE `+futureRouteTrips+` ORDER BY t.id FOR UPDATE`, company.ID, id)
		if lockErr != nil {
			app.publicFailure(w, lockErr)
			return
		}
		for rows.Next() {
		}
		if lockErr = rows.Err(); lockErr != nil {
			app.publicFailure(w, lockErr)
			return
		}
	}

	var raw, navRaw []byte
	var origin, destination, currency string
	query := `SELECT itinerary,navigation,origin_name,destination_name,currency FROM routes WHERE tenant_id=$1 AND id=$2`
	if applying {
		query += " FOR SHARE"
	}
	err = tx.QueryRow(ctx, query, company.ID, id).Scan(&raw, &navRaw, &origin, &destination, &currency)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Маршрут не найден."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	var template tripItinerary
	if err = json.Unmarshal(raw, &template); err != nil {
		app.publicFailure(w, err)
		return
	}
	if len(template.Stops) == 0 {
		writeJSON(w, 422, map[string]string{"error": "Добавьте и сохраните хотя бы одну остановку в маршруте."})
		return
	}
	var routeRoad routeNavigation
	if len(navRaw) > 0 {
		if err = json.Unmarshal(navRaw, &routeRoad); err != nil {
			app.publicFailure(w, err)
			return
		}
	}
	preview, updates, err := planRouteItinerary(ctx, tx, company.ID, id, origin, destination, currency, raw, navRaw, template, routeRoad)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if !applying {
		writeJSON(w, 200, preview)
		return
	}
	if preview.Token != input.Token {
		writeJSON(w, 409, map[string]any{"error": "Маршрут или рейсы изменились. Проверьте обновлённый список.", "preview": preview})
		return
	}
	actor, _ := identityFromContext(ctx)
	for _, update := range updates {
		query, args := `UPDATE trips t SET itinerary=$4,updated_at=now() WHERE `+futureRouteTrips+` AND t.id=$3`, []any{company.ID, id, update.ID, raw}
		if update.Navigation != nil {
			query = `UPDATE trips t SET itinerary=$4,navigation=$5,updated_at=now() WHERE ` + futureRouteTrips + ` AND t.id=$3`
			args = append(args, update.Navigation)
		}
		tag, updateErr := tx.Exec(ctx, query, args...)
		if updateErr != nil {
			app.publicFailure(w, updateErr)
			return
		}
		if tag.RowsAffected() != 1 {
			writeJSON(w, 409, map[string]string{"error": "Список будущих рейсов изменился. Откройте предварительный просмотр ещё раз."})
			return
		}
		_, updateErr = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details)
			VALUES($1,$2,'human','record_updated','trips',$3,jsonb_build_object('changedFields',jsonb_build_array('itinerary'::text),'routeId',$4::text))`, company.ID, actor.MembershipID, update.ID, id)
		if updateErr != nil {
			app.publicFailure(w, updateErr)
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		app.publicFailure(w, err)
		return
	}
	tripActionAuditDone(r)
	writeJSON(w, 200, map[string]int{"updated": len(updates)})
}

func planRouteItinerary(ctx context.Context, tx pgx.Tx, company, id, origin, destination, currency string, raw, navRaw []byte, template tripItinerary, routeRoad routeNavigation) (routeItineraryBatch, []itineraryBatchUpdate, error) {
	preview := routeItineraryBatch{Skipped: map[string]int{}, TemplateVersion: fmt.Sprintf("%x", sha256.Sum256(raw))}
	rows, err := tx.Query(ctx, `SELECT t.id::text,t.origin_name,t.destination_name,t.currency,t.kind::text,t.pricing_mode,t.xmin::text,
		LEAST(10081,ceil(EXTRACT(EPOCH FROM (t.ends_at-t.starts_at))/60))::integer,t.itinerary,t.navigation,
		EXISTS(SELECT 1 FROM bookings b WHERE b.tenant_id=t.tenant_id AND b.trip_id=t.id AND b.segment_from IS NOT NULL)
		FROM trips t WHERE `+futureRouteTrips+` ORDER BY t.id`, company, id)
	if err != nil {
		return preview, nil, err
	}
	defer rows.Close()
	hasher := sha256.New()
	encoder := json.NewEncoder(hasher)
	_ = encoder.Encode([]string{company, id, origin, destination, currency, preview.TemplateVersion, fmt.Sprintf("%x", sha256.Sum256(navRaw))})
	var updates []itineraryBatchUpdate
	for rows.Next() {
		var trip itineraryBatchTrip
		if err = rows.Scan(&trip.ID, &trip.Origin, &trip.Destination, &trip.Currency, &trip.Kind, &trip.Pricing, &trip.Revision, &trip.Duration, &trip.Itinerary, &trip.Navigation, &trip.SegmentBookings); err != nil {
			return preview, nil, err
		}
		var current tripItinerary
		if err = json.Unmarshal(trip.Itinerary, &current); err != nil {
			return preview, nil, err
		}
		navigation, reason := itineraryBatchDecision(trip, template, current, routeRoad, origin, destination, currency)
		if reason == "" && bytes.Equal(trip.Itinerary, raw) {
			reason = "unchanged"
		}
		switch reason {
		case "unchanged":
			preview.Unchanged++
		case "":
			updates = append(updates, itineraryBatchUpdate{ID: trip.ID, Navigation: navigation})
		default:
			preview.Skipped[reason]++
		}
		_ = encoder.Encode([]string{trip.ID, trip.Revision, reason})
	}
	preview.Ready = len(updates)
	preview.Token = fmt.Sprintf("%x", hasher.Sum(nil))
	return preview, updates, rows.Err()
}

func itineraryBatchDecision(trip itineraryBatchTrip, template, current tripItinerary, routeRoad routeNavigation, origin, destination, currency string) ([]byte, string) {
	if trip.Kind != "regular" || trip.Pricing != "per_passenger" || trip.Currency != currency ||
		!strings.EqualFold(strings.TrimSpace(trip.Origin), strings.TrimSpace(origin)) ||
		!strings.EqualFold(strings.TrimSpace(trip.Destination), strings.TrimSpace(destination)) {
		return nil, "settings"
	}
	if trip.SegmentBookings && !sameItineraryStops(current.Stops, template.Stops) {
		return nil, "bookings"
	}
	// Validation normalizes strings. Keep the shared template read-only.
	candidate := tripItinerary{Stops: slices.Clone(template.Stops), Fares: template.Fares}
	if candidate.validate(trip.Origin, trip.Destination, trip.Duration) != nil {
		return nil, "schedule"
	}
	if slices.Equal(current.points(), template.points()) {
		return nil, ""
	}
	var tripRoad routeNavigation
	if len(trip.Navigation) > 0 && json.Unmarshal(trip.Navigation, &tripRoad) != nil {
		return nil, "navigation"
	}
	if tripRoad.Start == nil || tripRoad.End == nil {
		return nil, ""
	}
	if !sameRoadPoint(tripRoad.Start, routeRoad.Start) || !sameRoadPoint(tripRoad.End, routeRoad.End) ||
		!slices.Equal(routeRoad.Via, template.points()) || len(routeRoad.Coordinates) < 2 {
		return nil, "navigation"
	}
	// Keep the trip's pickup/drop-off addresses. Only share the rebuilt road.
	tripRoad.Coordinates, tripRoad.Via, tripRoad.DistanceMeters = routeRoad.Coordinates, routeRoad.Via, routeRoad.DistanceMeters
	navigation, err := json.Marshal(tripRoad)
	if err != nil {
		return nil, "navigation"
	}
	return navigation, ""
}
