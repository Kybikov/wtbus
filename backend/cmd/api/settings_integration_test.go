package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

func TestSettingsPostgres(t *testing.T) {
	ctx := context.Background()
	db := deliveryTestDatabase(t)
	cache := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	defer cache.Close()
	app := &application{db: db, redis: cache, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	row := func(sql string, args ...any) string {
		t.Helper()
		var value string
		if err := db.QueryRow(ctx, sql, args...).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	company := row(`INSERT INTO tenants(slug,name) VALUES('settings-qa','Settings QA') RETURNING id::text`)
	user := row(`INSERT INTO users(email,display_name) VALUES('settings@test.invalid','Settings') RETURNING id::text`)
	member := row(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner') RETURNING id::text`, company, user)
	password := "test-password-123"
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if _, err := db.Exec(ctx, `INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)`, user, string(hash)); err != nil {
		t.Fatal(err)
	}
	actor := identity{UserID: user, TenantID: company, TenantSlug: "settings-qa", MembershipID: member, Role: "owner"}
	current, err := app.createSession(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	other, err := app.createSession(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	handler := app.routes()
	request := func(method, path, token string, payload any) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(payload)
		r := httptest.NewRequest(method, path, bytes.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	t.Run("email reauthentication, conflicts and session revocation", func(t *testing.T) {
		path := "/api/v1/auth/me"
		for _, test := range []struct {
			payload map[string]string
			status  int
		}{
			{map[string]string{"email": "new@test.invalid"}, 400},
			{map[string]string{"email": "new@test.invalid", "currentPassword": "wrong-password"}, 400},
		} {
			w := request("PATCH", path, current.SessionToken, test.payload)
			if w.Code != test.status {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		}
		row(`INSERT INTO users(email,display_name) VALUES('taken@test.invalid','Other') RETURNING id::text`)
		w := request("PATCH", path, current.SessionToken, map[string]string{"email": "taken@test.invalid", "currentPassword": password})
		if w.Code != 409 {
			t.Fatal(w.Code, w.Body)
		}
		w = request("PATCH", path, current.SessionToken, map[string]string{"email": "new@test.invalid", "currentPassword": password})
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"email":"new@test.invalid"`) {
			t.Fatal(w.Code, w.Body)
		}
		if w = request("GET", path, other.SessionToken, nil); w.Code != 401 {
			t.Fatal("other session survived", w.Code)
		}
		if w = request("GET", path, current.SessionToken, nil); w.Code != 200 {
			t.Fatal("current session lost", w.Code)
		}
		app.bootstrapEmail = "settings@test.invalid"
		app.bootstrapPassword = password
		app.bootstrapTenant = "settings-qa"
		if err := app.ensureBootstrapOwner(ctx); err != nil {
			t.Fatal(err)
		}
		if row(`SELECT count(*)::text FROM users WHERE email='settings@test.invalid'`) != "0" {
			t.Fatal("restart recreated the old email")
		}
	})
	t.Run("payment fields save individually while incomplete configuration cannot accept payments", func(t *testing.T) {
		path := "/api/v1/tenants/settings-qa/payment-config"
		draft := map[string]any{"merchantName": "QA Recipient", "isEnabled": false}
		if w := request("PATCH", path, current.SessionToken, draft); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		draft["isEnabled"] = true
		if w := request("PATCH", path, current.SessionToken, draft); w.Code != 400 {
			t.Fatal("incomplete payment enabled", w.Code, w.Body)
		}
		draft["isEnabled"] = false
		draft["iban"] = "invalid"
		if w := request("PATCH", path, current.SessionToken, draft); w.Code != 400 {
			t.Fatal("invalid nonempty IBAN saved", w.Code, w.Body)
		}
	})
	mono := "mono-secret-middle-5678"
	telegram := "123456789:telegram-test-only-key"
	base := "/api/v1/tenants/settings-qa/"
	w := request("PATCH", base+"integration-secrets", current.SessionToken, map[string]string{"monobankToken": mono, "telegramBotToken": telegram})
	if w.Code != 200 || strings.Contains(w.Body.String(), mono) || strings.Contains(w.Body.String(), telegram) || !strings.Contains(w.Body.String(), "mono••••••••5678") {
		t.Fatal("invalid masked response", w.Code, w.Body)
	}
	savedMono, savedTelegram := integrationTestClient, notificationTelegramClient
	defer func() { integrationTestClient = savedMono; notificationTelegramClient = savedTelegram }()
	calls := 0
	integrationTestClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		body := `{"clientId":"test-client"}`
		if strings.HasSuffix(r.URL.Path, "/bank/currency") {
			body = fmt.Sprintf(`[{"currencyCodeA":978,"currencyCodeB":980,"rateBuy":44,"rateSell":46,"date":%d},{"currencyCodeA":840,"currencyCodeB":980,"rateBuy":40,"rateSell":42,"date":%d}]`, time.Now().Unix(), time.Now().Unix())
		} else if r.Header.Get("X-Token") != mono {
			t.Error("missing server-side token")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	notificationTelegramClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if !strings.HasSuffix(r.URL.Path, "/getMe") {
			t.Error("test sent a message")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"ok":true,"result":{"is_bot":true,"username":"qa_bot"}}`)), Header: make(http.Header)}, nil
	})}
	t.Run("connection tests use saved keys and enforce cooldown", func(t *testing.T) {
		for _, provider := range []string{"monobank", "telegram"} {
			w := request("POST", base+"integration-secrets/test", current.SessionToken, map[string]string{"provider": provider})
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body)
			}
		}
		w := request("POST", base+"integration-secrets/test", current.SessionToken, map[string]string{"provider": "monobank"})
		if w.Code != 429 {
			t.Fatal("cooldown missing", w.Code)
		}
	})
	t.Run("currency preview cached without changing saved rates", func(t *testing.T) {
		before := row(`SELECT count(*)::text FROM tenant_exchange_rates WHERE tenant_id=$1`, company)
		count := calls
		for range 2 {
			w := request("GET", base+"finance/exchange-rates/monobank", current.SessionToken, nil)
			if w.Code != 200 || !strings.Contains(w.Body.String(), `"USD":0.91111111`) {
				t.Fatal(w.Code, w.Body)
			}
		}
		if calls != count+1 {
			t.Fatal("public currency cache missing", calls, count)
		}
		if after := row(`SELECT count(*)::text FROM tenant_exchange_rates WHERE tenant_id=$1`, company); after != before {
			t.Fatal("preview changed financial data")
		}
	})

	t.Run("default currency list synchronizes reports and shows UAH buy sell", func(t *testing.T) {
		w := request("GET", base+"finance/exchange-rates", current.SessionToken, nil)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"quoteCurrency":"UAH"`) || !strings.Contains(w.Body.String(), `"buy":44,"sell":46`) {
			t.Fatal(w.Code, w.Body)
		}
		if got := row(`SELECT rate_to_base::text FROM tenant_exchange_rates WHERE tenant_id=$1 AND currency='USD'`, company); got != "0.91111111" {
			t.Fatal("report rate not synced", got)
		}
		before := row(`SELECT updated_at::text FROM tenant_exchange_rates WHERE tenant_id=$1 AND currency='USD'`, company)
		w = request("GET", base+"finance/exchange-rates", current.SessionToken, nil)
		if got := row(`SELECT updated_at::text FROM tenant_exchange_rates WHERE tenant_id=$1 AND currency='USD'`, company); got != before {
			t.Fatal("unchanged quote rewritten")
		}
		// A provider failure preserves the last-good quote and all saved report rates.
		_ = cache.Del(ctx, "public:monobank-currency").Err()
		goodClient := integrationTestClient
		integrationTestClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) { return nil, fmt.Errorf("offline") })}
		defer func() { integrationTestClient = goodClient }()
		w = request("GET", base+"finance/exchange-rates", current.SessionToken, nil)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"stale":true`) || !strings.Contains(w.Body.String(), `"buy":44`) {
			t.Fatal("last good fallback lost", w.Code, w.Body)
		}
		if got := row(`SELECT updated_at::text FROM tenant_exchange_rates WHERE tenant_id=$1 AND currency='USD'`, company); got != before {
			t.Fatal("outage rewrote report rates")
		}
	})
	t.Run("dispatcher cannot view keys or test providers", func(t *testing.T) {
		m := row(`INSERT INTO memberships(tenant_id,user_id,role) SELECT $1,id,'dispatcher' FROM users WHERE email='taken@test.invalid' RETURNING id::text`, company)
		u := row(`SELECT user_id::text FROM memberships WHERE id=$1`, m)
		session, err := app.createSession(ctx, identity{UserID: u, MembershipID: m, TenantID: company, TenantSlug: "settings-qa", Role: "dispatcher"})
		if err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{"integration-secrets", "finance/exchange-rates/monobank"} {
			if w := request("GET", base+path, session.SessionToken, nil); w.Code != 403 {
				t.Fatal(path, w.Code)
			}
		}
		if w := request("POST", base+"integration-secrets/test", session.SessionToken, map[string]string{"provider": "monobank"}); w.Code != 403 {
			t.Fatal(w.Code)
		}
	})
}
