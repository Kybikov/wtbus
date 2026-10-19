package main

import (
	"encoding/json"
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
	allowed, err := app.redis.SetNX(r.Context(), "integration-test:"+tenant.ID+":"+input.Provider, "1", interval).Result()
	if err != nil {
		writeError(w, 503, "Проверка временно недоступна.")
		return
	}
	if !allowed {
		writeError(w, 429, "Проверка уже выполнялась. Повторите через минуту.")
		return
	}
	started := time.Now()
	if input.Provider == "telegram" {
		result, status, err := notificationTelegramCall(r.Context(), token, "getMe", nil)
		var bot struct {
			Username string `json:"username"`
			IsBot    bool   `json:"is_bot"`
		}
		if status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusNotFound {
			writeError(w, 422, "Ключ Telegram недействителен. Замените его и повторите проверку.")
			return
		}
		if err != nil || json.Unmarshal(result, &bot) != nil || !bot.IsBot || bot.Username == "" {
			writeError(w, 502, "Не удалось подключиться к Telegram. Проверьте ключ и повторите попытку.")
			return
		}
		writeJSON(w, 200, map[string]any{"message": "Telegram подключён: @" + bot.Username, "durationMs": time.Since(started).Milliseconds()})
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "GET", "https://api.monobank.ua/personal/client-info", nil)
	if err != nil {
		writeError(w, 503, "Проверка временно недоступна.")
		return
	}
	req.Header.Set("X-Token", token)
	response, err := integrationTestClient.Do(req)
	if err != nil {
		writeError(w, 502, "Monobank временно недоступен. Повторите попытку позже.")
		return
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		writeError(w, 422, "Ключ Monobank недействителен или не имеет доступа. Замените его и повторите проверку.")
		return
	}
	if response.StatusCode == 429 {
		writeError(w, 429, "Monobank просит подождать минуту перед следующей проверкой.")
		return
	}
	var info struct {
		ClientID string `json:"clientId"`
	}
	if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&info) != nil || info.ClientID == "" {
		writeError(w, 502, "Не удалось подключиться к Monobank. Проверьте ключ и повторите попытку.")
		return
	}
	writeJSON(w, 200, map[string]any{"message": "Monobank подключён", "durationMs": time.Since(started).Milliseconds()})
}
