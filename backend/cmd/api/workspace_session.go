package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5"
)

func (app *application) workspaces(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	actor, oldToken, err := app.authenticate(r)
	if err != nil {
		writeAuthenticationError(w, err)
		return
	}
	ctx := r.Context()
	if r.Method == http.MethodGet {
		rows, err := app.db.Query(ctx, `SELECT t.slug,t.name,m.role::text FROM memberships m JOIN tenants t ON t.id=m.tenant_id
			WHERE m.user_id=$1 AND m.is_active ORDER BY lower(t.name),t.slug`, actor.UserID)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[companyChoice])
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"current": actor.TenantSlug, "items": items})
		return
	}
	var input struct {
		Slug    string `json:"slug"`
		Support bool   `json:"support"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || !tenantSlugPattern.MatchString(input.Slug) {
		writeJSON(w, 400, map[string]string{"error": "Выберите компанию."})
		return
	}
	if input.Support && !actor.PlatformAdmin {
		writeJSON(w, 403, map[string]string{"error": "Доступно администратору платформы."})
		return
	}
	tx, err := app.db.Begin(ctx)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	next := actor
	next.PlatformAccess = input.Support
	if input.Support {
		// Inactive memberships provide an audit identity without granting normal workspace access.
		_, err = tx.Exec(ctx, `INSERT INTO memberships (tenant_id,user_id,role,is_active)
			SELECT id,$1,'developer',false FROM tenants WHERE slug=$2
			ON CONFLICT (tenant_id,user_id) DO NOTHING`, actor.UserID, input.Slug)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
	}
	err = tx.QueryRow(ctx, `SELECT m.id::text,t.id::text,t.slug,m.role::text
		FROM memberships m JOIN tenants t ON t.id=m.tenant_id
		WHERE m.user_id=$1 AND t.slug=$2 AND (m.is_active OR $3) FOR SHARE OF m`, actor.UserID, input.Slug, input.Support).Scan(&next.MembershipID, &next.TenantID, &next.TenantSlug, &next.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 403, map[string]string{"error": "У вас нет доступа к этой компании."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if input.Support {
		next.Role = "developer"
		_, err = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id)
			VALUES($1,$2,'human','platform_workspace_entered','company',$3)`, next.TenantID, next.MembershipID, next.TenantID)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
	}
	hash := sha256.Sum256([]byte(oldToken))
	tag, err := tx.Exec(ctx, `UPDATE user_sessions SET revoked_at=now() WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()`, hash[:], actor.UserID)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		writeAuthenticationError(w, pgx.ErrNoRows)
		return
	}
	session, err := createSessionWith(ctx, tx, next)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		app.publicFailure(w, err)
		return
	}
	writeJSON(w, 200, session)
}
