package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type entityViewConfig struct {
	Mode    string             `json:"mode"`
	Columns []string           `json:"columns"`
	Filters map[string]string  `json:"filters"`
	Metrics []entityViewMetric `json:"metrics,omitempty"`
}

type entityViewMetric struct {
	Field     string `json:"field"`
	Operation string `json:"operation"`
	Value     string `json:"value,omitempty"`
}
type savedEntityView struct {
	ID         string           `json:"id"`
	Name       string           `json:"name"`
	Visibility string           `json:"visibility"`
	Config     entityViewConfig `json:"config"`
	Version    int              `json:"version"`
	CanEdit    bool             `json:"canEdit"`
}
type entityViewInput struct {
	Name       string           `json:"name"`
	Visibility string           `json:"visibility"`
	Config     entityViewConfig `json:"config"`
	Version    int              `json:"version"`
}

var entityColumnID = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{1,100}$`)

func validateEntityView(entity string, input *entityViewInput) bool {
	if !validEntityCollection(entity) {
		return false
	}
	input.Name = strings.TrimSpace(input.Name)
	if len([]rune(input.Name)) < 1 || len([]rune(input.Name)) > 80 || (input.Visibility != "private" && input.Visibility != "shared") || len(input.Config.Columns) < 1 || len(input.Config.Columns) > 100 {
		return false
	}
	mode := input.Config.Mode
	if mode != "table" && mode != "list" && mode != "gallery" && !(mode == "schedule" && entity == "trips") && !(mode == "kanban" && (entity == "bookings" || entity == "team" || entity == "requests" || entity == "trips" || entity == "fleet")) && !(mode == "calendar" && (entity == "bookings" || entity == "requests" || entity == "trips" || entity == "availability")) {
		return false
	}
	seen := map[string]bool{}
	for _, column := range input.Config.Columns {
		if !entityColumnID.MatchString(column) || seen[column] {
			return false
		}
		seen[column] = true
	}
	if len(input.Config.Metrics) > 12 {
		return false
	}
	metricKeys := map[entityViewMetric]bool{}
	for _, metric := range input.Config.Metrics {
		if !entityColumnID.MatchString(metric.Field) || metricKeys[metric] {
			return false
		}
		metricKeys[metric] = true
		switch metric.Operation {
		case "filled", "empty", "unique", "sum", "average", "min", "max":
			if metric.Value != "" {
				return false
			}
		case "equals":
			if strings.TrimSpace(metric.Value) == "" || len([]rune(metric.Value)) > 160 {
				return false
			}
		default:
			return false
		}
	}
	if input.Config.Filters == nil {
		input.Config.Filters = map[string]string{}
	}
	for key, value := range input.Config.Filters {
		if value == "" {
			delete(input.Config.Filters, key)
			continue
		}
		valid := false
		switch entity {
		case "customers":
			valid = (key == "telegram" && (value == "linked" || value == "unlinked")) || (key == "trips" && (value == "with" || value == "without"))
		case "team":
			valid = (key == "status" && (value == "active" || value == "inactive" || value == "system")) || (key == "role" && validateTeamRole(value))
		case "bookings":
			if key == "date" {
				_, err := time.Parse("2006-01-02", value)
				valid = err == nil
			}
			if key == "status" {
				valid = value == "pending" || value == "awaiting_payment" || value == "cash_on_boarding" || value == "confirmed" || value == "cancelled" || value == "completed" || value == "expired"
			}
			if key == "source" {
				valid = value == "telegram" || value == "dispatcher" || value == "import" || value == "web"
			}
			if key == "tripStatus" {
				valid = value == "draft" || value == "new" || value == "assigned" || value == "in_progress" || value == "completed" || value == "cancelled"
			}
			if key == "paymentMethod" {
				valid = value == "cash_on_boarding" || value == "cash" || value == "bank_transfer" || value == "none"
			}
		case "routes", "fleet":
			valid = key == "active" && (value == "active" || value == "inactive")
		case "requests":
			valid = key == "status" && (value == "new" || value == "in_progress" || value == "closed" || value == "cancelled")
		case "availability":
			valid = key == "scope" && (value == "all" || value == "route")
		case "trips":
			valid = (key == "kind" && (value == "regular" || value == "individual")) || (key == "status" && (value == "draft" || value == "new" || value == "assigned" || value == "in_progress" || value == "completed" || value == "cancelled"))
		case "cash-balances":
			valid = key == "currency" && (value == "EUR" || value == "UAH")
		}
		if !valid {
			return false
		}
	}
	return true
}

func canEditEntityView(actor identity, owner *string, visibility string) bool {
	return (owner != nil && *owner == actor.MembershipID) || (visibility == "shared" && (actor.Role == "owner" || actor.Role == "admin" || actor.Role == "developer"))
}

func (app *application) entityViews(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	company, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	actor, ok := identityFromContext(r.Context())
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "authentication is required"})
		return
	}
	if actor.TenantID != company.ID {
		writeJSON(w, 403, map[string]string{"error": "Доступ до компанії заборонено."})
		return
	}
	entity := r.URL.Query().Get("entity")
	if !validEntityCollection(entity) {
		writeJSON(w, 400, map[string]string{"error": "Оберіть колекцію."})
		return
	}
	if (entity == "team" || entity == "cash-balances") && actor.Role != "owner" && actor.Role != "admin" && actor.Role != "developer" {
		writeJSON(w, 403, map[string]string{"error": "Доступ до команди заборонено."})
		return
	}
	if r.Method == "GET" {
		rows, err := app.db.Query(r.Context(), `SELECT id::text,name,visibility,config,version,owner_membership_id::text FROM entity_views WHERE tenant_id=$1 AND entity=$2 AND (visibility='shared' OR owner_membership_id=$3) ORDER BY lower(name),id`, company.ID, entity, actor.MembershipID)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		defer rows.Close()
		items := make([]savedEntityView, 0)
		for rows.Next() {
			var item savedEntityView
			var data []byte
			var owner *string
			if err = rows.Scan(&item.ID, &item.Name, &item.Visibility, &data, &item.Version, &owner); err != nil {
				app.publicFailure(w, err)
				return
			}
			if err = json.Unmarshal(data, &item.Config); err != nil {
				app.publicFailure(w, err)
				return
			}
			item.CanEdit = canEditEntityView(actor, owner, item.Visibility)
			items = append(items, item)
		}
		if err = rows.Err(); err != nil {
			app.publicFailure(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "scopeKey": company.ID + ":" + actor.MembershipID})
		return
	}
	var input entityViewInput
	if r.Method != "DELETE" {
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil || !validateEntityView(entity, &input) {
			writeJSON(w, 400, map[string]string{"error": "Перевірте назву та параметри виду."})
			return
		}
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var id, visibility string
	var owner *string
	var version int
	if r.Method != "POST" {
		id = r.URL.Query().Get("id")
		if !publicUUID.MatchString(id) {
			writeJSON(w, 400, map[string]string{"error": "Оберіть вид."})
			return
		}
		err = tx.QueryRow(r.Context(), `SELECT visibility,owner_membership_id::text,version FROM entity_views WHERE id=$1 AND tenant_id=$2 AND entity=$3 AND (visibility='shared' OR owner_membership_id=$4) FOR UPDATE`, id, company.ID, entity, actor.MembershipID).Scan(&visibility, &owner, &version)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 404, map[string]string{"error": "Вид більше недоступний."})
			return
		}
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		if !canEditEntityView(actor, owner, visibility) {
			writeJSON(w, 403, map[string]string{"error": "Ви не можете змінювати цей вид. Створіть власну копію."})
			return
		}
		if r.Method == "PATCH" && (input.Version != version || (visibility == "shared" && input.Visibility == "private" && (owner == nil || *owner != actor.MembershipID))) {
			writeJSON(w, 409, map[string]string{"error": "Вид змінено іншим користувачем. Оновіть список або створіть копію."})
			return
		}
	}
	if r.Method == "DELETE" {
		_, err = tx.Exec(r.Context(), `DELETE FROM entity_views WHERE id=$1`, id)
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		writeJSON(w, 200, map[string]bool{"deleted": true})
		return
	}
	data, _ := json.Marshal(input.Config)
	var item savedEntityView
	item.Config = input.Config
	item.CanEdit = true
	if r.Method == "POST" {
		var locked string
		err = tx.QueryRow(r.Context(), `SELECT id::text FROM tenants WHERE id=$1 FOR UPDATE`, company.ID).Scan(&locked)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		var count int
		err = tx.QueryRow(r.Context(), `SELECT count(*) FROM entity_views WHERE tenant_id=$1 AND entity=$2`, company.ID, entity).Scan(&count)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		if count >= 200 {
			writeJSON(w, 409, map[string]string{"error": "Досягнуто ліміт 200 видів. Видаліть непотрібні."})
			return
		}
		err = tx.QueryRow(r.Context(), `INSERT INTO entity_views(tenant_id,owner_membership_id,entity,name,visibility,config) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text,name,visibility,version`, company.ID, actor.MembershipID, entity, input.Name, input.Visibility, data).Scan(&item.ID, &item.Name, &item.Visibility, &item.Version)
	} else {
		err = tx.QueryRow(r.Context(), `UPDATE entity_views SET name=$2,visibility=$3,config=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING id::text,name,visibility,version`, id, input.Name, input.Visibility, data).Scan(&item.ID, &item.Name, &item.Visibility, &item.Version)
	}
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeJSON(w, 409, map[string]string{"error": "Вид із такою назвою вже існує."})
			return
		}
		app.publicFailure(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		app.publicFailure(w, err)
		return
	}
	status := 200
	if r.Method == "POST" {
		status = 201
	}
	writeJSON(w, status, map[string]any{"item": item})
}
