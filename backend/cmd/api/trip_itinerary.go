package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type itineraryStop struct {
	City    string     `json:"city"`
	Address string     `json:"address"`
	Minutes int        `json:"minutes"`
	Point   *roadPoint `json:"point,omitempty"`
}

type itineraryFare struct {
	From  int   `json:"from"`
	To    int   `json:"to"`
	Price int64 `json:"priceMinor"`
}

type itineraryOption struct {
	Origin         string    `json:"origin"`
	Destination    string    `json:"destination"`
	StartsAt       time.Time `json:"startsAt"`
	PriceMinor     int64     `json:"priceMinor"`
	AvailableSeats int       `json:"availableSeats"`
}

type tripItinerary struct {
	Stops []itineraryStop `json:"stops"`
	Fares []itineraryFare `json:"fares"`
}

func (i *tripItinerary) validate(origin, destination string, duration int) error {
	if i.Stops == nil {
		i.Stops = []itineraryStop{}
	}
	if i.Fares == nil {
		i.Fares = []itineraryFare{}
	}
	if len(i.Stops) > 12 || len(i.Fares) > 90 {
		return errors.New("Можно добавить до 12 промежуточных остановок.")
	}
	cities := map[string]bool{strings.ToLower(strings.TrimSpace(origin)): true, strings.ToLower(strings.TrimSpace(destination)): true}
	previous := 0
	for index := range i.Stops {
		stop := &i.Stops[index]
		stop.City = strings.TrimSpace(stop.City)
		stop.Address = strings.TrimSpace(stop.Address)
		key := strings.ToLower(stop.City)
		if key == "" || cities[key] || utf8.RuneCountInString(stop.City) > 120 {
			return errors.New("Для каждой остановки укажите отдельный город.")
		}
		if stop.Address == "" || utf8.RuneCountInString(stop.Address) > 300 {
			return errors.New("Укажите адрес или название места остановки (до 300 символов).")
		}
		if stop.Minutes <= previous || stop.Minutes >= duration {
			return errors.New("Время каждой остановки должно быть позже предыдущей и раньше прибытия.")
		}
		if stop.Point != nil && !validRoadPoint(*stop.Point) {
			return errors.New("Укажите корректные координаты остановки.")
		}
		previous = stop.Minutes
		cities[key] = true
	}
	last := len(i.Stops) + 1
	seen := make(map[[2]int]bool, len(i.Fares))
	for _, f := range i.Fares {
		key := [2]int{f.From, f.To}
		if f.From < 0 || f.To > last || f.From >= f.To || (f.From == 0 && f.To == last) || seen[key] || f.Price <= 0 || f.Price > 100_000_000 {
			return errors.New("Укажите одну положительную цену для каждой продаваемой пары остановок.")
		}
		seen[key] = true
	}
	return nil
}

func (app *application) tripItinerary(w http.ResponseWriter, r *http.Request) {
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	entity, id, duration := "routes", r.PathValue("routeID"), "10081"
	if tripID := r.PathValue("tripID"); tripID != "" {
		entity, id, duration = "trips", tripID, "LEAST(10081,ceil(EXTRACT(EPOCH FROM (ends_at-starts_at))/60))::integer"
	}
	if !entityRecordID.MatchString(id) {
		writeJSON(w, 400, map[string]string{"error": "Некорректная запись."})
		return
	}
	var input tripItinerary
	if r.Method == http.MethodPatch {
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
			writeJSON(w, 400, map[string]string{"error": "Проверьте остановки и цены."})
			return
		}
	}
	ctx := r.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	var raw, navigationRaw []byte
	var origin, destination, currency string
	var maxMinutes int
	query := `SELECT itinerary,navigation,origin_name,destination_name,currency,` + duration + ` FROM ` + entity + ` WHERE id=$1 AND tenant_id=$2`
	if r.Method == http.MethodPatch {
		query += " FOR UPDATE"
	}
	err = tx.QueryRow(ctx, query, id, company.ID).Scan(&raw, &navigationRaw, &origin, &destination, &currency, &maxMinutes)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Маршрут или рейс не найден."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	var current tripItinerary
	if err = json.Unmarshal(raw, &current); err != nil {
		app.publicFailure(w, err)
		return
	}
	locked := false
	if entity == "trips" {
		err = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM bookings WHERE trip_id=$1 AND tenant_id=$2 AND segment_from IS NOT NULL)`, id, company.ID).Scan(&locked)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
	}
	version := fmt.Sprintf("%x", sha256.Sum256(raw))
	roadChanged := false
	if r.Method == http.MethodPatch {
		if previous := r.Header.Get("If-Match"); previous != "" && previous != version {
			writeJSON(w, 409, map[string]string{"error": "Остановки уже изменились в другом окне. Обновите данные перед повторной правкой."})
			return
		}
		if err = input.validate(origin, destination, maxMinutes); err != nil {
			writeJSON(w, 422, map[string]string{"error": err.Error()})
			return
		}
		if locked && !sameItineraryStops(current.Stops, input.Stops) {
			writeJSON(w, 409, map[string]string{"error": "Остановки уже используются в бронированиях этого рейса. Можно изменить цены будущих броней."})
			return
		}
		data, _ := json.Marshal(input)
		query := `UPDATE ` + entity + ` SET itinerary=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND itinerary IS DISTINCT FROM $3::jsonb`
		args := []any{id, company.ID, data}
		if len(navigationRaw) > 0 && !slices.Equal(current.points(), input.points()) {
			var nav routeNavigation
			if err = json.Unmarshal(navigationRaw, &nav); err != nil {
				app.publicFailure(w, err)
				return
			}
			if nav.Start != nil && nav.End != nil {
				base := os.Getenv("ROUTING_SERVICE_URL")
				if base == "" {
					base = "https://router.project-osrm.org"
				}
				roadCtx, cancel := context.WithTimeout(ctx, 13*time.Second)
				nav, err = buildRoad(roadCtx, base, nav, input.points()...)
				cancel()
				if err != nil {
					writeJSON(w, 422, map[string]string{"error": "Не удалось построить дорогу через остановки. Уточните точку или повторите попытку."})
					return
				}
				roadChanged = true
				navigation, _ := json.Marshal(nav)
				args = append(args, navigation)
				query = `UPDATE ` + entity + ` SET itinerary=$3,navigation=$4,updated_at=now() WHERE id=$1 AND tenant_id=$2`
				if entity == "routes" {
					args = append(args, math.Round(nav.DistanceMeters/10)/100)
					query = `UPDATE routes SET itinerary=$3,navigation=$4,distance_km=$5,updated_at=now() WHERE id=$1 AND tenant_id=$2`
				}
			}
		}
		if _, err = tx.Exec(ctx, query, args...); err != nil {
			app.publicFailure(w, err)
			return
		}
		current = input
		if err = tx.QueryRow(ctx, `SELECT itinerary FROM `+entity+` WHERE id=$1 AND tenant_id=$2`, id, company.ID).Scan(&raw); err != nil {
			app.publicFailure(w, err)
			return
		}
		version = fmt.Sprintf("%x", sha256.Sum256(raw))
	}
	segments := []itineraryOption{}
	if entity == "trips" && r.Method == http.MethodGet {
		rows, queryErr := tx.Query(ctx, `SELECT s.origin,s.destination,s.starts_at,s.price_minor,GREATEST(0,t.capacity-trip_occupied_seats(t,s.from_stop,s.to_stop)) FROM trips t
		CROSS JOIN LATERAL trip_sale_segments(t) s WHERE t.id=$1 AND t.tenant_id=$2
		AND (s.from_stop<>0 OR s.to_stop<>jsonb_array_length(t.itinerary->'stops')+1) ORDER BY s.from_stop,s.to_stop`, id, company.ID)
		if queryErr != nil {
			app.publicFailure(w, queryErr)
			return
		}
		segments, queryErr = pgx.CollectRows(rows, pgx.RowToStructByPos[itineraryOption])
		if queryErr != nil {
			app.publicFailure(w, queryErr)
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"itinerary": current, "origin": origin, "destination": destination, "currency": currency, "maxMinutes": maxMinutes, "locked": locked, "segments": segments, "roadChanged": roadChanged, "version": version})
}

func (app *application) validateTripItinerarySchedule(w http.ResponseWriter, r *http.Request, tx pgx.Tx, tenant, trip string) bool {
	var raw []byte
	var origin, destination string
	var duration int
	err := tx.QueryRow(r.Context(), `SELECT itinerary,origin_name,destination_name,LEAST(10081,ceil(EXTRACT(EPOCH FROM (ends_at-starts_at))/60))::integer
		FROM trips WHERE tenant_id=$1 AND id=$2`, tenant, trip).Scan(&raw, &origin, &destination, &duration)
	if err != nil {
		app.publicFailure(w, err)
		return false
	}
	var itinerary tripItinerary
	if err = json.Unmarshal(raw, &itinerary); err != nil {
		app.publicFailure(w, err)
		return false
	}
	if err = itinerary.validate(origin, destination, duration); err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return false
	}
	return true
}

func (i tripItinerary) points() []roadPoint {
	points := make([]roadPoint, 0, len(i.Stops))
	for _, stop := range i.Stops {
		if stop.Point != nil {
			points = append(points, *stop.Point)
		}
	}
	return points
}

func sameItineraryStops(a, b []itineraryStop) bool {
	if len(a) != len(b) {
		return false
	}
	for i, stop := range a {
		if stop.City != b[i].City || stop.Address != b[i].Address || stop.Minutes != b[i].Minutes || !sameRoadPoint(stop.Point, b[i].Point) {
			return false
		}
	}
	return true
}
