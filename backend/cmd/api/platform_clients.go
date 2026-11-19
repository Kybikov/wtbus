package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

type platformClient struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Email           string          `json:"email"`
	Members         int64           `json:"members"`
	Workspaces      json.RawMessage `json:"workspaces"`
	DiscountMinor   int64           `json:"discountMinor"`
	DiscountMinimum int             `json:"discountMinimum"`
	MonthlyMinor    int64           `json:"monthlyMinor"`
	Due             *string         `json:"due"`
	DueOverride     *string         `json:"dueOverride"`
}

func (app *application) platformClients(w http.ResponseWriter, r *http.Request) {
	rows, err := app.db.Query(r.Context(), `
		WITH people AS (
			SELECT t.billing_owner_id, count(DISTINCT m.user_id) AS members
			FROM tenants t JOIN memberships m ON m.tenant_id=t.id AND m.is_active
			JOIN users u ON u.id=m.user_id AND NOT u.is_system AND NOT u.is_platform_admin
			WHERE t.billing_owner_id IS NOT NULL GROUP BY t.billing_owner_id
		), workspaces AS (
			SELECT t.*, (SELECT count(*) FROM memberships m JOIN users u ON u.id=m.user_id
				WHERE m.tenant_id=t.id AND m.is_active AND NOT u.is_system AND NOT u.is_platform_admin) AS members,
				(SELECT max(p.paid_on) FROM workspace_subscription_payments p WHERE p.tenant_id=t.id) AS last_paid_on
			FROM tenants t WHERE t.billing_owner_id IS NOT NULL
		)
		SELECT u.id::text,u.display_name,u.email,COALESCE(p.members,0),
			jsonb_agg(jsonb_build_object('slug',t.slug,'name',t.name,'members',t.members,
				'status',effective_workspace_status(t.subscription_status,t.subscription_through,(now() AT TIME ZONE t.timezone)::date),
				'through',t.subscription_through,'lastPaidOn',t.last_paid_on) ORDER BY lower(t.name),t.slug),
			COALESCE(a.monthly_discount_minor,0),COALESCE(a.discount_min_workspaces,2),
			GREATEST(0, count(*)*$1::bigint - CASE WHEN count(*)>=a.discount_min_workspaces THEN a.monthly_discount_minor ELSE 0 END),
			COALESCE(a.next_due_on,min(t.subscription_through)+1)::text,a.next_due_on::text
		FROM workspaces t JOIN users u ON u.id=t.billing_owner_id
		LEFT JOIN people p ON p.billing_owner_id=u.id
		LEFT JOIN workspace_billing_accounts a ON a.owner_id=u.id
		GROUP BY u.id,p.members,a.owner_id ORDER BY lower(u.display_name),u.email
	`, workspaceMonthlyMinor)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[platformClient])
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "unitMinor": workspaceMonthlyMinor})
}

func (app *application) updatePlatformClient(w http.ResponseWriter, r *http.Request) {
	var input struct {
		DiscountMinor   *int64  `json:"discountMinor"`
		DiscountMinimum *int    `json:"discountMinimum"`
		Due             *string `json:"due"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF ||
		(input.DiscountMinor == nil && input.DiscountMinimum == nil && input.Due == nil) ||
		(input.DiscountMinor != nil && (*input.DiscountMinor < 0 || *input.DiscountMinor > 100000000)) ||
		(input.DiscountMinimum != nil && (*input.DiscountMinimum < 1 || *input.DiscountMinimum > 10000)) ||
		(input.Due != nil && *input.Due != "" && !validSubscriptionDate(*input.Due)) {
		writeJSON(w, 400, map[string]string{"error": "Проверьте скидку и дату оплаты."})
		return
	}
	id := r.PathValue("owner")
	if !entityRecordID.MatchString(id) {
		writeJSON(w, 404, map[string]string{"error": "Клиент не найден."})
		return
	}
	result, err := app.db.Exec(r.Context(), `
		INSERT INTO workspace_billing_accounts(owner_id,monthly_discount_minor,discount_min_workspaces,next_due_on)
		SELECT u.id,COALESCE($2,0),COALESCE($3,2),NULLIF($4,'')::date
		FROM users u WHERE u.id=$1 AND EXISTS(SELECT 1 FROM tenants WHERE billing_owner_id=u.id)
		ON CONFLICT (owner_id) DO UPDATE SET
			monthly_discount_minor=COALESCE($2,workspace_billing_accounts.monthly_discount_minor),
			discount_min_workspaces=COALESCE($3,workspace_billing_accounts.discount_min_workspaces),
			next_due_on=CASE WHEN $4 IS NULL THEN workspace_billing_accounts.next_due_on ELSE NULLIF($4,'')::date END
	`, id, input.DiscountMinor, input.DiscountMinimum, input.Due)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if result.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]string{"error": "Клиент не найден."})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (app *application) setPlatformWorkspaceOwner(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email string `json:"email"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || strings.TrimSpace(input.Email) == "" {
		writeJSON(w, 400, map[string]string{"error": "Укажите email владельца."})
		return
	}
	ctx := r.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	var tenantID, status string
	var previous *string
	err = tx.QueryRow(ctx, `SELECT id::text,subscription_status,billing_owner_id::text FROM tenants WHERE slug=$1 FOR UPDATE`, r.PathValue("slug")).Scan(&tenantID, &status, &previous)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Компания не найдена."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	var userID string
	email := strings.ToLower(strings.TrimSpace(input.Email))
	err = tx.QueryRow(ctx, `SELECT u.id::text FROM users u JOIN user_credentials c ON c.user_id=u.id
		WHERE u.email=$1 AND NOT u.is_system AND NOT u.is_platform_admin`, email).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "Аккаунт владельца не найден. Проверьте email."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	result, err := tx.Exec(ctx, `INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')
		ON CONFLICT(tenant_id,user_id) DO UPDATE SET is_active=true WHERE memberships.role='owner'`, tenantID, userID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if result.RowsAffected() == 0 {
		writeJSON(w, 409, map[string]string{"error": "У пользователя уже есть другая роль. Измените её в команде компании."})
		return
	}
	if previous == nil || *previous != userID {
		_, err = tx.Exec(ctx, `UPDATE tenants SET billing_owner_id=$2,updated_at=now() WHERE id=$1`, tenantID, userID)
		if err == nil {
			actor, _ := identityFromContext(ctx)
			_, err = tx.Exec(ctx, `INSERT INTO subscription_events(tenant_id,previous_status,next_status,reason,actor_user_id)
				VALUES($1,$2,$2,$3,$4)`, tenantID, status, "Плательщик: "+email, actor.UserID)
		}
		if err != nil {
			app.publicFailure(w, err)
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		app.publicFailure(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
