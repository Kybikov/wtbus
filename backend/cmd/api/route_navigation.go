package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Coordinates use GeoJSON order: longitude, latitude.
type roadPoint [2]float64

func (p *roadPoint) UnmarshalJSON(data []byte) error {
	var values []float64
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	if len(values) != 2 {
		return errors.New("a coordinate needs longitude and latitude")
	}
	*p = roadPoint{values[0], values[1]}
	return nil
}

type routeNavigation struct {
	Start          *roadPoint  `json:"start"`
	End            *roadPoint  `json:"end"`
	Coordinates    []roadPoint `json:"coordinates,omitempty"`
	DistanceMeters float64     `json:"distanceMeters,omitempty"`
}
type roadProgress struct {
	Status          string   `json:"status"`
	Percent         *float64 `json:"percent,omitempty"`
	TravelledMeters float64  `json:"travelledMeters,omitempty"`
	RemainingMeters float64  `json:"remainingMeters,omitempty"`
}

func validRoadPoint(p roadPoint) bool {
	return !math.IsNaN(p[0]) && !math.IsNaN(p[1]) && !math.IsInf(p[0], 0) && !math.IsInf(p[1], 0) && math.Abs(p[0]) <= 180 && math.Abs(p[1]) <= 85
}
func roadDistance(a, b roadPoint) float64 {
	const rad = math.Pi / 180
	lat := (b[1] - a[1]) * rad
	lon := (b[0] - a[0]) * rad
	h := math.Sin(lat/2)*math.Sin(lat/2) + math.Cos(a[1]*rad)*math.Cos(b[1]*rad)*math.Sin(lon/2)*math.Sin(lon/2)
	return 6371000 * 2 * math.Asin(math.Sqrt(math.Min(1, math.Max(0, h))))
}
func roadLength(points []roadPoint) float64 {
	var total float64
	for i := 1; i < len(points); i++ {
		total += roadDistance(points[i-1], points[i])
	}
	return total
}

// A single fix can be ambiguous on loops/crossings. Withhold the percentage
// instead of arbitrarily jumping to a different part of the route.
func matchRoadProgress(nav *routeNavigation, gps *fleetLocationResponse, now time.Time) roadProgress {
	result := roadProgress{Status: "no_route"}
	if nav == nil || len(nav.Coordinates) < 2 {
		return result
	}
	result.Status = "no_gps"
	if gps == nil {
		return result
	}
	result.Status = "stale"
	age := now.Sub(gps.RecordedAt)
	if age > 2*time.Minute || age < -5*time.Second {
		return result
	}
	result.Status = "inaccurate"
	if gps.AccuracyMeters == nil || *gps.AccuracyMeters > 200 || *gps.AccuracyMeters < 0 {
		return result
	}
	p := roadPoint{gps.Longitude, gps.Latitude}
	if !validRoadPoint(p) || math.IsNaN(*gps.AccuracyMeters) || math.IsInf(*gps.AccuracyMeters, 0) {
		return result
	}
	total := roadLength(nav.Coordinates)
	if total < 10 {
		return roadProgress{Status: "no_route"}
	}
	type projection struct{ offset, along float64 }
	candidates := make([]projection, 0, len(nav.Coordinates)-1)
	best := math.Inf(1)
	var along, travelled float64
	for i := 1; i < len(nav.Coordinates); i++ {
		a, b := nav.Coordinates[i-1], nav.Coordinates[i]
		// Local tangent-plane projection; OSRM full geometry retains road vertices.
		scale := math.Cos((a[1] + b[1]) / 2 * math.Pi / 180)
		ax := (a[0] - p[0]) * scale
		ay := a[1] - p[1]
		bx := (b[0] - p[0]) * scale
		by := b[1] - p[1]
		dx, dy := bx-ax, by-ay
		length := roadDistance(a, b)
		if dx*dx+dy*dy == 0 {
			continue
		}
		t := math.Max(0, math.Min(1, -(ax*dx+ay*dy)/(dx*dx+dy*dy)))
		offset := math.Hypot(ax+t*dx, ay+t*dy) * math.Pi / 180 * 6371000
		at := travelled + t*length
		candidates = append(candidates, projection{offset, at})
		if offset < best {
			best = offset
			along = at
		}
		travelled += length
	}
	if best > math.Max(75, *gps.AccuracyMeters+30) {
		return roadProgress{Status: "off_route"}
	}
	for _, c := range candidates {
		if c.offset <= best+math.Max(15, *gps.AccuracyMeters) && math.Abs(c.along-along) > 500 {
			return roadProgress{Status: "ambiguous"}
		}
	}
	percent := math.Max(0, math.Min(100, along/total*100))
	return roadProgress{Status: "on_route", Percent: &percent, TravelledMeters: along, RemainingMeters: math.Max(0, total-along)}
}

var routingSlot struct {
	sync.Mutex
	next time.Time
}

func buildRoad(ctx context.Context, base string, input routeNavigation) (routeNavigation, error) {
	if input.Start == nil || input.End == nil {
		return input, nil
	}
	if !validRoadPoint(*input.Start) || !validRoadPoint(*input.End) || roadDistance(*input.Start, *input.End) < 10 {
		return input, errors.New("Выберите разные точки отправления и прибытия на суше.")
	}
	parsed, err := url.Parse(base)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return input, errors.New("Сервис построения маршрута недоступен.")
	}
	// Public OSRM service permits at most one request/second. Only selected
	// endpoints leave the server; live GPS fixes are always matched locally.
	routingSlot.Lock()
	delay := time.Until(routingSlot.next)
	if delay < 0 {
		delay = 0
	}
	routingSlot.next = time.Now().Add(delay + time.Second)
	routingSlot.Unlock()
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return input, ctx.Err()
	case <-timer.C:
	}
	endpoint := fmt.Sprintf("%s/route/v1/driving/%.6f,%.6f;%.6f,%.6f?overview=full&geometries=geojson&steps=false&radiuses=1000;1000", strings.TrimRight(base, "/"), input.Start[0], input.Start[1], input.End[0], input.End[1])
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return input, err
	}
	req.Header.Set("User-Agent", "VivatBus/1.0 (+https://vivat.wtmelon.store)")
	client := http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return input, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return input, fmt.Errorf("routing status %d", res.StatusCode)
	}
	var body struct {
		Code   string `json:"code"`
		Routes []struct {
			Geometry struct {
				Type        string      `json:"type"`
				Coordinates []roadPoint `json:"coordinates"`
			} `json:"geometry"`
		} `json:"routes"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&body); err != nil {
		return input, err
	}
	if body.Code != "Ok" || len(body.Routes) == 0 || body.Routes[0].Geometry.Type != "LineString" {
		return input, errors.New("Не удалось построить дорогу между выбранными точками.")
	}
	points := body.Routes[0].Geometry.Coordinates
	if len(points) < 2 || len(points) > 100000 {
		return input, errors.New("invalid road geometry")
	}
	for _, p := range points {
		if !validRoadPoint(p) {
			return input, errors.New("invalid road coordinate")
		}
	}
	if roadDistance(points[0], *input.Start) > 1000 || roadDistance(points[len(points)-1], *input.End) > 1000 {
		return input, errors.New("Точки слишком далеко от дороги. Уточните их на карте.")
	}
	input.Coordinates = points
	input.DistanceMeters = roadLength(points)
	if input.DistanceMeters < 10 || input.DistanceMeters > 20000000 {
		return input, errors.New("invalid road length")
	}
	return input, nil
}

func (app *application) routeNavigation(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	id := r.PathValue("routeID")
	table := "routes"
	if tripID := r.PathValue("tripID"); tripID != "" {
		id = tripID
		table = "trips"
	}
	if !entityRecordID.MatchString(id) {
		writeJSON(w, 400, map[string]string{"error": "Неверный маршрут."})
		return
	}
	var raw []byte
	if err := app.db.QueryRow(r.Context(), `SELECT navigation FROM `+table+` WHERE id=$1 AND tenant_id=$2`, id, tenant.ID).Scan(&raw); err != nil {
		var databaseError *pgconn.PgError
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 404, map[string]string{"error": "Маршрут не найден."})
		} else if errors.As(err, &databaseError) && databaseError.Code == "42703" {
			app.log.Error("route navigation requires migration 48", "error", err)
			writeJSON(w, 503, map[string]string{"error": "Точки маршрута пока недоступны. Повторите позже."})
		} else {
			app.publicFailure(w, err)
		}
		return
	}
	if r.Method == http.MethodGet {
		var nav *routeNavigation
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &nav); err != nil {
				app.publicFailure(w, err)
				return
			}
		}
		writeJSON(w, 200, map[string]any{"navigation": nav})
		return
	}
	var input struct {
		Start *roadPoint `json:"start"`
		End   *roadPoint `json:"end"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || (input.Start != nil && !validRoadPoint(*input.Start)) || (input.End != nil && !validRoadPoint(*input.End)) {
		writeJSON(w, 400, map[string]string{"error": "Укажите корректные координаты точек."})
		return
	}
	nav := routeNavigation{Start: input.Start, End: input.End}
	base := os.Getenv("ROUTING_SERVICE_URL")
	if base == "" {
		base = "https://router.project-osrm.org"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	built, err := buildRoad(ctx, base, nav)
	if err != nil {
		app.log.Warn("build route navigation", "error", err, "route", id)
		writeJSON(w, 422, map[string]string{"error": "Не удалось построить дорогу. Уточните точки или повторите попытку."})
		return
	}
	data, _ := json.Marshal(built)
	tag, err := app.db.Exec(r.Context(), `UPDATE `+table+` SET navigation=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3`, data, id, tenant.ID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]string{"error": "Маршрут удалён."})
		return
	}
	writeJSON(w, 200, map[string]any{"navigation": built})
}
