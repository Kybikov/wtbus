package main

import (
	"context"
	"crypto/ecdh"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5"
)

var pushHTTPClient = &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
var notificationCategories = map[string]bool{"newRequests": true, "newBookings": true, "payments": true, "trips": true}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

var notificationUUID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func validUUID(value string) bool { return notificationUUID.MatchString(value) }

func (app *application) ensurePushKeys(ctx context.Context) error {
	public, private := os.Getenv("PUSH_VAPID_PUBLIC_KEY"), os.Getenv("PUSH_VAPID_PRIVATE_KEY")
	if (public == "") != (private == "") {
		return errors.New("both VAPID keys must be configured together")
	}
	if public == "" {
		// Generate once, persist across replicas/restarts. Losing the DB loses these keys too: back it up.
		var err error
		private, public, err = webpush.GenerateVAPIDKeys()
		if err != nil {
			return err
		}
		if _, err = app.db.Exec(ctx, `INSERT INTO push_configuration(id,public_key,private_key) VALUES(true,$1,$2) ON CONFLICT DO NOTHING`, public, private); err != nil {
			return err
		}
		if err = app.db.QueryRow(ctx, `SELECT public_key,private_key FROM push_configuration WHERE id`).Scan(&public, &private); err != nil {
			return err
		}
	}
	pub, err := base64.RawURLEncoding.DecodeString(public)
	if err != nil {
		return errors.New("invalid VAPID public key")
	}
	priv, err := base64.RawURLEncoding.DecodeString(private)
	if err != nil {
		return errors.New("invalid VAPID private key")
	}
	key, err := ecdh.P256().NewPrivateKey(priv)
	if err != nil || string(key.PublicKey().Bytes()) != string(pub) {
		return errors.New("VAPID key pair mismatch")
	}
	app.pushPublicKey, app.pushPrivateKey = public, private
	return nil
}

func notificationURL(path string) bool {
	switch path {
	case "/requests", "/bookings", "/finance", "/trips", "/driver", "/profile":
		return true
	}
	return false
}

func validPushSubscription(s webpush.Subscription) bool {
	u, err := url.Parse(s.Endpoint)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") || len(s.Endpoint) > 2048 {
		return false
	}
	host := strings.ToLower(u.Hostname())
	allowed := host == "fcm.googleapis.com" || host == "updates.push.services.mozilla.com" || host == "updates-autopush.stage.mozaws.net" || host == "web.push.apple.com" || strings.HasSuffix(host, ".notify.windows.com")
	if !allowed {
		return false
	}
	auth, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s.Keys.Auth, "="))
	if err != nil || len(auth) != 16 {
		return false
	}
	pub, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s.Keys.P256dh, "="))
	if err != nil {
		return false
	}
	_, err = ecdh.P256().NewPublicKey(pub)
	return err == nil
}

func (app *application) pushSettings(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(identityContextKey{}).(identity)
	w.Header().Set("Cache-Control", "private, no-store")
	switch r.Method {
	case "GET":
		prefs := map[string]bool{"newRequests": true, "newBookings": true, "payments": true, "trips": true}
		var raw []byte
		err := app.db.QueryRow(r.Context(), `SELECT categories FROM notification_preferences WHERE membership_id=$1`, actor.MembershipID).Scan(&raw)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			writeError(w, 503, "Уведомления временно недоступны.")
			return
		}
		if len(raw) > 0 {
			if json.Unmarshal(raw, &prefs) != nil {
				writeError(w, 503, "Не удалось загрузить настройки.")
				return
			}
		}
		writeJSON(w, 200, map[string]any{"publicKey": app.pushPublicKey, "preferences": prefs})
	case "PATCH":
		var prefs map[string]bool
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&prefs) != nil || len(prefs) != 4 {
			writeError(w, 400, "Некорректные настройки.")
			return
		}
		for k := range prefs {
			if !notificationCategories[k] {
				writeError(w, 400, "Неизвестная категория.")
				return
			}
		}
		raw, _ := json.Marshal(prefs)
		if _, err := app.db.Exec(r.Context(), `INSERT INTO notification_preferences(membership_id,categories) VALUES($1,$2) ON CONFLICT(membership_id) DO UPDATE SET categories=EXCLUDED.categories`, actor.MembershipID, raw); err != nil {
			writeError(w, 503, "Не удалось сохранить настройки.")
			return
		}
		writeJSON(w, 200, map[string]any{"preferences": prefs})
	case "DELETE":
		var input struct {
			Endpoint string `json:"endpoint"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil {
			writeError(w, 400, "Некорректная подписка.")
			return
		}
		_, err := app.db.Exec(r.Context(), `DELETE FROM push_subscriptions WHERE endpoint=$1 AND membership_id=$2`, input.Endpoint, actor.MembershipID)
		if err != nil {
			writeError(w, 503, "Не удалось отключить push.")
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	case "POST":
		var input struct {
			Subscription webpush.Subscription `json:"subscription"`
			Test         bool                 `json:"test"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&input) != nil || !validPushSubscription(input.Subscription) {
			writeError(w, 400, "Некорректная push-подписка.")
			return
		}
		token, _ := sessionTokenFromRequest(r)
		hash := sha256.Sum256([]byte(token))
		// One endpoint is bound to ONE current membership/session; company/account changes cannot duplicate alerts.
		if input.Test {
			limited, err := app.redis.SetNX(r.Context(), "push-test:"+actor.MembershipID, "1", 30*time.Second).Result()
			if err != nil {
				writeError(w, 503, "Попробуйте позже.")
				return
			}
			if !limited {
				writeError(w, 429, "Повторите проверку через 30 секунд.")
				return
			}
			tag, err := app.db.Exec(r.Context(), `WITH notice AS (
    INSERT INTO app_notifications(membership_id,category,title,body,url)
    SELECT $1,'test','Vivat Bus','Фоновые push-уведомления работают.','/profile'
    WHERE EXISTS(SELECT 1 FROM push_subscriptions WHERE endpoint=$2 AND membership_id=$1 AND session_hash=$3)
    RETURNING id)
    INSERT INTO push_jobs(notification_id,subscription_id) SELECT n.id,s.id FROM notice n,push_subscriptions s WHERE s.endpoint=$2 AND s.membership_id=$1 AND s.session_hash=$3`, actor.MembershipID, input.Subscription.Endpoint, hash[:])
			if err != nil {
				writeError(w, 503, "Не удалось отправить проверку.")
				return
			}
			if tag.RowsAffected() == 0 {
				writeError(w, 400, "Сначала включите push на устройстве.")
				return
			}
		} else {
			var count int
			if err := app.db.QueryRow(r.Context(), `SELECT count(*) FROM push_subscriptions WHERE membership_id=$1 AND endpoint<>$2`, actor.MembershipID, input.Subscription.Endpoint).Scan(&count); err != nil {
				writeError(w, 503, "Push временно недоступен.")
				return
			}
			if count >= 20 {
				writeError(w, 400, "Достигнут лимит устройств.")
				return
			}
			_, err := app.db.Exec(r.Context(), `INSERT INTO push_subscriptions(membership_id,session_hash,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(endpoint) DO UPDATE SET membership_id=EXCLUDED.membership_id,session_hash=EXCLUDED.session_hash,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,updated_at=now()`, actor.MembershipID, hash[:], input.Subscription.Endpoint, input.Subscription.Keys.P256dh, input.Subscription.Keys.Auth)
			if err != nil {
				writeError(w, 503, "Не удалось включить push.")
				return
			}
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	}
}

func (app *application) notifications(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(identityContextKey{}).(identity)
	w.Header().Set("Cache-Control", "private, no-store")
	if r.Method != "GET" {
		if r.Method != "PATCH" {
			writeError(w, 405, "Метод не поддерживается.")
			return
		}
		var input struct {
			ID  string `json:"id"`
			All bool   `json:"all"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&input) != nil || (!input.All && !validUUID(input.ID)) {
			writeError(w, 400, "Некорректное уведомление.")
			return
		}
		_, err := app.db.Exec(r.Context(), `UPDATE app_notifications SET read_at=coalesce(read_at,now()) WHERE membership_id=$1 AND ($2 OR id::text=$3)`, actor.MembershipID, input.All, input.ID)
		if err != nil {
			writeError(w, 503, "Не удалось отметить уведомления.")
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
		return
	}
	cursor := r.URL.Query().Get("before")
	if cursor != "" && !validUUID(cursor) {
		writeError(w, 400, "Некорректная страница истории.")
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT id::text,category,title,body,url,created_at,read_at FROM app_notifications
	WHERE membership_id=$1 AND (category<>'payments' OR $2 IN ('owner','admin','developer'))
	AND ($2<>'driver' OR category IN ('trips','newBookings','test'))
	AND ($3='' OR (created_at,id)<(SELECT created_at,id FROM app_notifications WHERE id::text=$3 AND membership_id=$1))
	ORDER BY created_at DESC,id DESC LIMIT 51`, actor.MembershipID, actor.Role, cursor)
	if err != nil {
		writeError(w, 503, "Не удалось загрузить уведомления.")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, category, title, body, path string
		var created time.Time
		var read *time.Time
		if err := rows.Scan(&id, &category, &title, &body, &path, &created, &read); err != nil {
			writeError(w, 503, "Не удалось прочитать уведомления.")
			return
		}
		if actor.Role == "driver" {
			if category != "trips" && category != "newBookings" && category != "test" {
				continue
			}
			path = "/driver"
			if category == "test" {
				path = "/profile"
			}
		}
		items = append(items, map[string]any{"id": id, "category": category, "title": title, "body": body, "url": path, "createdAt": created, "readAt": read})
	}
	if rows.Err() != nil {
		writeError(w, 503, "Не удалось прочитать уведомления.")
		return
	}
	var unread int
	if err := app.db.QueryRow(r.Context(), `SELECT count(*) FROM app_notifications WHERE membership_id=$1 AND read_at IS NULL AND (category<>'payments' OR $2 IN ('owner','admin','developer')) AND ($2<>'driver' OR category IN ('trips','newBookings','test'))`, actor.MembershipID, actor.Role).Scan(&unread); err != nil {
		writeError(w, 503, "Не удалось загрузить счётчик.")
		return
	}
	next := ""
	if len(items) > 50 {
		items = items[:50]
		next = items[49]["id"].(string)
	}
	writeJSON(w, 200, map[string]any{"items": items, "unread": unread, "next": next})
}

func realtimeChannel(tenant, member string) string {
	if member != "" {
		return "vivat:realtime:member:" + member
	}
	return "vivat:realtime:tenant:" + tenant
}

func (app *application) realtime(w http.ResponseWriter, r *http.Request) {
	// WebSocket is the only endpoint accepting the same HttpOnly session cookie as the frontend.
	if cookie, err := r.Cookie("vivat_session"); err == nil {
		r = r.Clone(r.Context())
		r.Header.Set("Authorization", "Bearer "+cookie.Value)
	}
	actor, _, err := app.authenticate(r)
	if err != nil {
		writeError(w, 401, "Войдите в аккаунт.")
		return
	}
	origin := r.Header.Get("Origin")
	allowed := false
	for _, candidate := range strings.Split(optionalEnv("WS_ALLOWED_ORIGINS", os.Getenv("CORS_ORIGIN")), ",") {
		if origin != "" && origin == strings.TrimSpace(candidate) {
			allowed = true
		}
	}
	if !allowed {
		writeError(w, 403, "Недопустимый источник соединения.")
		return
	}
	// Per-session leases avoid an unbounded connection count even across API replicas.
	_, token, _ := app.authenticate(r)
	sum := sha256.Sum256([]byte(token))
	limitKey := fmt.Sprintf("vivat:ws:%x", sum[:])
	lease, err := app.redis.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]);redis.call('EXPIRE',KEYS[1],120);return n`, []string{limitKey}).Int()
	if err != nil {
		writeError(w, 503, "Real-time временно недоступен.")
		return
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		// Never recreate an expired lease as a negative, non-expiring counter.
		_ = app.redis.Eval(cleanup, `local n=tonumber(redis.call('GET',KEYS[1]) or '0');if n>1 then return redis.call('DECR',KEYS[1]) else return redis.call('DEL',KEYS[1]) end`, []string{limitKey}).Err()
	}()
	if lease > 8 {
		writeError(w, 429, "Слишком много соединений.")
		return
	}
	channel := realtimeChannel(actor.TenantID, "")
	if actor.Role == "driver" {
		channel = realtimeChannel(actor.TenantID, actor.MembershipID)
	}
	subscription := app.redis.Subscribe(r.Context(), channel)
	defer subscription.Close()
	if _, err := subscription.Receive(r.Context()); err != nil {
		writeError(w, 503, "Real-time временно недоступен.")
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1024)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	ctx = conn.CloseRead(ctx)
	if app.notificationContext != nil {
		go func() {
			select {
			case <-app.notificationContext.Done():
				cancel()
			case <-ctx.Done():
			}
		}()
	}
	send := func(payload []byte) error {
		timeout, stop := context.WithTimeout(ctx, 5*time.Second)
		defer stop()
		return conn.Write(timeout, websocket.MessageText, payload)
	}
	if send([]byte(`{"type":"ready"}`)) != nil {
		return
	}
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	messages := subscription.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			if send([]byte(message.Payload)) != nil {
				return
			}
		case <-ticker.C:
			// Cookie logout, role changes and company switches must close an already-open socket.
			check, stop := context.WithTimeout(ctx, 5*time.Second)
			current, _, authErr := app.authenticate(r.WithContext(check))
			stop()
			if authErr != nil || current.MembershipID != actor.MembershipID || current.Role != actor.Role {
				_ = conn.Close(websocket.StatusPolicyViolation, "Session changed")
				return
			}
			ping, stop := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Ping(ping)
			stop()
			if err != nil {
				return
			}
			if err := app.redis.Expire(ctx, limitKey, 120*time.Second).Err(); err != nil {
				return
			}
			// Snapshot fallback also covers missed Redis messages during a Redis reconnect.
			if send([]byte(`{"type":"ready"}`)) != nil {
				return
			}
		}
	}
}

func (app *application) notificationWorker(ctx context.Context) {
	var workers sync.WaitGroup
	run := func(name string, interval time.Duration, task func(context.Context) error) {
		workers.Add(1)
		go func() {
			defer workers.Done()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					cycle, stop := context.WithTimeout(ctx, 20*time.Second)
					if err := task(cycle); err != nil && ctx.Err() == nil {
						app.log.Error(name, "error", err)
					}
					stop()
				}
			}
		}()
	}
	// A Redis outage must not block background push; a slow push provider must not block CRM events.
	run("publish realtime events", 500*time.Millisecond, app.publishRealtime)
	for range 4 {
		run("deliver push job", 200*time.Millisecond, app.deliverPush)
	}
	run("retain notification history", time.Hour, func(ctx context.Context) error {
		_, err := app.db.Exec(ctx, `DELETE FROM push_jobs WHERE finished_at<now()-interval '7 days';
		DELETE FROM app_notifications WHERE created_at<now()-interval '90 days';
		DELETE FROM realtime_events WHERE published_at<now()-interval '7 days';
		DELETE FROM push_subscriptions s WHERE NOT EXISTS(SELECT 1 FROM user_sessions us WHERE us.token_hash=s.session_hash AND us.membership_id=s.membership_id AND us.revoked_at IS NULL AND us.expires_at>now())`)
		return err
	})
	workers.Wait()
}

func (app *application) publishRealtime(ctx context.Context) error {
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id,tenant_id::text,entity,coalesce(driver_membership_id::text,'') FROM realtime_events WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`)
	if err != nil {
		return err
	}
	type event struct {
		id                     int64
		tenant, entity, member string
	}
	events := make([]event, 0)
	for rows.Next() {
		var e event
		if err := rows.Scan(&e.id, &e.tenant, &e.entity, &e.member); err != nil {
			rows.Close()
			return err
		}
		events = append(events, e)
	}
	rows.Close()
	if rows.Err() != nil {
		return rows.Err()
	}
	for _, e := range events {
		payload, _ := json.Marshal(map[string]any{"type": "invalidate", "id": fmt.Sprint(e.id), "entity": e.entity})
		if err := app.redis.Publish(ctx, realtimeChannel(e.tenant, ""), payload).Err(); err != nil {
			return err
		}
		if e.member != "" {
			if err := app.redis.Publish(ctx, realtimeChannel(e.tenant, e.member), payload).Err(); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE realtime_events SET published_at=now() WHERE id=$1`, e.id); err != nil {
			return err
		}
	}
	// Delivery is at-least-once: client invalidations are idempotent; reconnect always resynchronizes.
	return tx.Commit(ctx)
}

func (app *application) deliverPush(ctx context.Context) error {
	var jobID int64
	err := app.db.QueryRow(ctx, `WITH claim AS (SELECT id FROM push_jobs WHERE finished_at IS NULL AND available_at<=now() AND (locked_until IS NULL OR locked_until<now()) ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE push_jobs j SET locked_until=now()+interval '60 seconds',attempts=attempts+1 FROM claim WHERE j.id=claim.id RETURNING j.id`).Scan(&jobID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var s webpush.Subscription
	var id, member, role, category, title, body, path, subscriptionID string
	var attempts int
	var created time.Time
	var enabled, validSession bool
	err = app.db.QueryRow(ctx, `SELECT s.id::text,s.endpoint,s.p256dh,s.auth,n.id::text,n.membership_id::text,m.role::text,n.category,n.title,n.body,n.url,n.created_at,j.attempts,
 coalesce((p.categories->>n.category)::boolean,true),
 m.is_active AND EXISTS(SELECT 1 FROM user_sessions us WHERE us.token_hash=s.session_hash AND us.membership_id=s.membership_id AND us.revoked_at IS NULL AND us.expires_at>now())
 FROM push_jobs j JOIN push_subscriptions s ON s.id=j.subscription_id JOIN app_notifications n ON n.id=j.notification_id
 JOIN memberships m ON m.id=n.membership_id LEFT JOIN notification_preferences p ON p.membership_id=m.id WHERE j.id=$1 AND s.membership_id=n.membership_id`, jobID).Scan(&subscriptionID, &s.Endpoint, &s.Keys.P256dh, &s.Keys.Auth, &id, &member, &role, &category, &title, &body, &path, &created, &attempts, &enabled, &validSession)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = app.db.Exec(ctx, `UPDATE push_jobs SET finished_at=now() WHERE id=$1`, jobID)
		return err
	}
	if err != nil {
		return err
	}
	permitted := role == "owner" || role == "admin" || role == "developer" || (role == "dispatcher" && category != "payments") || (role == "driver" && (category == "trips" || category == "newBookings" || category == "test"))
	if !enabled || !validSession || !permitted || time.Since(created) > 24*time.Hour || !validPushSubscription(s) {
		_, err = app.db.Exec(ctx, `UPDATE push_jobs SET finished_at=now() WHERE id=$1`, jobID)
		return err
	}
	if role == "driver" && category != "test" {
		path = "/driver"
	}
	if !notificationURL(path) {
		path = "/profile"
	}
	payload, _ := json.Marshal(map[string]any{"title": title, "body": body, "url": path, "tag": "vivat:" + id})
	result, sendErr := webpush.SendNotificationWithContext(ctx, payload, &s, &webpush.Options{HTTPClient: pushHTTPClient, Subscriber: optionalEnv("PUSH_VAPID_SUBJECT", "mailto:support@wtmelon.store"), VAPIDPublicKey: app.pushPublicKey, VAPIDPrivateKey: app.pushPrivateKey, TTL: 3600, Urgency: webpush.UrgencyNormal})
	status := 0
	if result != nil {
		status = result.StatusCode
		_, _ = io.Copy(io.Discard, io.LimitReader(result.Body, 8192))
		result.Body.Close()
	}
	if status == 404 || status == 410 {
		_, err = app.db.Exec(ctx, `DELETE FROM push_subscriptions WHERE id=$1`, subscriptionID)
		return err
	}
	if sendErr == nil && status >= 200 && status < 300 {
		_, err = app.db.Exec(ctx, `UPDATE push_jobs SET finished_at=now(),locked_until=NULL WHERE id=$1`, jobID)
		return err
	}
	if attempts >= 8 || (status >= 400 && status < 500 && status != 429) {
		_, err = app.db.Exec(ctx, `UPDATE push_jobs SET finished_at=now(),locked_until=NULL WHERE id=$1`, jobID)
		app.log.Warn("push delivery stopped", "status", status, "attempts", attempts)
		return err
	}
	delay := time.Duration(1<<min(attempts, 10)) * 15 * time.Second
	_, err = app.db.Exec(ctx, `UPDATE push_jobs SET available_at=now()+$2::interval,locked_until=NULL WHERE id=$1`, jobID, fmt.Sprintf("%d seconds", int(delay.Seconds())))
	return err
}
