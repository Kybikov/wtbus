package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/alicebob/miniredis/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/vivat-bus/tms/internal/notificationprefs"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func deliveryTestDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("NOTIFICATION_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set NOTIFICATION_TEST_DATABASE_URL to an isolated PostgreSQL instance")
	}
	ctx := context.Background()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := fmt.Sprintf("delivery_test_%d", time.Now().UnixNano())
	if _, err = root.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = root.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE") })
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	files, _ := filepath.Glob("../../migrations/*.up.sql")
	for _, file := range files {
		sql, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migration %s: %v", file, err)
		}
	}
	return db
}
func TestNotificationDeliveryPostgres(t *testing.T) {
	ctx := context.Background()
	db := deliveryTestDatabase(t)
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	defer cache.Close()
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := app.ensurePushKeys(ctx); err != nil {
		t.Fatal(err)
	}
	row := func(sql string, args ...any) string {
		t.Helper()
		var value string
		if err := db.QueryRow(ctx, sql, args...).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	company := row(`INSERT INTO tenants(slug,name) VALUES('delivery-test','Delivery') RETURNING id::text`)
	foreign := row(`INSERT INTO tenants(slug,name) VALUES('delivery-other','Other') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('delivery-owner@test.invalid','Owner') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner') RETURNING id::text`, company, user)
	actor := identity{UserID: user, MembershipID: member, TenantID: company, TenantSlug: "delivery-test", Role: "owner"}
	session, err := app.createSession(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	handler := app.routes()
	request := func(method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+session.SessionToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	exec(`INSERT INTO tenant_integration_secrets(tenant_id,telegram_bot_token) VALUES($1,'123456789:test-only-token')`, company)
	savedTelegram, savedPush := notificationTelegramClient, pushHTTPClient
	defer func() { notificationTelegramClient = savedTelegram; pushHTTPClient = savedPush }()
	telegramCalls, pushCalls := 0, 0
	providerStatus := 200
	notificationTelegramClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		body := `{"ok":true,"result":{"username":"vivat_qa_bot"}}`
		if strings.HasSuffix(r.URL.Path, "/sendMessage") {
			telegramCalls++
			raw, _ := io.ReadAll(r.Body)
			if bytes.Contains(raw, []byte("Private Passenger")) {
				t.Error("personal data in staff message")
			}
			body = `{"ok":true,"result":{"message_id":1}}`
			if providerStatus != 200 {
				body = fmt.Sprintf(`{"ok":false,"error_code":%d}`, providerStatus)
			}
		}
		return &http.Response{StatusCode: providerStatus, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	pushHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		pushCalls++
		return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
	})}
	newLink := func() string {
		t.Helper()
		w := request("POST", "/api/v1/me/telegram", map[string]string{"action": "link"})
		if w.Code != 200 {
			t.Fatalf("link failed %d %s", w.Code, w.Body.String())
		}
		var payload struct {
			URL string `json:"url"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &payload)
		u, _ := url.Parse(payload.URL)
		return strings.TrimPrefix(u.Query().Get("start"), "staff_")
	}
	t.Run("single use company-bound expiring links", func(t *testing.T) {
		code := newLink()
		if ok, err := notificationprefs.ClaimTelegramLink(ctx, db, foreign, code, 1001, "tester"); err != nil || ok {
			t.Fatal("foreign bot consumed link", err)
		}
		exec(`UPDATE staff_telegram_link_tokens SET expires_at=now()-interval '1 second' WHERE membership_id=$1`, member)
		if ok, _ := notificationprefs.ClaimTelegramLink(ctx, db, company, code, 1001, "tester"); ok {
			t.Fatal("expired link accepted")
		}
		code = newLink()
		if ok, err := notificationprefs.ClaimTelegramLink(ctx, db, company, code, 1001, "tester"); err != nil || !ok {
			t.Fatal("valid link failed", err)
		}
		if ok, _ := notificationprefs.ClaimTelegramLink(ctx, db, company, code, 2002, "other"); ok {
			t.Fatal("used token replayed")
		}
		w := request("GET", "/api/v1/me/telegram", nil)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"username":"tester"`) {
			t.Fatal(w.Code, w.Body.String())
		}
	})
	t.Run("transactional booking and custom cancellation events", func(t *testing.T) {
		trip := row(`INSERT INTO trips(tenant_id,kind,origin_name,destination_name,starts_at,ends_at,capacity,currency) VALUES($1,'regular','A','B',now()+interval '1 day',now()+interval '2 days',10,'UAH') RETURNING id::text`, company)
		customer := row(`INSERT INTO customers(tenant_id,full_name,phone_e164) VALUES($1,'Private Passenger','+380670000123') RETURNING id::text`, company)
		booking := row(`INSERT INTO bookings(tenant_id,trip_id,customer_id,seats,price_minor,currency,source) VALUES($1,$2,$3,1,1000,'UAH','web') RETURNING id::text`, company, trip, customer)
		if row(`SELECT count(*)::text FROM app_notifications WHERE membership_id=$1 AND event_type='bookingCreated'`, member) != "1" {
			t.Fatal("missing booking event")
		}
		if row(`SELECT count(*)::text FROM telegram_delivery_jobs j JOIN app_notifications n ON n.id=j.notification_id WHERE n.membership_id=$1 AND n.event_type='bookingCreated'`, member) != "1" {
			t.Fatal("missing durable Telegram job")
		}
		exec(`INSERT INTO workflow_statuses(tenant_id,entity_type,key,label,semantic_phase) VALUES($1,'bookings','closed_by_staff','Закрыта','cancelled')`, company)
		exec(`UPDATE bookings SET status='closed_by_staff' WHERE id=$1`, booking)
		if row(`SELECT count(*)::text FROM app_notifications WHERE membership_id=$1 AND event_type='bookingCancelled'`, member) != "1" {
			t.Fatal("custom cancelled status not recognized")
		}
		before := row(`SELECT count(*)::text FROM app_notifications WHERE membership_id=$1`, member)
		tx, _ := db.Begin(ctx)
		if _, err := tx.Exec(ctx, `UPDATE bookings SET status='confirmed' WHERE id=$1`, booking); err != nil {
			t.Fatal(err)
		}
		_ = tx.Rollback(ctx)
		if got := row(`SELECT count(*)::text FROM app_notifications WHERE membership_id=$1`, member); got != before {
			t.Fatal("rollback emitted events")
		}
		exec(`UPDATE telegram_delivery_jobs SET finished_at=now()`)
	})
	p := notificationprefs.Defaults(nil)
	savePrefs := func() {
		t.Helper()
		w := request("PATCH", "/api/v1/me/notification-preferences", p)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	connection := row(`SELECT id::text FROM staff_telegram_connections WHERE membership_id=$1`, member)
	job := func() string {
		t.Helper()
		notice := row(`INSERT INTO app_notifications(membership_id,category,event_type,title,body,url) VALUES($1,'newBookings','bookingCreated','Новое бронирование','Откройте CRM.','/bookings') RETURNING id::text`, member)
		return row(`INSERT INTO telegram_delivery_jobs(notification_id,connection_id) VALUES($1,$2) RETURNING id::text`, notice, connection)
	}
	t.Run("delivery retry, preferences and quiet hours", func(t *testing.T) {
		savePrefs()
		j := job()
		if err := app.deliverStaffTelegram(ctx); err != nil {
			t.Fatal(err)
		}
		if telegramCalls != 1 || row(`SELECT count(*)::text FROM telegram_delivery_jobs WHERE id=$1 AND finished_at IS NOT NULL`, j) != "1" {
			t.Fatal("message not delivered")
		}
		providerStatus = 503
		j = job()
		if err := app.deliverStaffTelegram(ctx); err != nil {
			t.Fatal(err)
		}
		if row(`SELECT count(*)::text FROM telegram_delivery_jobs WHERE id=$1 AND available_at>now() AND finished_at IS NULL AND locked_until IS NULL`, j) != "1" {
			t.Fatal("provider failure was not retained")
		}
		exec(`UPDATE telegram_delivery_jobs SET finished_at=now() WHERE id=$1`, j)
		providerStatus = 200
		before := telegramCalls
		p.Events["bookingCreated"] = notificationprefs.Channels{Push: true, Telegram: false}
		savePrefs()
		job()
		if err := app.deliverStaffTelegram(ctx); err != nil {
			t.Fatal(err)
		}
		if telegramCalls != before {
			t.Fatal("disabled channel delivered")
		}
		p.Events["bookingCreated"] = notificationprefs.Channels{Push: true, Telegram: true}
		p.Quiet.Enabled = true
		p.Quiet.Timezone = "UTC"
		now := time.Now().UTC()
		p.Quiet.Start = now.Add(-time.Hour).Format("15:04")
		p.Quiet.End = now.Add(time.Hour).Format("15:04")
		savePrefs()
		j = job()
		if err := app.deliverStaffTelegram(ctx); err != nil {
			t.Fatal(err)
		}
		if telegramCalls != before || row(`SELECT count(*)::text FROM telegram_delivery_jobs WHERE id=$1 AND available_at>now() AND finished_at IS NULL AND attempts=0`, j) != "1" {
			t.Fatal("quiet Telegram delivery escaped")
		}
		subscription := testPushSubscription(t)
		w := request("POST", "/api/v1/me/push", map[string]any{"subscription": subscription})
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		notice := row(`INSERT INTO app_notifications(membership_id,category,event_type,title,body,url) VALUES($1,'newBookings','bookingCreated','Booking','Body','/bookings') RETURNING id::text`, member)
		pushJob := row(`INSERT INTO push_jobs(notification_id,subscription_id) SELECT $1,id FROM push_subscriptions WHERE membership_id=$2 RETURNING id::text`, notice, member)
		if err := app.deliverPush(ctx); err != nil {
			t.Fatal(err)
		}
		if pushCalls != 0 || row(`SELECT count(*)::text FROM push_jobs WHERE id=$1 AND available_at>now() AND finished_at IS NULL AND attempts=0`, pushJob) != "1" {
			t.Fatal("quiet Push delivery escaped")
		}
	})
	t.Run("disconnect clears tokens and pending jobs", func(t *testing.T) {
		_ = newLink()
		w := request("DELETE", "/api/v1/me/telegram", nil)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		if row(`SELECT count(*)::text FROM staff_telegram_connections WHERE membership_id=$1`, member) != "0" || row(`SELECT count(*)::text FROM staff_telegram_link_tokens WHERE membership_id=$1`, member) != "0" || row(`SELECT count(*)::text FROM telegram_delivery_jobs WHERE connection_id=$1`, connection) != "0" {
			t.Fatal("disconnect retained delivery state")
		}
	})
	t.Run("branding accepts only editable fields", func(t *testing.T) {
		w := request("PATCH", "/api/v1/tenants/delivery-test/branding", map[string]any{"logoUrl": nil, "primaryColor": "#E9B74D", "defaultTheme": "light", "dispatcherContact": "@test"})
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	})
}
