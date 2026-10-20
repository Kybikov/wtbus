package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

var integrationTestClient = &http.Client{Timeout: 6 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}

func maskedIntegrationSecret(token string) string {
	if token == "" {
		return ""
	}
	characters := []rune(token)
	if len(characters) <= 12 {
		return "••••••••"
	}
	return string(characters[:4]) + "••••••••" + string(characters[len(characters)-4:])
}

func (app *application) testIntegration(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	tenant, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	var input struct {
		Provider string `json:"provider"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || (input.Provider != "monobank" && input.Provider != "telegram") {
		writeError(w, 400, "Выберите интеграцию для проверки.")
		return
	}
	var mono, telegram string
	if err := app.db.QueryRow(r.Context(), `SELECT coalesce(monobank_token,''),coalesce(telegram_bot_token,'') FROM tenant_integration_secrets WHERE tenant_id=$1`, tenant.ID).Scan(&mono, &telegram); err != nil {
		writeError(w, 409, "Сначала сохраните ключ подключения.")
		return
	}
	token := mono
	interval := time.Minute
	if input.Provider == "telegram" {
		token = telegram
		interval = 10 * time.Second
	}
	if token == "" {
		writeError(w, 409, "Сначала сохраните ключ подключения.")
		return
	}
	message, code, err := app.checkIntegration(r.Context(), tenant.ID, input.Provider, token, interval)
	if err != nil {
		writeError(w, code, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"message": message})
}

// Provider bodies and credentials are never returned or saved in health records.
func (app *application) checkIntegration(ctx context.Context, tenantID, provider, token string, interval time.Duration) (message string, code int, checkErr error) {
	allowed, err := app.redis.SetNX(ctx, "integration-test:"+tenantID+":"+provider, "1", interval).Result()
	if err != nil {
		return "", 503, errors.New("Проверка временно недоступна.")
	}
	if !allowed {
		return "", 429, errors.New("Проверка уже выполнялась. Повторите позже.")
	}
	started := time.Now()
	defer func() {
		app.log.Info("integration request", "tenant", tenantID, "provider", provider, "status", code, "duration_ms", time.Since(started).Milliseconds())
	}()
	// Persist even when the caller disconnects. Reject a late result for a replaced key.
	defer func() {
		if code == 429 || code == 503 {
			return
		}
		status := "working"
		if checkErr != nil {
			status = "error"
		}
		saveCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, err := app.db.Exec(saveCtx, `INSERT INTO integration_health(tenant_id,provider,credential_hash,status,checked_at,last_success_at)
     SELECT tenant_id,$2,digest($3::text,'sha256'),$4,now(),CASE WHEN $4='working' THEN now() END
     FROM tenant_integration_secrets WHERE tenant_id=$1 AND CASE WHEN $2='monobank' THEN monobank_token ELSE telegram_bot_token END=$3
     ON CONFLICT(tenant_id,provider) DO UPDATE SET credential_hash=EXCLUDED.credential_hash,status=EXCLUDED.status,checked_at=EXCLUDED.checked_at,
       last_success_at=CASE WHEN EXCLUDED.status='working' THEN EXCLUDED.checked_at WHEN integration_health.credential_hash=EXCLUDED.credential_hash THEN integration_health.last_success_at END`, tenantID, provider, token, status)
		if err != nil {
			app.log.Error("save integration health", "tenant", tenantID, "provider", provider)
		}
	}()
	if provider == "telegram" {
		result, status, err := notificationTelegramCall(ctx, token, "getMe", nil)
		var bot struct {
			Username string `json:"username"`
			IsBot    bool   `json:"is_bot"`
		}
		if status == 429 {
			return "", 429, errors.New("Telegram просит подождать перед следующей проверкой.")
		}
		if status == 401 || status == 403 || status == 404 {
			return "", 422, errors.New("Ключ Telegram недействителен. Замените его и повторите проверку.")
		}
		if err != nil || json.Unmarshal(result, &bot) != nil || !bot.IsBot || bot.Username == "" {
			return "", 502, errors.New("Не удалось подключиться к Telegram. Повторите попытку позже.")
		}
		return "Telegram подключён: @" + bot.Username, 200, nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.monobank.ua/personal/client-info", nil)
	req.Header.Set("X-Token", token)
	response, err := integrationTestClient.Do(req)
	if err != nil {
		return "", 502, errors.New("Monobank временно недоступен. Повторите попытку позже.")
	}
	defer response.Body.Close()
	if response.StatusCode == 401 || response.StatusCode == 403 {
		return "", 422, errors.New("Ключ Monobank недействителен или не имеет доступа. Замените его и повторите проверку.")
	}
	if response.StatusCode == 429 {
		return "", 429, errors.New("Monobank просит подождать минуту перед следующей проверкой.")
	}
	var info struct {
		ClientID string `json:"clientId"`
	}
	if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&info) != nil || info.ClientID == "" {
		return "", 502, errors.New("Не удалось подключиться к Monobank. Повторите попытку позже.")
	}
	return "Monobank подключён", 200, nil
}

func (app *application) refreshIntegrationHealth(ctx context.Context) error {
	rows, err := app.db.Query(ctx, `SELECT s.tenant_id::text,p.provider,p.token FROM tenant_integration_secrets s
 CROSS JOIN LATERAL (VALUES ('monobank',s.monobank_token),('telegram',s.telegram_bot_token)) p(provider,token)
 LEFT JOIN integration_health h ON h.tenant_id=s.tenant_id AND h.provider=p.provider
 WHERE coalesce(p.token,'')<>'' AND (h.checked_at IS NULL OR h.checked_at<now()-interval '5 minutes')
 ORDER BY h.checked_at NULLS FIRST LIMIT 4`)
	if err != nil {
		return err
	}
	type check struct{ tenant, provider, token string }
	var checks []check
	for rows.Next() {
		var c check
		if err = rows.Scan(&c.tenant, &c.provider, &c.token); err != nil {
			rows.Close()
			return err
		}
		checks = append(checks, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, c := range checks {
		if ctx.Err() != nil {
			break
		}
		interval := time.Minute
		if c.provider == "telegram" {
			interval = 10 * time.Second
		}
		_, _, _ = app.checkIntegration(ctx, c.tenant, c.provider, c.token, interval)
	}
	return nil
}

type integrationHealth struct {
	Status        string     `json:"status"`
	CheckedAt     *time.Time `json:"checkedAt,omitempty"`
	LastSuccessAt *time.Time `json:"lastSuccessAt,omitempty"`
}

func (app *application) loadIntegrationHealth(ctx context.Context, tenantID, provider, token string) integrationHealth {
	health := integrationHealth{Status: "disconnected"}
	if token == "" {
		return health
	}
	health.Status = "pending"
	// This comparison prevents an old key's result from making a new key look healthy.
	err := app.db.QueryRow(ctx, `SELECT status,checked_at,last_success_at FROM integration_health WHERE tenant_id=$1 AND provider=$2 AND credential_hash=digest($3::text,'sha256')`, tenantID, provider, token).Scan(&health.Status, &health.CheckedAt, &health.LastSuccessAt)
	if err != nil {
		health = integrationHealth{Status: "pending"}
	}
	return health
}
