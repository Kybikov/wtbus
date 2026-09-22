package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

type driverManifestBooking struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Phone      string            `json:"phone"`
	Seats      int16             `json:"seats"`
	Passengers []publicPassenger `json:"passengers"`
}

func (app *application) driverPassengers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	company, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	actor, ok := identityFromContext(r.Context())
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "authentication is required"})
		return
	}
	driverID, err := app.activeDriverID(r.Context(), company.ID, actor.MembershipID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 403, map[string]string{"error": "driver profile is not connected"})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	tripID := r.URL.Query().Get("tripId")
	if !publicUUID.MatchString(tripID) {
		writeJSON(w, 400, map[string]string{"error": "trip is required"})
		return
	}
	var assigned bool
	if err = app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM trips WHERE id=$1 AND tenant_id=$2 AND driver_id=$3 AND workflow_status_phase(tenant_id,'trips',status) IN ('assigned','in_progress'))`, tripID, company.ID, driverID).Scan(&assigned); err != nil {
		app.publicFailure(w, err)
		return
	}
	if !assigned {
		writeJSON(w, 403, map[string]string{"error": "trip is not assigned to this driver"})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT b.id::text,COALESCE(b.custom_data->>'passenger_name',c.full_name,''),COALESCE(b.custom_data->>'passenger_phone',c.phone_e164),b.seats,COALESCE(b.custom_data->'passengers','[]'::jsonb) FROM bookings b JOIN customers c ON c.id=b.customer_id WHERE b.tenant_id=$1 AND b.trip_id=$2 AND (workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('pending','confirmed') OR (workflow_status_phase(b.tenant_id,'bookings',b.status)='awaiting_payment' AND b.payment_hold_expires_at>now())) ORDER BY b.created_at`, company.ID, tripID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer rows.Close()
	items := make([]driverManifestBooking, 0)
	for rows.Next() {
		var item driverManifestBooking
		var people []byte
		if err = rows.Scan(&item.ID, &item.Name, &item.Phone, &item.Seats, &people); err != nil {
			app.publicFailure(w, err)
			return
		}
		if err = json.Unmarshal(people, &item.Passengers); err != nil {
			app.publicFailure(w, err)
			return
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
