package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRoadProgressUsesDistanceNotTime(t *testing.T) {
	now := time.Now()
	accuracy := 10.0
	// L-shaped road: midpoint is at the corner, not halfway on the diagonal.
	nav := &routeNavigation{Coordinates: []roadPoint{{20, 50}, {20.02, 50}, {20.02, 50.02}}}
	fix := &fleetLocationResponse{Latitude: 50, Longitude: 20.02, AccuracyMeters: &accuracy, RecordedAt: now}
	first := matchRoadProgress(nav, fix, now)
	if first.Percent == nil || math.Abs(*first.Percent-39.1) > 0.5 {
		t.Fatalf("not measured along road: %+v", first)
	}
	later := matchRoadProgress(nav, fix, now.Add(60*time.Second))
	if later.Percent == nil || *later.Percent != *first.Percent {
		t.Fatal("stationary car moved with time")
	}
	fix.Latitude = 50.01
	next := matchRoadProgress(nav, fix, now)
	if next.Percent == nil || *next.Percent <= *first.Percent {
		t.Fatal("position did not advance")
	}
	fix.Latitude = 50.02
	end := matchRoadProgress(nav, fix, now)
	if end.Percent == nil || math.Abs(*end.Percent-100) > 0.01 {
		t.Fatalf("end: %+v", end)
	}
	fix.Latitude = 50
	fix.Longitude = 20
	start := matchRoadProgress(nav, fix, now)
	if start.Percent == nil || *start.Percent != 0 {
		t.Fatalf("start %+v", start)
	}
}

func TestRoadProgressWithholdsUnreliablePercent(t *testing.T) {
	now := time.Now()
	accuracy := 10.0
	nav := &routeNavigation{Coordinates: []roadPoint{{20, 50}, {20.02, 50}, {20.02, 50.02}}}
	for _, tc := range []struct {
		name, want string
		nav        *routeNavigation
		fix        *fleetLocationResponse
	}{
		{"no route", "no_route", nil, nil},
		{"partial route", "no_route", &routeNavigation{}, nil},
		{"no fix", "no_gps", nav, nil},
		{"stale", "stale", nav, &fleetLocationResponse{Latitude: 50, Longitude: 20, AccuracyMeters: &accuracy, RecordedAt: now.Add(-121 * time.Second)}},
		{"future", "stale", nav, &fleetLocationResponse{Latitude: 50, Longitude: 20, AccuracyMeters: &accuracy, RecordedAt: now.Add(20 * time.Second)}},
		{"unknown accuracy", "inaccurate", nav, &fleetLocationResponse{Latitude: 50, Longitude: 20, RecordedAt: now}},
		{"off route", "off_route", nav, &fleetLocationResponse{Latitude: 51, Longitude: 21, AccuracyMeters: &accuracy, RecordedAt: now}},
		{"loop", "ambiguous", &routeNavigation{Coordinates: []roadPoint{{20, 50}, {20.02, 50}, {20.02, 50.02}, {20, 50.02}, {20, 50}}}, &fleetLocationResponse{Latitude: 50, Longitude: 20, AccuracyMeters: &accuracy, RecordedAt: now}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := matchRoadProgress(tc.nav, tc.fix, now)
			if got.Status != tc.want || got.Percent != nil {
				t.Fatalf("got %+v", got)
			}
		})
	}
	accuracy = 250
	if got := matchRoadProgress(nav, &fleetLocationResponse{AccuracyMeters: &accuracy, RecordedAt: now}, now); got.Status != "inaccurate" {
		t.Fatal(got)
	}
}

func TestBuildRoadValidatesProviderGeometry(t *testing.T) {
	start, end := roadPoint{20, 50}, roadPoint{20.02, 50.02}
	code := 200
	body := `{"code":"Ok","routes":[{"geometry":{"type":"LineString","coordinates":[[20,50],[20.02,50],[20.02,50.02]]}}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("overview") != "full" || r.URL.Query().Get("geometries") != "geojson" || r.Header.Get("User-Agent") == "" {
			t.Error("routing request missing full geometry/identification")
		}
		w.WriteHeader(code)
		fmt.Fprint(w, body)
	}))
	defer server.Close()
	nav, err := buildRoad(context.Background(), server.URL, routeNavigation{Start: &start, End: &end})
	if err != nil || len(nav.Coordinates) != 3 || nav.DistanceMeters < 3000 {
		t.Fatalf("%+v %v", nav, err)
	}
	for _, bad := range []string{`{"code":"NoRoute"}`, `{"code":"Ok","routes":[{"geometry":{"type":"LineString","coordinates":[[0,0],[0,1]]}}]}`, `{"code":"Ok","routes":[{"geometry":{"type":"LineString","coordinates":[[200,50],[20,50]]}}]}`, `<html>bad gateway</html>`} {
		body = bad
		if _, err = buildRoad(context.Background(), server.URL, routeNavigation{Start: &start, End: &end}); err == nil {
			t.Fatal("invalid geometry accepted", body)
		}
	}
	code = 503
	if _, err = buildRoad(context.Background(), server.URL, routeNavigation{Start: &start, End: &end}); err == nil {
		t.Fatal("provider failure accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = buildRoad(ctx, server.URL, routeNavigation{Start: &start, End: &end}); err == nil {
		t.Fatal("cancelled request accepted")
	}
	if _, err = buildRoad(context.Background(), "file:///secret", routeNavigation{Start: &start, End: &end}); err == nil {
		t.Fatal("invalid provider URL accepted")
	}
	partial, err := buildRoad(context.Background(), server.URL, routeNavigation{Start: &start})
	if err != nil || partial.Start == nil || len(partial.Coordinates) != 0 {
		t.Fatal("partial endpoint not retained")
	}
	if _, err = buildRoad(context.Background(), server.URL, routeNavigation{Start: &start, End: &start}); err == nil {
		t.Fatal("same endpoints accepted")
	}
	raw, _ := json.Marshal(nav)
	if len(raw) == 0 {
		t.Fatal("cannot persist geometry")
	}
}
