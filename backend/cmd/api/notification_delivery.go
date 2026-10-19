package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/vivat-bus/tms/internal/notificationprefs"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var notificationTelegramClient = &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}

func (app *application) deliveryPreferences(ctx context.Context, member string) (notificationprefs.Preferences, error) {
	var raw, legacy []byte
	err := app.db.QueryRow(ctx, `SELECT delivery,categories FROM notification_preferences WHERE membership_id=$1`, member).Scan(&raw, &legacy)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return notificationprefs.Preferences{}, err
	}
	var categories map[string]bool
	_ = json.Unmarshal(legacy, &categories)
	return notificationprefs.Load(raw, categories), nil
}
func (app *application) notificationDeliverySettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	actor := r.Context().Value(identityContextKey{}).(identity)
	if r.Method == "PATCH" {
		var p notificationprefs.Preferences
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&p) != nil {
			writeError(w, 400, "Некорректные настройки уведомлений.")
			return
		}
		if err := notificationprefs.Validate(p); err != nil {
			writeError(w, 400, err.Error())
			return
		}
		raw, _ := json.Marshal(p)
		if _, err := app.db.Exec(r.Context(), `INSERT INTO notification_preferences(membership_id,delivery) VALUES($1,$2) ON CONFLICT(membership_id) DO UPDATE SET delivery=EXCLUDED.delivery`, actor.MembershipID, raw); err != nil {
			writeError(w, 503, "Не удалось сохранить настройки.")
			return
		}
	}
	p, err := app.deliveryPreferences(r.Context(), actor.MembershipID)
	if err != nil {
		writeError(w, 503, "Не удалось загрузить настройки.")
		return
	}
	events := make([]notificationprefs.Event, 0)
	for _, e := range notificationprefs.Events {
		if notificationprefs.Allowed(actor.Role, e.Category) {
			events = append(events, e)
		}
	}
	writeJSON(w, 200, map[string]any{"preferences": p, "events": events})
}
func (app *application) staffBotToken(ctx context.Context, tenant string) (string, error) {
	var token string
	err := app.db.QueryRow(ctx, `SELECT coalesce(telegram_bot_token,'') FROM tenant_integration_secrets WHERE tenant_id=$1`, tenant).Scan(&token)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return token, err
}

// Never return/log HTTP errors containing Telegram's token-bearing URL.
func notificationTelegramCall(ctx context.Context, token, method string, input any) (json.RawMessage, int, error) {
	if input == nil {
		input = struct{}{}
	}
	raw, _ := json.Marshal(input)
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.telegram.org/bot"+token+"/"+method, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, errors.New("Telegram временно недоступен.")
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := notificationTelegramClient.Do(req)
	if err != nil {
		return nil, 0, errors.New("Telegram временно недоступен.")
	}
	defer response.Body.Close()
	var payload struct {
		OK     bool            `json:"ok"`
		Result json.RawMessage `json:"result"`
		Code   int             `json:"error_code"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 16384)).Decode(&payload) != nil {
		return nil, response.StatusCode, errors.New("Некорректный ответ Telegram.")
	}
	if !payload.OK {
		code := payload.Code
		if code == 0 {
			code = response.StatusCode
		}
		return nil, code, errors.New("Проверьте токен бота или попробуйте позже.")
	}
	return payload.Result, response.StatusCode, nil
}
func (app *application) staffTelegramSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	actor := r.Context().Value(identityContextKey{}).(identity)
	if r.Method == "DELETE" {
		if _, err := app.db.Exec(r.Context(), `WITH removed AS (DELETE FROM staff_telegram_connections WHERE membership_id=$1 RETURNING id) DELETE FROM staff_telegram_link_tokens WHERE membership_id=$1`, actor.MembershipID); err != nil {
			writeError(w, 503, "Не удалось отключить Telegram.")
			return
		}
	}
	if r.Method == "POST" {
		var input struct {
			Action string `json:"action"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&input) != nil {
			writeError(w, 400, "Некорректное действие.")
			return
		}
		if input.Action == "link" {
			token, err := app.staffBotToken(r.Context(), actor.TenantID)
			if err != nil || token == "" {
				writeError(w, 409, "Владелец или разработчик должен подключить Telegram-бота в интеграциях компании.")
				return
			}
			result, _, err := notificationTelegramCall(r.Context(), token, "getMe", nil)
			var bot struct {
				Username string `json:"username"`
			}
			if err != nil || json.Unmarshal(result, &bot) != nil || bot.Username == "" {
				writeError(w, 503, "Бот недоступен. Проверьте его токен в интеграциях компании.")
				return
			}
			data := make([]byte, 32)
			if _, err = rand.Read(data); err != nil {
				writeError(w, 503, "Не удалось создать ссылку.")
				return
			}
			code := base64.RawURLEncoding.EncodeToString(data)
			hash := sha256.Sum256([]byte(code))
			_, err = app.db.Exec(r.Context(), `INSERT INTO staff_telegram_link_tokens(membership_id,tenant_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes') ON CONFLICT(membership_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at`, actor.MembershipID, actor.TenantID, hash[:])
			if err != nil {
				writeError(w, 503, "Не удалось создать ссылку.")
				return
			}
			writeJSON(w, 200, map[string]any{"url": "https://t.me/" + url.PathEscape(bot.Username) + "?start=staff_" + code, "expiresIn": 600})
			return
		}
		if input.Action == "test" {
			token, err := app.staffBotToken(r.Context(), actor.TenantID)
			if err != nil || token == "" {
				writeError(w, 409, "Сначала подключите бота в интеграциях компании.")
				return
			}
			tag, err := app.db.Exec(r.Context(), `WITH notice AS (INSERT INTO app_notifications(membership_id,category,event_type,title,body,url) SELECT $1,'test','test','Telegram подключён','Уведомления Vivat Bus приходят в этот чат.','/profile' WHERE EXISTS(SELECT 1 FROM staff_telegram_connections WHERE membership_id=$1) RETURNING id) INSERT INTO telegram_delivery_jobs(notification_id,connection_id) SELECT n.id,c.id FROM notice n,staff_telegram_connections c WHERE c.membership_id=$1`, actor.MembershipID)
			if err != nil {
				writeError(w, 503, "Не удалось поставить проверку в очередь.")
				return
			}
			if tag.RowsAffected() == 0 {
				writeError(w, 409, "Сначала подключите Telegram.")
				return
			}
			writeJSON(w, 200, map[string]bool{"queued": true})
			return
		}
		writeError(w, 400, "Неизвестное действие.")
		return
	}
	var username string
	var connected time.Time
	err := app.db.QueryRow(r.Context(), `SELECT username,connected_at FROM staff_telegram_connections WHERE membership_id=$1 AND tenant_id=$2`, actor.MembershipID, actor.TenantID).Scan(&username, &connected)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 503, "Не удалось загрузить подключение.")
		return
	}
	var configured bool
	if app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM tenant_integration_secrets WHERE tenant_id=$1 AND coalesce(telegram_bot_token,'')<>'')`, actor.TenantID).Scan(&configured) != nil {
		writeError(w, 503, "Не удалось загрузить настройки бота.")
		return
	}
	writeJSON(w, 200, map[string]any{"connected": err == nil, "username": username, "connectedAt": connected, "botConfigured": configured})
}
func (app *application) deliverStaffTelegram(ctx context.Context) error {
	var job int64
	err := app.db.QueryRow(ctx, `WITH claim AS (SELECT id FROM telegram_delivery_jobs WHERE finished_at IS NULL AND available_at<=now() AND (locked_until IS NULL OR locked_until<now()) ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE telegram_delivery_jobs j SET locked_until=now()+interval '60 seconds',attempts=attempts+1 FROM claim WHERE j.id=claim.id RETURNING j.id`).Scan(&job)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var member, tenant, role, category, event, title, body, path, connection string
	var chat int64
	var attempts int
	var active bool
	var created time.Time
	err = app.db.QueryRow(ctx, `SELECT n.membership_id::text,c.tenant_id::text,m.role::text,n.category,n.event_type,n.title,n.body,n.url,c.id::text,c.chat_id,j.attempts,m.is_active,n.created_at FROM telegram_delivery_jobs j JOIN app_notifications n ON n.id=j.notification_id JOIN staff_telegram_connections c ON c.id=j.connection_id AND c.membership_id=n.membership_id JOIN memberships m ON m.id=n.membership_id AND m.tenant_id=c.tenant_id WHERE j.id=$1`, job).Scan(&member, &tenant, &role, &category, &event, &title, &body, &path, &connection, &chat, &attempts, &active, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	finish := func() error {
		_, err := app.db.Exec(ctx, `UPDATE telegram_delivery_jobs SET finished_at=now(),locked_until=NULL WHERE id=$1`, job)
		return err
	}
	p, err := app.deliveryPreferences(ctx, member)
	if err != nil {
		return err
	}
	if !active || !notificationprefs.Allowed(role, category) || !p.Enabled(event, category, "telegram") || time.Since(created) > 24*time.Hour {
		return finish()
	}
	if resume := p.ResumeAt(time.Now()); category != "test" && resume.After(time.Now()) {
		_, err = app.db.Exec(ctx, `UPDATE telegram_delivery_jobs SET available_at=$2,locked_until=NULL,attempts=greatest(0,attempts-1) WHERE id=$1`, job, resume)
		return err
	}
	token, err := app.staffBotToken(ctx, tenant)
	if err != nil {
		return err
	}
	status := 0
	if token != "" {
		origin := strings.TrimRight(strings.Split(optionalEnv("APP_ORIGIN", optionalEnv("CORS_ORIGIN", "https://vivat.wtmelon.store")), ",")[0], "/")
		text := title + "\n" + body
		if notificationURL(path) {
			text += "\n" + origin + path
		}
		_, status, err = notificationTelegramCall(ctx, token, "sendMessage", map[string]any{"chat_id": chat, "text": text, "link_preview_options": map[string]bool{"is_disabled": true}})
		if err == nil {
			return finish()
		}
	}
	if status == 403 {
		_, err = app.db.Exec(ctx, `DELETE FROM staff_telegram_connections WHERE id=$1`, connection)
		return err
	}
	if attempts >= 8 || (status >= 400 && status < 500 && status != 429 && status != 401) {
		return finish()
	}
	delay := time.Duration(1<<min(attempts, 8)) * 15 * time.Second
	_, err = app.db.Exec(ctx, `UPDATE telegram_delivery_jobs SET available_at=now()+$2::interval,locked_until=NULL WHERE id=$1`, job, fmt.Sprintf("%d seconds", int(delay.Seconds())))
	return err
}
