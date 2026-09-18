package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func TestNotificationsPostgres(t *testing.T) {
	databaseURL := os.Getenv("NOTIFICATION_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set NOTIFICATION_TEST_DATABASE_URL to a disposable local PostgreSQL instance")
	}
	ctx := context.Background()
	root, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := fmt.Sprintf("notification_test_%d", time.Now().UnixNano())
	if _, err = root.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	defer root.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		sql, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migration %s: %v", file, err)
		}
	}
	cacheServer := miniredis.RunT(t)
	cache := redis.NewClient(&redis.Options{Addr: cacheServer.Addr()})
	defer cache.Close()
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := app.ensurePushKeys(ctx); err != nil {
		t.Fatal(err)
	}
	originalKey := app.pushPublicKey
	if err := app.ensurePushKeys(ctx); err != nil || app.pushPublicKey != originalKey {
		t.Fatal("VAPID keys changed across restart", err)
	}
	row := func(query string, args ...any) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, query, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	tenant := row(`INSERT INTO tenants(slug,name) VALUES('notification-test','Notifications') RETURNING id::text`)
	otherTenant := row(`INSERT INTO tenants(slug,name) VALUES('notification-other','Other') RETURNING id::text`)
	user := func(email string) string {
		return row(`INSERT INTO users(email,display_name) VALUES($1,'Test') RETURNING id::text`, email)
	}
	member := func(company, role string) identity {
		u := user(fmt.Sprintf("%s-%s-%d@test.invalid", company, role, time.Now().UnixNano()))
		m := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) RETURNING id::text`, company, u, role)
		return identity{UserID: u, MembershipID: m, TenantID: company, Role: role}
	}
	owner, driver, other := member(tenant, "owner"), member(tenant, "driver"), member(otherTenant, "owner")
	driverID := row(`INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164) VALUES($1,$2,'Driver','+380670001111') RETURNING id::text`, tenant, driver.MembershipID)
	ownerSession, err := app.createSession(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	driverSession, err := app.createSession(ctx, driver)
	if err != nil {
		t.Fatal(err)
	}
	otherSession, err := app.createSession(ctx, other)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("CORS_ORIGIN", "http://localhost:3001")
	handler := app.routes()
	request := func(method, path, token string, body any) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	t.Run("transactional events and tenant scoped inbox", func(t *testing.T) {
		tx, err := db.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO routes(tenant_id,name,origin_name,destination_name,currency) VALUES($1,'Rollback','A','B','UAH')`, tenant)
		if err != nil {
			t.Fatal(err)
		}
		tx.Rollback(ctx)
		if count := row(`SELECT count(*)::text FROM realtime_events WHERE tenant_id=$1 AND entity='routes'`, tenant); count != "0" {
			t.Fatal("rollback emitted event", count)
		}
		trip := row(`INSERT INTO trips(tenant_id,driver_id,kind,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,$2,'regular','A','B',now()+interval '1 day',now()+interval '2 days',10,'UAH') RETURNING id::text`, tenant, driverID)
		for _, token := range []string{ownerSession.SessionToken, driverSession.SessionToken} {
			w := request("GET", "/api/v1/me/notifications", token, nil)
			if w.Code != 200 || !strings.Contains(w.Body.String(), "Обновление рейса") {
				t.Fatalf("inbox: %d %s", w.Code, w.Body.String())
			}
		}
		w := request("GET", "/api/v1/me/notifications", otherSession.SessionToken, nil)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"items":[]`) {
			t.Fatalf("tenant leak: %d %s", w.Code, w.Body.String())
		}
		foreign := row(`SELECT id::text FROM app_notifications WHERE membership_id=$1 LIMIT 1`, driver.MembershipID)
		w = request("PATCH", "/api/v1/me/notifications", ownerSession.SessionToken, map[string]any{"id": foreign})
		if w.Code != 200 {
			t.Fatal(w.Code)
		}
		if count := row(`SELECT count(*)::text FROM app_notifications WHERE id=$1 AND read_at IS NULL`, foreign); count != "1" {
			t.Fatal("cross-member read mutation")
		}
		customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Private Customer','+380670002222') RETURNING id::text`, tenant)
		booking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,seats,price_minor,currency,source) VALUES($1,$2,$3,2,1000,'UAH','telegram') RETURNING id::text`, tenant, trip, customer)
		exec(`INSERT INTO individual_transfer_requests(tenant_id,customer_id,origin_name,destination_name,requested_departure_at,passenger_name,passenger_phone_e164,passenger_birth_date,seats) VALUES($1,$2,'Kyiv','Warsaw',now()+interval '2 days','Private Customer','+380670002222','1990-01-01',2)`, tenant, customer)
		exec(`INSERT INTO payments(tenant_id,booking_id,provider,amount_minor,currency,idempotency_key,payment_method) VALUES($1,$2,'internal',1000,'UAH','notification-test','bank_transfer')`, tenant, booking)
		exec(`UPDATE payments SET status='paid' WHERE tenant_id=$1 AND idempotency_key='notification-test'`, tenant)
		if row(`SELECT count(*)::text FROM app_notifications WHERE membership_id=$1 AND category='newRequests'`, owner.MembershipID) != "1" {
			t.Fatal("bot request was not captured")
		}
		if row(`SELECT count(*)::text FROM app_notifications WHERE membership_id=$1 AND category='newBookings'`, driver.MembershipID) != "1" {
			t.Fatal("driver booking was not captured")
		}
		if row(`SELECT count(*)::text FROM app_notifications WHERE membership_id=$1 AND category='payments'`, owner.MembershipID) != "2" {
			t.Fatal("manual payment events were not captured")
		}
		if row(`SELECT count(*)::text FROM app_notifications WHERE membership_id=$1 AND category IN ('payments','newRequests')`, driver.MembershipID) != "0" {
			t.Fatal("driver received finance/request alerts")
		}
		if row(`SELECT count(*)::text FROM app_notifications WHERE body LIKE '%Private Customer%' OR body LIKE '%380670002222%'`) != "0" {
			t.Fatal("personal data in native payload")
		}
		exec(`INSERT INTO app_notifications(membership_id,category,title,body,url) SELECT $1,'test','History','History','/profile' FROM generate_series(1,55)`, owner.MembershipID)
		first := request("GET", "/api/v1/me/notifications", ownerSession.SessionToken, nil)
		var page struct {
			Items []struct {
				ID string `json:"id"`
			}
			Next string `json:"next"`
		}
		if json.Unmarshal(first.Body.Bytes(), &page) != nil || len(page.Items) != 50 || page.Next == "" {
			t.Fatal("pagination first page", first.Body.String())
		}
		second := request("GET", "/api/v1/me/notifications?before="+page.Next, ownerSession.SessionToken, nil)
		var rest struct {
			Items []struct {
				ID string `json:"id"`
			}
			Next string `json:"next"`
		}
		if json.Unmarshal(second.Body.Bytes(), &rest) != nil || len(rest.Items) != 10 || rest.Next != "" {
			t.Fatal("pagination second page", second.Body.String())
		}
		seen := make(map[string]bool)
		for _, item := range page.Items {
			seen[item.ID] = true
		}
		for _, item := range rest.Items {
			if seen[item.ID] {
				t.Fatal("duplicate across history pages")
			}
		}
	})
	t.Run("encrypted delivery, retry, revoked sessions and expired endpoints", func(t *testing.T) {
		s := testPushSubscription(t)
		w := request("POST", "/api/v1/me/push", ownerSession.SessionToken, map[string]any{"subscription": s})
		if w.Code != 200 {
			t.Fatalf("subscribe %d %s", w.Code, w.Body.String())
		}
		exec(`INSERT INTO notification_preferences(membership_id,categories) VALUES($1,'{"newRequests":true,"newBookings":true,"payments":true,"trips":true}')`, owner.MembershipID)
		addJob := func() string {
			n := row(`INSERT INTO app_notifications(membership_id,category,title,body,url) VALUES($1,'trips','Test','Body','/trips') RETURNING id::text`, owner.MembershipID)
			return row(`INSERT INTO push_jobs(notification_id,subscription_id) SELECT $1,id FROM push_subscriptions WHERE membership_id=$2 RETURNING id::text`, n, owner.MembershipID)
		}
		saved := pushHTTPClient
		defer func() { pushHTTPClient = saved }()
		attempts := 0
		status := 503
		pushHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			attempts++
			data, _ := io.ReadAll(r.Body)
			if r.Header.Get("Content-Encoding") != "aes128gcm" || !strings.Contains(r.Header.Get("Authorization"), "vapid") || bytes.Contains(data, []byte("Body")) {
				t.Error("push is not encrypted/VAPID-authenticated")
			}
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
		})}
		job := addJob()
		if err := app.deliverPush(ctx); err != nil {
			t.Fatal(err)
		}
		if attempts != 1 || row(`SELECT count(*)::text FROM push_jobs WHERE id=$1 AND finished_at IS NULL AND available_at>now() AND locked_until IS NULL`, job) != "1" {
			t.Fatal("retry was not retained")
		}
		exec(`UPDATE push_jobs SET available_at=now() WHERE id=$1`, job)
		status = 201
		if err := app.deliverPush(ctx); err != nil {
			t.Fatal(err)
		}
		if row(`SELECT count(*)::text FROM push_jobs WHERE id=$1 AND finished_at IS NOT NULL`, job) != "1" {
			t.Fatal("success not marked")
		}
		before := attempts
		exec(`UPDATE notification_preferences SET categories=jsonb_set(categories,'{trips}','false') WHERE membership_id=$1`, owner.MembershipID)
		addJob()
		if err := app.deliverPush(ctx); err != nil {
			t.Fatal(err)
		}
		if attempts != before {
			t.Fatal("disabled category delivered")
		}
		exec(`UPDATE notification_preferences SET categories=jsonb_set(categories,'{trips}','true') WHERE membership_id=$1`, owner.MembershipID)
		addJob()
		status = 410
		if err := app.deliverPush(ctx); err != nil {
			t.Fatal(err)
		}
		if row(`SELECT count(*)::text FROM push_subscriptions WHERE membership_id=$1`, owner.MembershipID) != "0" {
			t.Fatal("expired endpoint retained")
		}
		w = request("POST", "/api/v1/me/push", ownerSession.SessionToken, map[string]any{"subscription": s})
		if w.Code != 200 {
			t.Fatal(w.Code)
		}
		addJob()
		before = attempts
		exec(`UPDATE user_sessions SET revoked_at=now() WHERE membership_id=$1`, owner.MembershipID)
		if err := app.deliverPush(ctx); err != nil {
			t.Fatal(err)
		}
		if attempts != before {
			t.Fatal("revoked session delivered push")
		}
		ownerSession, err = app.createSession(ctx, owner)
		if err != nil {
			t.Fatal(err)
		}
	})
	t.Run("WebSocket authentication, origin and tenant isolation", func(t *testing.T) {
		server := httptest.NewServer(handler)
		defer server.Close()
		if address := os.Getenv("NOTIFICATION_TEST_API_ADDRESS"); address != "" {
			listener, err := net.Listen("tcp", address)
			if err != nil {
				t.Fatal(err)
			}
			external := &http.Server{Handler: handler}
			go external.Serve(listener)
			defer external.Close()
		}
		base := server.URL
		if frontend := os.Getenv("NOTIFICATION_TEST_FRONTEND_URL"); frontend != "" {
			base = frontend
			check, err := http.NewRequest("GET", base+"/api/notifications?resource=push", nil)
			if err != nil {
				t.Fatal(err)
			}
			check.AddCookie(&http.Cookie{Name: "vivat_session", Value: ownerSession.SessionToken})
			result, err := http.DefaultClient.Do(check)
			if err != nil {
				t.Fatal(err)
			}
			payload, _ := io.ReadAll(result.Body)
			result.Body.Close()
			if result.StatusCode != 200 || !bytes.Contains(payload, []byte(app.pushPublicKey)) || bytes.Contains(payload, []byte(app.pushPrivateKey)) {
				t.Fatalf("frontend push config boundary: %d %s", result.StatusCode, payload)
			}
			check, err = http.NewRequest("PATCH", base+"/api/notifications", strings.NewReader(`{"all":true}`))
			if err != nil {
				t.Fatal(err)
			}
			check.AddCookie(&http.Cookie{Name: "vivat_session", Value: ownerSession.SessionToken})
			check.Header.Set("Origin", "https://evil.example")
			check.Header.Set("Content-Type", "application/json")
			result, err = http.DefaultClient.Do(check)
			if err != nil {
				t.Fatal(err)
			}
			result.Body.Close()
			if result.StatusCode != 403 {
				t.Fatal("frontend CSRF boundary", result.StatusCode)
			}
		}
		socketPath := "/api/v1/realtime"
		if os.Getenv("NOTIFICATION_TEST_FRONTEND_URL") != "" {
			socketPath = "/api/realtime"
		}
		dial := func(token, origin string) (*websocket.Conn, *http.Response, error) {
			return websocket.Dial(ctx, strings.Replace(base, "http", "ws", 1)+socketPath, &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": []string{"vivat_session=" + token}, "Origin": []string{origin}}})
		}
		conn, response, err := dial("bad", "http://localhost:3001")
		if err == nil {
			conn.CloseNow()
			t.Fatal("unauthenticated WebSocket")
		}
		if response == nil || response.StatusCode != 401 {
			t.Fatal("expected401", response, err)
		}
		conn, response, err = dial(ownerSession.SessionToken, "https://evil.example")
		if err == nil {
			conn.CloseNow()
			t.Fatal("cross-origin WebSocket")
		}
		if response == nil || response.StatusCode != 403 {
			t.Fatal("expected403", response, err)
		}
		conn, _, err = dial(ownerSession.SessionToken, "http://localhost:3001")
		if err != nil {
			t.Fatal(err)
		}
		defer conn.CloseNow()
		read := func(c *websocket.Conn) string {
			t.Helper()
			timeout, stop := context.WithTimeout(ctx, 3*time.Second)
			defer stop()
			_, payload, err := c.Read(timeout)
			if err != nil {
				t.Fatal(err)
			}
			return string(payload)
		}
		if !strings.Contains(read(conn), "ready") {
			t.Fatal("missing initial resync")
		}
		exec(`UPDATE realtime_events SET published_at=now()`)
		exec(`INSERT INTO realtime_events(tenant_id,entity) VALUES($1,'other_company')`, otherTenant)
		exec(`INSERT INTO realtime_events(tenant_id,entity) VALUES($1,'bookings')`, tenant)
		if err := app.publishRealtime(ctx); err != nil {
			t.Fatal(err)
		}
		if payload := read(conn); !strings.Contains(payload, "bookings") || strings.Contains(payload, "other_company") {
			t.Fatal("tenant isolation failed", payload)
		}
		driverConn, _, err := dial(driverSession.SessionToken, "http://localhost:3001")
		if err != nil {
			t.Fatal(err)
		}
		defer driverConn.CloseNow()
		read(driverConn)
		exec(`INSERT INTO realtime_events(tenant_id,entity) VALUES($1,'not_driver')`, tenant)
		exec(`INSERT INTO realtime_events(tenant_id,entity,driver_membership_id) VALUES($1,'trips',$2)`, tenant, driver.MembershipID)
		if err := app.publishRealtime(ctx); err != nil {
			t.Fatal(err)
		}
		if payload := read(driverConn); !strings.Contains(payload, "trips") || strings.Contains(payload, "not_driver") {
			t.Fatal("driver isolation failed", payload)
		}
		// An already-open connection must be closed after session revocation, not just on next login.
		exec(`UPDATE user_sessions SET revoked_at=now() WHERE membership_id=$1`, owner.MembershipID)
		timeout, stop := context.WithTimeout(ctx, 32*time.Second)
		defer stop()
		for {
			_, _, err := conn.Read(timeout)
			if err != nil {
				if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
					t.Fatal("revoked socket not closed with policy violation", err)
				}
				break
			}
		}
	})
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
