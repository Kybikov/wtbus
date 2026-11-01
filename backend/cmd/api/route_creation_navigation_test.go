package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestRouteCreationStoresRoadAndDistanceAtomically(t *testing.T) {
	dsn := os.Getenv("GPS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires disposable GPS_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	slug := fmt.Sprintf("route-nav-%d", time.Now().UnixNano())
	var tenant string
	if err = db.QueryRow(ctx, `INSERT INTO tenants(slug,name) VALUES($1,'Route test') RETURNING id::text`, slug).Scan(&tenant); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenant)
	failed := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if failed {
			w.WriteHeader(503)
			return
		}
		fmt.Fprint(w, `{"code":"Ok","routes":[{"geometry":{"type":"LineString","coordinates":[[20,50],[20.02,50],[20.02,50.02]]}}]}`)
	}))
	defer server.Close()
	t.Setenv("ROUTING_SERVICE_URL", server.URL)
	app := &application{db: db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	start, end := roadPoint{20, 50}, roadPoint{20.02, 50.02}
	nav := routeNavigation{Start: &start, End: &end, StartLabel: "Station A", EndLabel: "Station B", DistanceMeters: 1, Coordinates: []roadPoint{{0, 0}, {1, 1}}}
	request := func(handler http.HandlerFunc, method, route string, body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/", bytes.NewReader(raw))
		r.SetPathValue("slug", slug)
		r.SetPathValue("routeID", route)
		r = r.WithContext(context.WithValue(r.Context(), identityContextKey{}, identity{TenantID: tenant, TenantSlug: slug, Role: "developer"}))
		w := httptest.NewRecorder()
		handler(w, r)
		return w
	}
	count := func() int {
		var n int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM routes WHERE tenant_id=$1`, tenant).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	w := request(app.previewRouteNavigation, "POST", "", nav)
	if w.Code != 200 || count() != 0 {
		t.Fatalf("preview persisted or failed: %d %s", w.Code, w.Body)
	}
	input := routeInput{Name: "A-B", Origin: "A", Destination: "B", Currency: "EUR", DefaultPriceMinor: 5000, DriverPayMinor: 1000, Navigation: &nav, DistanceKM: 1, Status: "active", TariffMode: "per_km", VehicleClassRates: map[string]int64{"bus": 100}}
	w = request(app.createRoute, "POST", "", input)
	if w.Code != 201 {
		t.Fatalf("create %d %s", w.Code, w.Body)
	}
	var response struct {
		Item routeResponse `json:"item"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	id := response.Item.ID
	var raw []byte
	var distance float64
	if err = db.QueryRow(ctx, `SELECT navigation,distance_km::float8 FROM routes WHERE id=$1`, id).Scan(&raw, &distance); err != nil {
		t.Fatal(err)
	}
	var stored routeNavigation
	json.Unmarshal(raw, &stored)
	expected := math.Round(roadLength([]roadPoint{start, {20.02, 50}, end})/10) / 100
	if len(stored.Coordinates) != 3 || distance != expected || stored.DistanceMeters < 3000 || stored.StartLabel != "Station A" {
		t.Fatalf("road/distance spoofed or lost: %s %v expected%v", raw, distance, expected)
	}
	// Changing road points must also repair the pricing distance, not just the map.
	db.Exec(ctx, `UPDATE routes SET distance_km=999 WHERE id=$1`, id)
	w = request(app.routeNavigation, "PATCH", id, map[string]any{"start": start, "end": end})
	if w.Code != 200 {
		t.Fatalf("edit %d %s", w.Code, w.Body)
	}
	db.QueryRow(ctx, `SELECT distance_km::float8 FROM routes WHERE id=$1`, id).Scan(&distance)
	if distance != expected {
		t.Fatalf("distance out of sync %v", distance)
	}
	failed = true
	w = request(app.createRoute, "POST", "", input)
	if w.Code != 422 || count() != 1 {
		t.Fatalf("failed road partially inserted: %d %s", w.Code, w.Body)
	}
	input.Navigation = &routeNavigation{Start: &start}
	w = request(app.createRoute, "POST", "", input)
	if w.Code != 422 || count() != 1 {
		t.Fatal("partial endpoints created route")
	}
}
