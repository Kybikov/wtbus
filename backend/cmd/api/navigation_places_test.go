package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

func TestGoogleMapsPlaceSelection(t *testing.T) {
	for _, tc := range []struct {
		raw, address, label string
		point               *roadPoint
		bad                 bool
	}{
		{raw: "https://www.google.com/maps/place/Krakow+Station/@1,2,8z/data=!4m2!3d50.061!4d19.938", label: "Krakow Station", point: &roadPoint{19.938, 50.061}},
		{raw: "https://maps.google.com/?q=50.061,19.938", point: &roadPoint{19.938, 50.061}},
		{raw: "https://www.google.com/maps/search/?api=1&query=Krakow+Bosacka+18", address: "Krakow Bosacka 18"},
		{raw: "https://www.google.de/maps/place/Bosacka+18/", address: "Bosacka 18"},
		{raw: "https://www.google.com/maps/@50.061,19.938,15z", bad: true},
		{raw: "https://www.google.com/maps/dir/A/B/@50,19,6z/data=!3d50!4d19!3d51!4d20", bad: true},
		{raw: "https://www.google.com/maps/place/A/data=!3d95!4d19", bad: true},
		{raw: "https://www.google.com/maps/place/A/data=!3d50!4d19!3d51!4d20", bad: true},
		{raw: "https://www.google.com/maps/?query=place_id:123", bad: true},
	} {
		t.Run(tc.raw, func(t *testing.T) {
			u, err := url.Parse(tc.raw)
			if err != nil {
				t.Fatal(err)
			}
			place, address, err := googleMapsSelection(u)
			if tc.bad {
				if err == nil {
					t.Fatal("ambiguous map accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if address != tc.address {
				t.Fatalf("address %q", address)
			}
			if tc.point != nil && (place == nil || place.Point != *tc.point) {
				t.Fatalf("point %+v", place)
			}
			if tc.label != "" && place.Label != tc.label {
				t.Fatal(place.Label)
			}
		})
	}
	for _, raw := range []string{"http://maps.app.goo.gl/test", "https://evil.example/maps", "https://google.com.evil.example/maps", "https://www.google.com:8443/maps", "https://user:pass@www.google.com/maps", "https://goo.gl/other", "https://www.google.com/search?q=address", "https://127.0.0.1/maps"} {
		if _, err := googleMapsURL(raw); err == nil {
			t.Fatal("unsafe map host accepted", raw)
		}
	}
}

func TestGoogleShortLinkRedirectBoundaries(t *testing.T) {
	for _, destination := range []string{"https://127.0.0.1/private", "http://www.google.com/maps", "https://www.google.com.evil.example/maps", "https://www.google.com:8080/maps"} {
		var calls atomic.Int32
		transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
			calls.Add(1)
			return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{destination}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		})
		if _, err := resolveGoogleMaps(context.Background(), "https://maps.app.goo.gl/test", transport); err == nil || calls.Load() != 1 {
			t.Fatalf("unsafe redirect reached %s calls=%d err=%v", destination, calls.Load(), err)
		}
	}
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "maps.app.goo.gl" {
			return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://www.google.com/maps/place/Station/data=!3d50.061!4d19.938"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	u, err := resolveGoogleMaps(context.Background(), "https://maps.app.goo.gl/test", transport)
	if err != nil {
		t.Fatal(err)
	}
	place, _, err := googleMapsSelection(u)
	if err != nil || place == nil || place.Point != (roadPoint{19.938, 50.061}) {
		t.Fatalf("short link %+v %v", place, err)
	}
}

func TestPlaceSearchValidatesAndCachesProvider(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Query().Get("q") != "Krakow station" || r.Header.Get("User-Agent") == "" {
			t.Error("missing query or app identification")
		}
		fmt.Fprint(w, `{"features":[{"geometry":{"type":"Point","coordinates":[19.938,50.061]},"properties":{"name":"Station","street":"Bosacka","housenumber":"18","city":"Krakow","country":"Poland"}},{"geometry":{"type":"Point","coordinates":[999,50]},"properties":{"name":"Bad"}},{"geometry":{"type":"Point","coordinates":[19.938,50.061]},"properties":{"name":"Duplicate"}}]}`)
	}))
	defer server.Close()
	for i := 0; i < 2; i++ {
		places, err := searchNavigationPlaces(context.Background(), server.URL, "Krakow station")
		if err != nil || len(places) != 1 || places[0].Label != "Station, Bosacka 18, Krakow, Poland" {
			t.Fatalf("%+v %v", places, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("cache missed", calls.Load())
	}
	failure := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer failure.Close()
	if _, err := searchNavigationPlaces(context.Background(), failure.URL, "address"); err == nil {
		t.Fatal("provider failure hidden")
	}
	invalid := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `<html>gateway</html>`) }))
	defer invalid.Close()
	if _, err := searchNavigationPlaces(context.Background(), invalid.URL, "address"); err == nil {
		t.Fatal("HTML accepted")
	}
	if validPlaceLabel(strings.Repeat("a", 301)) || validPlaceLabel("address\x00value") {
		t.Fatal("invalid label accepted")
	}
}
