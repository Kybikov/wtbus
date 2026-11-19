package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const workspaceMonthlyMinor = 300000

func validSubscriptionDate(value string) bool {
	date, err := time.Parse("2006-01-02", value)
	return err == nil && date.Format("2006-01-02") == value && date.Year() >= 2000 && date.Year() <= 2100
}

type platformTrendRow struct {
	Month          string `json:"month"`
	CollectedMinor int64  `json:"collectedMinor"`
	Bookings       int64  `json:"bookings"`
}

func (app *application) requirePlatformAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		actor, _, err := app.authenticate(r)
		if err != nil {
			writeAuthenticationError(w, err)
			return
		}
		if !actor.PlatformAdmin {
			writeJSON(w, 403, map[string]string{"error": "Доступно администратору платформы."})
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), identityContextKey{}, actor)))
	}
}

type platformWorkspaceRow struct {
	Slug     string  `json:"slug"`
	Name     string  `json:"name"`
	Status   string  `json:"status"`
	Members  int64   `json:"members"`
	Trips    int64   `json:"trips"`
	Bookings int64   `json:"bookings"`
	Through  *string `json:"through"`
}

func (app *application) platformWorkspaces(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := app.db.Query(ctx, `SELECT t.slug,t.name,
		effective_workspace_status(t.subscription_status,t.subscription_through,(now() AT TIME ZONE t.timezone)::date),
		(SELECT count(*) FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=t.id AND m.is_active AND NOT u.is_system),
		(SELECT count(*) FROM trips r WHERE r.tenant_id=t.id),
		(SELECT count(*) FROM bookings b WHERE b.tenant_id=t.id), t.subscription_through::text
		FROM tenants t ORDER BY lower(t.name),t.slug`)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[platformWorkspaceRow])
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	rows, err = app.db.Query(ctx, `WITH current_month AS (
		SELECT date_trunc('month',now() AT TIME ZONE 'Europe/Kyiv') AS month
	), months AS (
		SELECT generate_series(month - interval '5 months', month, interval '1 month') AS month FROM current_month
	)
	SELECT to_char(m.month,'YYYY-MM'),
		(SELECT COALESCE(sum(amount_minor),0)::bigint FROM workspace_subscription_payments
		 WHERE paid_on>=m.month::date AND paid_on<(m.month+interval '1 month')::date),
		(SELECT count(*) FROM bookings
		 WHERE created_at>=m.month AT TIME ZONE 'Europe/Kyiv' AND created_at<(m.month+interval '1 month') AT TIME ZONE 'Europe/Kyiv')
	FROM months m ORDER BY m.month`)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	trend, err := pgx.CollectRows(rows, pgx.RowToStructByPos[platformTrendRow])
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "monthlyMinor": workspaceMonthlyMinor, "currency": "UAH", "collectedMinor": trend[len(trend)-1].CollectedMinor, "trend": trend})
}

type platformPaymentRow struct {
	AmountMinor int64  `json:"amountMinor"`
	PaidOn      string `json:"paidOn"`
	Source      string `json:"source"`
	Reference   string `json:"reference"`
	Actor       string `json:"actor"`
}

type platformEventRow struct {
	At              time.Time `json:"at"`
	Action          string    `json:"action"`
	Actor           string    `json:"actor"`
	Previous        string    `json:"previous"`
	Next            string    `json:"next"`
	Reason          string    `json:"reason"`
	PreviousThrough *string   `json:"previousThrough"`
	NextThrough     *string   `json:"nextThrough"`
}

func (app *application) platformWorkspace(w http.ResponseWriter, r *http.Request) {
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	ctx := r.Context()
	if r.Method == http.MethodPatch {
		var input struct {
			Status  string  `json:"status"`
			Reason  string  `json:"reason"`
			Through *string `json:"through"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || (input.Status == "" && input.Through == nil) || (input.Status != "" && !isSubscriptionStatus(input.Status)) || (input.Through != nil && !validSubscriptionDate(*input.Through)) || utf8.RuneCountInString(input.Reason) > 500 {
			writeJSON(w, 400, map[string]string{"error": "Проверьте статус и дату окончания доступа."})
			return
		}
		actor, _ := identityFromContext(ctx)
		tx, err := app.db.Begin(ctx)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		defer tx.Rollback(ctx)
		var old string
		var oldThrough *string
		if err = tx.QueryRow(ctx, `SELECT subscription_status,subscription_through::text FROM tenants WHERE id=$1 FOR UPDATE`, company.ID).Scan(&old, &oldThrough); err != nil {
			app.publicFailure(w, err)
			return
		}
		if input.Status == "" {
			input.Status = old
		}
		changedDate := input.Through != nil && (oldThrough == nil || *input.Through != *oldThrough)
		if input.Through == nil {
			input.Through = oldThrough
		}
		if old != input.Status || changedDate {
			_, err = tx.Exec(ctx, `UPDATE tenants SET subscription_status=$2,subscription_through=$3::text::date,updated_at=now() WHERE id=$1`, company.ID, input.Status, input.Through)
			if err == nil {
				_, err = tx.Exec(ctx, `INSERT INTO subscription_events(tenant_id,previous_status,next_status,reason,actor_user_id,previous_through,next_through)
					VALUES($1,$2,$3,NULLIF($4,''),$5,$6::text::date,$7::text::date)`, company.ID, old, input.Status, strings.TrimSpace(input.Reason), actor.UserID, oldThrough, input.Through)
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
		writeJSON(w, 200, map[string]any{"status": input.Status, "through": input.Through})
		return
	}
	rows, err := app.db.Query(ctx, `SELECT p.amount_minor,p.paid_on::text,p.source,p.reference,COALESCE(u.display_name,'')
		FROM workspace_subscription_payments p LEFT JOIN users u ON u.id=p.actor_user_id
		WHERE p.tenant_id=$1 ORDER BY p.paid_on DESC,p.created_at DESC,p.id LIMIT 50`, company.ID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	payments, err := pgx.CollectRows(rows, pgx.RowToStructByPos[platformPaymentRow])
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	rows, err = app.db.Query(ctx, `SELECT at,action,actor,previous,next,reason,previous_through,next_through FROM (
		SELECT e.changed_at at,'subscription' action,COALESCE(u.display_name,'') actor,e.previous_status previous,e.next_status next,COALESCE(e.reason,'') reason,e.previous_through::text,e.next_through::text
		FROM subscription_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.tenant_id=$1
		UNION ALL SELECT t.created_at,'created',COALESCE(u.display_name,''),'','','',NULL,NULL FROM tenants t LEFT JOIN users u ON u.id=t.platform_created_by WHERE t.id=$1
		UNION ALL SELECT p.created_at,'payment',COALESCE(u.display_name,''),'','',p.reference,NULL,NULL FROM workspace_subscription_payments p LEFT JOIN users u ON u.id=p.actor_user_id WHERE p.tenant_id=$1
		UNION ALL SELECT a.created_at,'entered',COALESCE(u.display_name,''),'','','',NULL,NULL
		FROM activity_events a LEFT JOIN memberships m ON m.id=a.actor_membership_id LEFT JOIN users u ON u.id=m.user_id
		WHERE a.tenant_id=$1 AND a.action='platform_workspace_entered'
		) events ORDER BY at DESC LIMIT 50`, company.ID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	events, err := pgx.CollectRows(rows, pgx.RowToStructByPos[platformEventRow])
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"payments": payments, "events": events, "status": company.ConfiguredSubscriptionStatus, "effectiveStatus": company.SubscriptionStatus, "through": company.SubscriptionThrough})
}

func (app *application) platformWorkspacePayment(w http.ResponseWriter, r *http.Request) {
	company, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	var input struct {
		AmountMinor int64  `json:"amountMinor"`
		PaidOn      string `json:"paidOn"`
		Reference   string `json:"reference"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
		writeJSON(w, 400, map[string]string{"error": "Проверьте данные оплаты."})
		return
	}
	paid, err := time.Parse("2006-01-02", input.PaidOn)
	input.Reference = strings.TrimSpace(input.Reference)
	if err != nil || paid.Year() < 2000 || paid.Year() > 2100 || input.AmountMinor < 1 || input.AmountMinor > 100000000 || input.Reference == "" || utf8.RuneCountInString(input.Reference) > 160 {
		writeJSON(w, 400, map[string]string{"error": "Укажите дату, сумму в гривнах и номер платежа."})
		return
	}
	actor, _ := identityFromContext(r.Context())
	var id string
	err = app.db.QueryRow(r.Context(), `INSERT INTO workspace_subscription_payments(tenant_id,amount_minor,paid_on,reference,actor_user_id)
		VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,source,reference) DO NOTHING RETURNING id::text`, company.ID, input.AmountMinor, paid, input.Reference, actor.UserID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 409, map[string]string{"error": "Этот платёж уже учтён."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, 201, map[string]string{"id": id})
}
