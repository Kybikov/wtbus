package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// These tests never use production data. Both URLs must point to disposable
// services with all migrations applied.
func TestPublicBookingPostgres(t *testing.T) {
	databaseURL, redisURL := os.Getenv("PUBLIC_TEST_DATABASE_URL"), os.Getenv("PUBLIC_TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("set disposable PUBLIC_TEST_DATABASE_URL and PUBLIC_TEST_REDIS_URL")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	cache := redis.NewClient(options)
	t.Cleanup(func() { cache.Close() })
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	handler := app.routes()
	slug := fmt.Sprintf("public-test-%d", time.Now().UnixNano())
	var tenantID, routeID, tripID string
	row := func(query string, dest *string, args ...any) {
		t.Helper()
		if err := db.QueryRow(ctx, query, args...).Scan(dest); err != nil {
			t.Fatal(err)
		}
	}
	row(`INSERT INTO tenants(slug,name,timezone) VALUES($1,'Public Test','UTC') RETURNING id::text`, &tenantID, slug)
	var actorID string
	t.Cleanup(func() {
		// Clear only this fixture's records and throttle counters.
		db.QueryRow(ctx, `SELECT id::text FROM users WHERE email=$1`, systemActorEmail(tenantID)).Scan(&actorID)
		db.Exec(ctx, `DELETE FROM public_booking_requests WHERE tenant_id=$1`, tenantID)
		db.Exec(ctx, `DELETE FROM bookings WHERE tenant_id=$1`, tenantID)
		db.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, tenantID)
		if actorID != "" {
			db.Exec(ctx, `DELETE FROM users WHERE id=$1`, actorID)
		}
		iter := cache.Scan(ctx, 0, "public:*:"+tenantID+"*", 0).Iterator()
		for iter.Next(ctx) {
			cache.Del(ctx, iter.Val())
		}
	})
	row(`INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency) VALUES($1,'A-B','Київ','Варшава','EUR') RETURNING id::text`, &routeID, tenantID)
	starts := time.Now().UTC().AddDate(0, 0, 2).Truncate(24 * time.Hour).Add(12 * time.Hour)
	row(`INSERT INTO trips(tenant_id,route_id,kind,status,origin_name,destination_name,starts_at,ends_at,capacity,price_minor,currency) VALUES($1,$2,'regular','assigned','Київ','Варшава',$3,$4,3,2500,'EUR') RETURNING id::text`, &tripID, tenantID, routeID, starts, starts.Add(8*time.Hour))
	if _, err = db.Exec(ctx, `INSERT INTO custom_field_definitions(tenant_id,entity_type,field_key,label,field_type,is_required) VALUES($1,'booking','document','Документ','text',true)`, tenantID); err != nil {
		t.Fatal(err)
	}
	send := func(method, path string, input any) *httptest.ResponseRecorder {
		var body bytes.Buffer
		if input != nil {
			json.NewEncoder(&body).Encode(input)
		}
		request := httptest.NewRequest(method, "/api/v1/public/"+slug+path, &body)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	makeInput := func(index int) publicBookingInput {
		return publicBookingInput{RequestKey: fmt.Sprintf("00000000-0000-4000-8000-%012d", index), TripID: tripID, QuotedPriceMinor: 2500, Seats: 1, PassengerName: "Тестовий пасажир", PassengerPhone: fmt.Sprintf("+380670%06d", index), PassengerBirthDate: "1990-01-01", Consent: true, CustomData: map[string]any{"document": "fixture"}}
	}
	assertStatus := func(t *testing.T, response *httptest.ResponseRecorder, status int) {
		t.Helper()
		if response.Code != status {
			t.Fatalf("status %d expected %d: %s", response.Code, status, response.Body)
		}
	}
	searchPath := "/trips?" + url.Values{"origin": {"Київ"}, "destination": {"Варшава"}, "date": {starts.Format("2006-01-02")}, "seats": {"1"}}.Encode()

	t.Run("anonymous catalog and minimal search", func(t *testing.T) {
		response := send("GET", "/catalog", nil)
		assertStatus(t, response, 200)
		if !strings.Contains(response.Body.String(), "Київ") || !strings.Contains(response.Body.String(), "Документ") {
			t.Fatal(response.Body)
		}
		response = send("GET", searchPath, nil)
		assertStatus(t, response, 200)
		if !strings.Contains(response.Body.String(), tripID) || strings.Contains(response.Body.String(), "customer") || strings.Contains(response.Body.String(), "driver") {
			t.Fatal(response.Body)
		}
		assertStatus(t, send("GET", "/trips?seats=0", nil), 400)
		unknown := strings.Replace(searchPath, url.QueryEscape("Київ"), url.QueryEscape("Вигадане місто"), 1)
		response = send("GET", unknown, nil)
		assertStatus(t, response, 200)
		if !strings.Contains(response.Body.String(), `"items":[]`) {
			t.Fatal(response.Body)
		}
	})
	t.Run("validation rejects client pricing and private identities", func(t *testing.T) {
		var otherTenantID string
		otherSlug := slug + "-other"
		row(`INSERT INTO tenants(slug,name) VALUES($1,'Other') RETURNING id::text`, &otherTenantID, otherSlug)
		defer db.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, otherTenantID)
		var otherBody bytes.Buffer
		otherInput := makeInput(6)
		otherInput.CustomData = nil
		json.NewEncoder(&otherBody).Encode(otherInput)
		otherResponse := httptest.NewRecorder()
		handler.ServeHTTP(otherResponse, httptest.NewRequest("POST", "/api/v1/public/"+otherSlug+"/bookings", &otherBody))
		assertStatus(t, otherResponse, 409)
		privateResponse := httptest.NewRecorder()
		handler.ServeHTTP(privateResponse, httptest.NewRequest("GET", "/api/v1/tenants/"+slug+"/bookings", nil))
		assertStatus(t, privateResponse, 401)
		input := makeInput(1)
		input.QuotedPriceMinor = 1
		assertStatus(t, send("POST", "/bookings", input), 409)
		input = makeInput(2)
		input.Consent = false
		assertStatus(t, send("POST", "/bookings", input), 400)
		input = makeInput(3)
		input.CustomData = nil
		assertStatus(t, send("POST", "/bookings", input), 400)
		input = makeInput(4)
		input.PassengerBirthDate = "2990-01-01"
		assertStatus(t, send("POST", "/bookings", input), 400)
		input = makeInput(5)
		input.TripID = "00000000-0000-4000-8000-999999999999"
		assertStatus(t, send("POST", "/bookings", input), 409)
		assertStatus(t, send("POST", "/bookings", map[string]any{"customerId": "private", "tripId": tripID}), 400)
	})
	var first publicConfirmation
	t.Run("cash checkout is idempotent and counted in automation", func(t *testing.T) {
		input := makeInput(10)
		input.Seats = 2
		created := send("POST", "/bookings", input)
		assertStatus(t, created, 201)
		var payload struct {
			Item publicConfirmation `json:"item"`
		}
		if err = json.Unmarshal(created.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		first = payload.Item
		if first.Status != "cash_on_boarding" || first.PriceMinor != 5000 {
			t.Fatal(created.Body)
		}
		repeated := send("POST", "/bookings", input)
		assertStatus(t, repeated, 200)
		if repeated.Body.String() != created.Body.String() {
			t.Fatal("idempotency response changed")
		}
		input.Seats = 1
		assertStatus(t, send("POST", "/bookings", input), 409)
		input = makeInput(11)
		input.PassengerPhone = makeInput(10).PassengerPhone
		input.PassengerName = "Should not overwrite"
		assertStatus(t, send("POST", "/bookings", input), 409)
		var count int
		var customerName, source string
		if err = db.QueryRow(ctx, `SELECT count(*) FROM activity_events WHERE tenant_id=$1 AND actor_kind='system' AND action='public_booking_created'`, tenantID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("activity count %d: %v", count, err)
		}
		if err = db.QueryRow(ctx, `SELECT c.full_name,b.source FROM bookings b JOIN customers c ON c.id=b.customer_id WHERE b.id=$1`, first.Reference).Scan(&customerName, &source); err != nil || customerName != "Тестовий пасажир" || source != "web" {
			t.Fatalf("customer/source %s %s: %v", customerName, source, err)
		}
	})
	t.Run("concurrent checkout never oversells final seat", func(t *testing.T) {
		var wait sync.WaitGroup
		codes := make(chan int, 8)
		for index := 20; index < 28; index++ {
			wait.Add(1)
			go func(index int) { defer wait.Done(); codes <- send("POST", "/bookings", makeInput(index)).Code }(index)
		}
		wait.Wait()
		close(codes)
		successes := 0
		for code := range codes {
			if code == 201 {
				successes++
			} else if code != 409 {
				t.Fatalf("unexpected concurrent status %d", code)
			}
		}
		if successes != 1 {
			t.Fatalf("created %d bookings for one remaining seat", successes)
		}
		response := send("GET", searchPath, nil)
		assertStatus(t, response, 200)
		if !strings.Contains(response.Body.String(), `"items":[]`) {
			t.Fatal("full trip remained available", response.Body)
		}
	})
	t.Run("blocked disabled departed and suspended sales", func(t *testing.T) {
		if _, err = db.Exec(ctx, `UPDATE bookings SET status='cancelled' WHERE tenant_id=$1`, tenantID); err != nil {
			t.Fatal(err)
		}
		checkClosed := func() {
			t.Helper()
			response := send("GET", searchPath, nil)
			assertStatus(t, response, 200)
			if !strings.Contains(response.Body.String(), `"items":[]`) {
				t.Fatal(response.Body)
			}
			assertStatus(t, send("POST", "/bookings", makeInput(30)), 409)
		}
		db.Exec(ctx, `UPDATE routes SET is_active=false WHERE id=$1`, routeID)
		checkClosed()
		db.Exec(ctx, `UPDATE routes SET is_active=true WHERE id=$1`, routeID)
		var block string
		row(`INSERT INTO availability_blocks(tenant_id,route_id,starts_at,ends_at) VALUES($1,$2,$3,$4) RETURNING id::text`, &block, tenantID, routeID, starts, starts.Add(time.Hour))
		checkClosed()
		db.Exec(ctx, `DELETE FROM availability_blocks WHERE id=$1`, block)
		db.Exec(ctx, `UPDATE trips SET status='in_progress' WHERE id=$1`, tripID)
		checkClosed()
		db.Exec(ctx, `UPDATE trips SET status='new',starts_at=now()-interval '1 hour' WHERE id=$1`, tripID)
		assertStatus(t, send("POST", "/bookings", makeInput(31)), 409)
		db.Exec(ctx, `UPDATE tenants SET subscription_status='suspended' WHERE id=$1`, tenantID)
		assertStatus(t, send("POST", "/bookings", makeInput(32)), 503)
	})
}
