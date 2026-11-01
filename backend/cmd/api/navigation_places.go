package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

type navigationPlace struct {
	Label string    `json:"label"`
	Point roadPoint `json:"point"`
}

func cleanPlaceLabel(label string) string { return strings.Join(strings.Fields(label), " ") }
func validPlaceLabel(label string) bool {
	return utf8.ValidString(label) && utf8.RuneCountInString(label) <= 300 && !strings.ContainsFunc(label, unicode.IsControl)
}
func sameRoadPoint(a, b *roadPoint) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

// Accept only map hosts, never a general URL fetcher. Redirect checks apply to
// every hop, including short links; viewport coordinates are not a selected POI.
func googleMapsURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return nil, errors.New("Вставьте адрес или ссылку на место в Google Maps.")
	}
	switch strings.ToLower(u.Hostname()) {
	case "maps.app.goo.gl":
	case "goo.gl":
		if !strings.HasPrefix(u.Path, "/maps/") {
			return nil, errors.New("Нужна ссылка Google Maps.")
		}
	case "google.com", "www.google.com", "maps.google.com", "google.de", "www.google.de", "google.pl", "www.google.pl", "google.com.ua", "www.google.com.ua", "google.fr", "www.google.fr", "google.co.uk", "www.google.co.uk":
		if !strings.HasPrefix(u.Path, "/maps") && u.Hostname() != "maps.google.com" {
			return nil, errors.New("Нужна ссылка на место в Google Maps.")
		}
	default:
		return nil, errors.New("Поддерживаются ссылки Google Maps. Можно также вставить обычный адрес.")
	}
	return u, nil
}

var selectedGoogleCoordinate = regexp.MustCompile(`!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)`)

func parseLatLon(text string) *roadPoint {
	parts := strings.Split(strings.TrimSpace(text), ",")
	if len(parts) != 2 {
		return nil
	}
	lat, e1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	lon, e2 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	point := roadPoint{lon, lat}
	if e1 != nil || e2 != nil || !validRoadPoint(point) {
		return nil
	}
	return &point
}
func googleMapsSelection(u *url.URL) (*navigationPlace, string, error) {
	query := u.Query()
	for _, key := range []string{"query", "q", "destination"} {
		value := strings.TrimSpace(query.Get(key))
		if value == "" {
			continue
		}
		if point := parseLatLon(value); point != nil {
			return &navigationPlace{Label: "Место из Google Maps", Point: *point}, "", nil
		}
		if len(value) > 500 || strings.HasPrefix(value, "http") || strings.HasPrefix(value, "place_id:") {
			return nil, "", errors.New("Скопируйте адрес места из Google Maps.")
		}
		return nil, value, nil
	}
	if strings.HasPrefix(u.Path, "/maps/dir") {
		return nil, "", errors.New("Вставьте ссылку на место, а не на маршрут.")
	}
	name := ""
	for _, prefix := range []string{"/maps/place/", "/maps/search/"} {
		if strings.HasPrefix(u.Path, prefix) {
			name = strings.Split(strings.TrimPrefix(u.Path, prefix), "/")[0]
			name = strings.ReplaceAll(name, "+", " ")
			break
		}
	}
	matches := selectedGoogleCoordinate.FindAllStringSubmatch(u.String(), -1)
	if len(matches) > 1 {
		return nil, "", errors.New("В ссылке несколько мест. Скопируйте ссылку на одну точку.")
	}
	if len(matches) == 1 {
		point := parseLatLon(matches[0][1] + "," + matches[0][2])
		if point == nil {
			return nil, "", errors.New("Некорректная точка в ссылке.")
		}
		if name == "" {
			name = "Место из Google Maps"
		}
		return &navigationPlace{Label: cleanPlaceLabel(name), Point: *point}, "", nil
	}
	if name != "" {
		return nil, name, nil
	}
	return nil, "", errors.New("В ссылке не выбрано место. Вставьте адрес или ссылку на точку.")
}
func resolveGoogleMaps(ctx context.Context, raw string, transport http.RoundTripper) (*url.URL, error) {
	u, err := googleMapsURL(raw)
	if err != nil {
		return nil, err
	}
	if u.Hostname() != "maps.app.goo.gl" && u.Hostname() != "goo.gl" {
		return u, nil
	}
	client := http.Client{Transport: transport, Timeout: 8 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("Слишком много перенаправлений в ссылке.")
		}
		_, err := googleMapsURL(req.URL.String())
		return err
	}}
	req, _ := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	req.Header.Set("User-Agent", "VivatBus/1.0 (+https://vivat.wtmelon.store)")
	res, err := client.Do(req)
	if err != nil {
		return nil, errors.New("Не удалось открыть короткую ссылку. Вставьте полный адрес места.")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, errors.New("Ссылка недоступна. Вставьте адрес места.")
	}
	if res.Request.URL.Hostname() == "maps.app.goo.gl" || res.Request.URL.Hostname() == "goo.gl" {
		return nil, errors.New("Не удалось распознать короткую ссылку. Вставьте адрес места.")
	}
	return res.Request.URL, nil
}

type placeCacheEntry struct {
	until time.Time
	items []navigationPlace
}

var placeSearchCache = struct {
	sync.Mutex
	items map[string]placeCacheEntry
}{items: map[string]placeCacheEntry{}}
var placeSearchSlot struct {
	sync.Mutex
	next time.Time
}

func searchNavigationPlaces(ctx context.Context, base, query string) ([]navigationPlace, error) {
	key := base + "\n" + strings.ToLower(query)
	placeSearchCache.Lock()
	cached, found := placeSearchCache.items[key]
	placeSearchCache.Unlock()
	if found && time.Now().Before(cached.until) {
		return cached.items, nil
	}
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return nil, errors.New("invalid geocoding endpoint")
	}
	args := u.Query()
	args.Set("q", query)
	args.Set("limit", "6")
	u.RawQuery = args.Encode()
	placeSearchSlot.Lock()
	delay := time.Until(placeSearchSlot.next)
	if delay < 0 {
		delay = 0
	}
	placeSearchSlot.next = time.Now().Add(delay + time.Second)
	placeSearchSlot.Unlock()
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	req.Header.Set("User-Agent", "VivatBus/1.0 (+https://vivat.wtmelon.store)")
	client := http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("geocoder status %d", res.StatusCode)
	}
	var result struct {
		Features []struct {
			Geometry struct {
				Type        string     `json:"type"`
				Coordinates *roadPoint `json:"coordinates"`
			} `json:"geometry"`
			Properties struct{ Name, Street, Housenumber, City, District, State, Country string } `json:"properties"`
		} `json:"features"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&result); err != nil {
		return nil, err
	}
	places := make([]navigationPlace, 0, 6)
	seen := map[string]bool{}
	for _, item := range result.Features {
		if item.Geometry.Type != "Point" || item.Geometry.Coordinates == nil || !validRoadPoint(*item.Geometry.Coordinates) {
			continue
		}
		p := item.Properties
		parts := []string{}
		used := map[string]bool{}
		street := strings.TrimSpace(p.Street + " " + p.Housenumber)
		locality := p.City
		if locality == "" {
			locality = p.District
		}
		if locality == "" {
			locality = p.State
		}
		for _, v := range []string{p.Name, street, locality, p.Country} {
			v = cleanPlaceLabel(v)
			if v != "" && !used[v] {
				parts = append(parts, v)
				used[v] = true
			}
		}
		label := strings.Join(parts, ", ")
		id := fmt.Sprintf("%.6f,%.6f", item.Geometry.Coordinates[0], item.Geometry.Coordinates[1])
		if label == "" || !validPlaceLabel(label) || seen[id] {
			continue
		}
		seen[id] = true
		places = append(places, navigationPlace{Label: label, Point: *item.Geometry.Coordinates})
		if len(places) == 6 {
			break
		}
	}
	placeSearchCache.Lock()
	if len(placeSearchCache.items) >= 256 {
		placeSearchCache.items = map[string]placeCacheEntry{}
	}
	placeSearchCache.items[key] = placeCacheEntry{time.Now().Add(24 * time.Hour), places}
	placeSearchCache.Unlock()
	return places, nil
}

func (app *application) navigationPlaces(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) > 2048 {
		writeJSON(w, 400, map[string]string{"error": "Слишком длинный адрес или ссылка."})
		return
	}
	if r.URL.Query().Get("search") == "true" {
		if len(query) < 2 {
			writeJSON(w, 400, map[string]string{"error": "Введите адрес или название места."})
			return
		}
		if strings.HasPrefix(query, "https://") || strings.HasPrefix(query, "http://") {
			u, err := resolveGoogleMaps(r.Context(), query, http.DefaultTransport)
			if err != nil {
				writeJSON(w, 400, map[string]string{"error": err.Error()})
				return
			}
			place, address, err := googleMapsSelection(u)
			if err != nil {
				writeJSON(w, 400, map[string]string{"error": err.Error()})
				return
			}
			if place != nil {
				writeJSON(w, 200, map[string]any{"items": []navigationPlace{*place}})
				return
			}
			query = address
		} else if point := parseLatLon(query); point != nil {
			writeJSON(w, 200, map[string]any{"items": []navigationPlace{{Label: "Точка на карте", Point: *point}}})
			return
		}
		base := os.Getenv("GEOCODING_SERVICE_URL")
		if base == "" {
			base = "https://photon.komoot.io/api/"
		}
		items, err := searchNavigationPlaces(r.Context(), base, query)
		if err != nil {
			app.log.Warn("search navigation places", "error", err)
			writeJSON(w, 503, map[string]string{"error": "Не удалось найти место. Повторите поиск или выберите точку на карте."})
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT navigation,origin_name,destination_name FROM (SELECT navigation,origin_name,destination_name,updated_at FROM routes WHERE tenant_id=$1 AND navigation IS NOT NULL UNION ALL SELECT navigation,origin_name,destination_name,updated_at FROM trips WHERE tenant_id=$1 AND navigation IS NOT NULL) p ORDER BY updated_at DESC LIMIT 100`, tenant.ID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer rows.Close()
	items := make([]navigationPlace, 0)
	seen := map[string]bool{}
	for rows.Next() {
		var raw []byte
		var origin, destination string
		if err = rows.Scan(&raw, &origin, &destination); err != nil {
			app.publicFailure(w, err)
			return
		}
		var nav routeNavigation
		if json.Unmarshal(raw, &nav) != nil {
			continue
		}
		for _, p := range []struct {
			point           *roadPoint
			label, fallback string
		}{{nav.Start, nav.StartLabel, origin}, {nav.End, nav.EndLabel, destination}} {
			if p.point == nil || !validRoadPoint(*p.point) {
				continue
			}
			label := p.label
			if label == "" {
				label = p.fallback
			}
			id := fmt.Sprintf("%.6f,%.6f", p.point[0], p.point[1])
			if seen[id] || !strings.Contains(strings.ToLower(label), strings.ToLower(query)) {
				continue
			}
			seen[id] = true
			items = append(items, navigationPlace{label, *p.point})
		}
	}
	if rows.Err() != nil {
		app.publicFailure(w, rows.Err())
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
