package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type auditContextKey struct{}
type auditCapture struct {
	actor      *identity
	before     map[string]any
	entity, id string
}
type auditResponse struct {
	http.ResponseWriter
	status  int
	body    bytes.Buffer
	capture bool
}

func (w *auditResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *auditResponse) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *auditResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	if w.capture && w.body.Len() < 65536 {
		remaining := 65536 - w.body.Len()
		w.body.Write(b[:min(len(b), remaining)])
	}
	return w.ResponseWriter.Write(b)
}

type auditBody struct {
	io.ReadCloser
	data bytes.Buffer
}

func (b *auditBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if b.data.Len() < 65536 {
		b.data.Write(p[:min(n, 65536-b.data.Len())])
	}
	return n, err
}

func auditTarget(r *http.Request) (string, string) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) > 4 && parts[2] == "tenants" {
		entity := parts[4]
		id := ""
		if len(parts) > 5 && entityRecordID.MatchString(parts[5]) {
			id = parts[5]
		}
		switch entity {
		case "individual-transfer-requests":
			entity = "requests"
		case "availability-blocks":
			entity = "availability"
		}
		return entity, id
	}
	if len(parts) > 3 && parts[2] == "me" {
		return parts[3], ""
	}
	return "profile", ""
}
func (app *application) auditSnapshot(ctx context.Context, actor identity, entity, id string) map[string]any {
	query, ok := entityDetailQueries[entity]
	if !ok || id == "" {
		return nil
	}
	var raw []byte
	if app.db.QueryRow(ctx, query, id, actor.TenantID).Scan(&raw) != nil {
		return nil
	}
	var item map[string]any
	_ = json.Unmarshal(raw, &item)
	return item
}
func (app *application) beginAudit(r *http.Request, actor identity) {
	capture, _ := r.Context().Value(auditContextKey{}).(*auditCapture)
	if capture == nil {
		return
	}
	capture.actor = &actor
	capture.entity, capture.id = auditTarget(r)
	if r.Method != "GET" && r.Method != "HEAD" {
		capture.before = app.auditSnapshot(r.Context(), actor, capture.entity, capture.id)
	}
}

// Bound memory and keep request diagnostics separate from allowlisted record
// value changes. Never persist raw bodies, credentials, IPs or arbitrary keys.
func (app *application) requestAudit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/v1/") || r.URL.Path == "/api/v1/realtime" {
			next.ServeHTTP(w, r)
			return
		}
		started := time.Now()
		random := make([]byte, 16)
		_, _ = rand.Read(random)
		requestID := hex.EncodeToString(random)
		w.Header().Set("X-Request-ID", requestID)
		state := &auditCapture{}
		r = r.WithContext(context.WithValue(r.Context(), auditContextKey{}, state))
		mutation := r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS"
		var body *auditBody
		if mutation && r.Body != nil && strings.Contains(r.Header.Get("Content-Type"), "application/json") {
			body = &auditBody{ReadCloser: r.Body}
			r.Body = body
		}
		response := &auditResponse{ResponseWriter: w, capture: mutation}
		next.ServeHTTP(response, r)
		status := response.status
		if status == 0 {
			status = 200
		}
		duration := time.Since(started).Milliseconds()
		// Route templates cannot contain user-supplied query values or credentials.
		route := r.Pattern
		if route == "" {
			route = "unmatched"
		}
		logger := app.log
		if state.actor != nil {
			logger = logger.With("tenant", state.actor.TenantID, "actor", state.actor.MembershipID)
		}
		logger.Info("api request", "request_id", requestID, "method", r.Method, "route", route, "status", status, "duration_ms", duration)
		if state.actor == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		actor := *state.actor
		var after map[string]any
		if mutation && status >= 200 && status < 300 && state.before != nil {
			after = app.auditSnapshot(ctx, actor, state.entity, state.id)
		}
		tx, err := app.db.Begin(ctx)
		if err != nil {
			app.log.Error("persist request audit", "request_id", requestID)
			return
		}
		defer tx.Rollback(ctx)
		_, err = tx.Exec(ctx, `INSERT INTO api_request_logs(tenant_id,actor_membership_id,request_id,method,route,status,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)`, actor.TenantID, actor.MembershipID, requestID, r.Method, route, status, duration)
		if err == nil && mutation && status >= 200 && status < 300 {
			entity, id := state.entity, state.id
			if entity == "" {
				entity, id = auditTarget(r)
			}
			if id == "" {
				var payload map[string]any
				if json.Unmarshal(response.body.Bytes(), &payload) == nil {
					id, _ = payload["id"].(string)
					if item, ok := payload["item"].(map[string]any); ok && id == "" {
						id, _ = item["id"].(string)
					}
				}
			}
			if !entityRecordID.MatchString(id) {
				id = ""
			}
			action := "record_updated"
			if r.Method == "POST" {
				action = "record_created"
			}
			if r.Method == "DELETE" {
				action = "record_deleted"
			}
			if strings.HasSuffix(r.URL.Path, "/test") {
				action = "integration_checked"
			}
			if strings.HasSuffix(r.URL.Path, "/login") || strings.HasSuffix(r.URL.Path, "/select-company") {
				action = "session_started"
			}
			if strings.HasSuffix(r.URL.Path, "/logout") {
				action = "session_ended"
			}
			details := map[string]any{"requestId": requestID}
			if state.before != nil {
				fields := []string{}
				if after != nil {
					fields = auditChangedFields(state.before, after)
					details["changedFields"] = fields
				}
			} else if body != nil {
				var input map[string]any
				fields := []string{}
				if json.Unmarshal(body.data.Bytes(), &input) == nil {
					for key := range input {
						if auditInputFields[key] {
							fields = append(fields, key)
						}
					}
				}
				sort.Strings(fields)
				details["submittedFields"] = fields
			}
			if state.before != nil && after != nil {
				changes := auditChanges(state.before, after)
				app.labelAuditChanges(ctx, actor, entity, changes)
				if len(changes) > 0 {
					details["changes"] = changes
				}
			}
			// Device housekeeping and GPS samples already have their own records; avoid
			// turning them into thousands of indistinguishable manager activity rows.
			noChange := false
			if fields, ok := details["changedFields"].([]string); ok && len(fields) == 0 {
				noChange = true
			}
			if !noChange && entity != "gps-points" && entity != "push" && entity != "notifications" && entity != "notification-preferences" && entity != "preferences" {
				raw, _ := json.Marshal(details)
				_, err = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,$2,'human',$3,$4,NULLIF($5,''),$6)`, actor.TenantID, actor.MembershipID, action, entity, id, raw)
			}
		}
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			app.log.Error("persist request audit", "request_id", requestID)
		}
	})
}

var auditInputFields = func() map[string]bool {
	m := map[string]bool{}
	for _, key := range strings.Fields("name fullName displayName email phone status isActive role origin destination currency defaultPriceMinor defaultPricingMode driverPayMinor tariffMode distanceKm vehicleClassRates capacity registrationNumber vehicleClass startsAt endsAt vehicleId driverId routeId kind priceMinor pricingMode seats notes operatorNote customData monobankToken telegramBotToken clearMonobank clearTelegramBot primaryColor defaultTheme dispatcherContact logoUrl isEnabled provider password newPassword currentPassword") {
		m[key] = true
	}
	return m
}()

// Separate request diagnostics from manager activity. Every query is tenant scoped
// and paginated by immutable IDs, so new events cannot shift an older page.
func (app *application) activityHistory(w http.ResponseWriter, r *http.Request) {
	actor, _ := identityFromContext(r.Context())
	w.Header().Set("Cache-Control", "private, no-store")
	before := int64(9223372036854775807)
	if raw := r.URL.Query().Get("before"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 1 {
			writeError(w, 400, "Некорректная страница журнала.")
			return
		}
		before = v
	}
	requests := r.URL.Query().Get("kind") == "requests"
	if requests && actor.Role != "owner" && actor.Role != "developer" {
		writeError(w, 403, "Нет доступа к журналу запросов.")
		return
	}
	query := `SELECT e.id::text,coalesce(u.display_name,'Система'),e.action,e.entity_type,coalesce(e.entity_id,''),e.created_at,e.details FROM activity_events e LEFT JOIN memberships m ON m.id=e.actor_membership_id AND m.tenant_id=e.tenant_id LEFT JOIN users u ON u.id=m.user_id WHERE e.tenant_id=$1 AND e.id<$2 ORDER BY e.id DESC LIMIT 51`
	if requests {
		query = `SELECT e.id::text,coalesce(u.display_name,'Система'),e.method,e.route,e.status,e.duration_ms,e.created_at,e.request_id FROM api_request_logs e LEFT JOIN memberships m ON m.id=e.actor_membership_id AND m.tenant_id=e.tenant_id LEFT JOIN users u ON u.id=m.user_id WHERE e.tenant_id=$1 AND e.id<$2 ORDER BY e.id DESC LIMIT 51`
	}
	rows, err := app.db.Query(r.Context(), query, actor.TenantID, before)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, actor, action, entity, entityID, requestID string
		var status int
		var duration int64
		var created time.Time
		var details json.RawMessage
		item := map[string]any{}
		if requests {
			err = rows.Scan(&id, &actor, &action, &entity, &status, &duration, &created, &requestID)
			item["status"] = status
			item["durationMs"] = duration
			item["requestId"] = requestID
		} else {
			err = rows.Scan(&id, &actor, &action, &entity, &entityID, &created, &details)
			var safe struct {
				ChangedFields   []string           `json:"changedFields"`
				SubmittedFields []string           `json:"submittedFields"`
				Changes         []auditFieldChange `json:"changes"`
			}
			_ = json.Unmarshal(details, &safe)
			item["changes"] = safe.Changes
			item["changedFields"] = safe.ChangedFields
			item["submittedFields"] = safe.SubmittedFields
			item["entityId"] = entityID
		}
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		item["id"] = id
		item["actor"] = actor
		item["action"] = action
		item["entity"] = entity
		item["createdAt"] = created
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		app.publicFailure(w, err)
		return
	}
	hasMore := len(items) > 50
	if hasMore {
		items = items[:50]
	}
	writeJSON(w, 200, map[string]any{"items": items, "hasMore": hasMore})
}
