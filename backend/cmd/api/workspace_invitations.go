package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

func canInviteRole(actor, role string) bool {
	switch role {
	case "admin", "dispatcher", "driver", "accountant":
		return canManageTeamRole(actor, role, role)
	default:
		return false
	}
}

func readInvitationJSON(w http.ResponseWriter, r *http.Request, input any) bool {
	w.Header().Set("Cache-Control", "private, no-store")
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(input) == nil && decoder.Decode(new(any)) == io.EOF {
		return true
	}
	writeJSON(w, 400, map[string]string{"error": "Проверьте данные приглашения."})
	return false
}

type workspaceInvitationRow struct {
	ID         string    `json:"id"`
	Role       string    `json:"role"`
	DriverName string    `json:"driverName"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	Status     string    `json:"status"`
	AcceptedBy string    `json:"acceptedBy"`
	CreatedBy  string    `json:"createdBy"`
}

func (app *application) workspaceInvitations(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	actor, _ := identityFromContext(r.Context())
	ctx := r.Context()
	switch r.Method {
	case http.MethodGet:
		rows, err := app.db.Query(ctx, `SELECT i.id::text,i.role::text,COALESCE(d.full_name,''),i.created_at,i.expires_at,
			CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted' WHEN i.revoked_at IS NOT NULL THEN 'revoked' WHEN i.expires_at<=now() THEN 'expired' ELSE 'open' END,
			COALESCE(au.display_name,''),COALESCE(cu.display_name,'')
			FROM workspace_invitations i LEFT JOIN drivers d ON d.id=i.driver_id AND d.tenant_id=i.tenant_id
			LEFT JOIN memberships am ON am.id=i.accepted_by LEFT JOIN users au ON au.id=am.user_id
			LEFT JOIN memberships cm ON cm.id=i.created_by LEFT JOIN users cu ON cu.id=cm.user_id
			WHERE i.tenant_id=$1 ORDER BY (i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at>now()) DESC,i.created_at DESC LIMIT 100`, actor.TenantID)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[workspaceInvitationRow])
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case http.MethodPost:
		var input struct {
			Role     string `json:"role"`
			DriverID string `json:"driverId"`
		}
		if !readInvitationJSON(w, r, &input) {
			return
		}
		if !canInviteRole(actor.Role, input.Role) || (input.DriverID != "" && (input.Role != "driver" || !entityRecordID.MatchString(input.DriverID))) {
			writeJSON(w, 403, map[string]string{"error": "Выберите разрешённую роль и профиль водителя."})
			return
		}
		token, hash, err := sessionToken()
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		var id string
		var expires time.Time
		err = app.db.QueryRow(ctx, `INSERT INTO workspace_invitations(tenant_id,created_by,role,driver_id,token_hash)
			SELECT $1,$2,$3::membership_role,NULLIF($4,'')::uuid,$5
			WHERE $4='' OR EXISTS(SELECT 1 FROM drivers WHERE tenant_id=$1 AND id=NULLIF($4,'')::uuid AND membership_id IS NULL)
			RETURNING id::text,expires_at`, actor.TenantID, actor.MembershipID, input.Role, input.DriverID, hash).Scan(&id, &expires)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 409, map[string]string{"error": "Профиль водителя уже подключён или недоступен."})
			return
		}
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		writeJSON(w, 201, map[string]any{"id": id, "token": token, "expiresAt": expires})
	case http.MethodDelete:
		id := r.PathValue("id")
		if !entityRecordID.MatchString(id) {
			writeJSON(w, 404, map[string]string{"error": "Приглашение не найдено."})
			return
		}
		tag, err := app.db.Exec(ctx, `UPDATE workspace_invitations SET revoked_at=now()
			WHERE tenant_id=$1 AND id=$2 AND accepted_at IS NULL AND expires_at>now() AND revoked_at IS NULL
				AND ($3 IN ('developer','owner') OR role IN ('driver','dispatcher'))`, actor.TenantID, id, actor.Role)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		if tag.RowsAffected() == 0 {
			writeJSON(w, 404, map[string]string{"error": "Действующее приглашение не найдено."})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type workspaceInvitation struct {
	ID, TenantID, TenantSlug, Company, Role, IssuerRole string
	DriverID                                            *string
	ExpiresAt                                           time.Time
}

func lookupInvitation(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, hash []byte, lock bool) (workspaceInvitation, error) {
	var item workspaceInvitation
	query := `SELECT i.id::text,t.id::text,t.slug,t.name,i.role::text,
		CASE WHEN u.is_platform_admin THEN 'developer' ELSE m.role::text END,
		i.driver_id::text,i.expires_at
		FROM workspace_invitations i JOIN tenants t ON t.id=i.tenant_id
		JOIN memberships m ON m.id=i.created_by AND m.tenant_id=t.id JOIN users u ON u.id=m.user_id AND NOT u.is_system
		WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
			AND (m.is_active OR u.is_platform_admin)
			AND effective_workspace_status(t.subscription_status,t.subscription_through,(now() AT TIME ZONE t.timezone)::date) IN ('trial','active')`
	if lock {
		query += " FOR UPDATE OF i FOR SHARE OF t,m"
	}
	err := db.QueryRow(ctx, query, hash).Scan(&item.ID, &item.TenantID, &item.TenantSlug, &item.Company, &item.Role, &item.IssuerRole, &item.DriverID, &item.ExpiresAt)
	if err == nil && !canInviteRole(item.IssuerRole, item.Role) {
		err = pgx.ErrNoRows
	}
	return item, err
}

func (app *application) redeemWorkspaceInvitation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Token       string `json:"token"`
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
		Phone       string `json:"phone"`
	}
	if !readInvitationJSON(w, r, &input) {
		return
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(input.Token)
	if err != nil || len(decoded) != 32 {
		writeExpiredInvitation(w)
		return
	}
	hash := sha256.Sum256([]byte(input.Token))
	ctx := r.Context()
	if r.Pattern == "POST /api/v1/auth/invitations/preview" {
		item, err := lookupInvitation(ctx, app.db, hash[:], false)
		if errors.Is(err, pgx.ErrNoRows) {
			writeExpiredInvitation(w)
			return
		}
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"company": item.Company, "role": item.Role, "expiresAt": item.ExpiresAt})
		return
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	address, err := mail.ParseAddress(input.Email)
	if err != nil || address.Address != input.Email || len(input.Email) > 254 || input.Password == "" || len(input.Password) > 72 || utf8.RuneCountInString(input.DisplayName) > 120 {
		writeJSON(w, 400, map[string]string{"error": "Проверьте имя, email и пароль."})
		return
	}
	input.Phone = normalizePhone(input.Phone)
	throttleKey := loginThrottleKey(r, input.Email)
	limited, err := app.loginIsLimited(ctx, throttleKey)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if limited {
		writeInvitationRateLimit(w)
		return
	}

	tx, err := app.db.Begin(ctx)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	item, err := lookupInvitation(ctx, tx, hash[:], true)
	if errors.Is(err, pgx.ErrNoRows) {
		writeExpiredInvitation(w)
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if item.Role == "driver" && input.Phone == "" {
		writeJSON(w, 400, map[string]string{"error": "Укажите телефон водителя в международном формате."})
		return
	}
	actor := identity{TenantID: item.TenantID, TenantSlug: item.TenantSlug, Role: item.Role, Email: input.Email}
	var passwordHash string
	err = tx.QueryRow(ctx, `SELECT u.id::text,u.display_name,COALESCE(c.password_hash,'')
		FROM users u LEFT JOIN user_credentials c ON c.user_id=u.id WHERE u.email=$1 AND NOT u.is_system FOR UPDATE OF u`,
		input.Email).Scan(&actor.UserID, &actor.DisplayName, &passwordHash)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if utf8.RuneCountInString(input.Password) < 12 || utf8.RuneCountInString(input.DisplayName) < 2 {
			writeJSON(w, 400, map[string]string{"error": "Для нового аккаунта укажите имя и пароль от 12 символов."})
			return
		}
		encoded, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		err = tx.QueryRow(ctx, `INSERT INTO users(email,display_name) VALUES($1,$2) ON CONFLICT (email) DO NOTHING RETURNING id::text`,
			input.Email, input.DisplayName).Scan(&actor.UserID)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 409, map[string]string{"error": "Попробуйте ещё раз с паролем своего аккаунта."})
			return
		}
		if err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)`, actor.UserID, string(encoded))
		}
		if err != nil {
			app.publicFailure(w, err)
			return
		}
		actor.DisplayName = input.DisplayName
	case err != nil:
		app.publicFailure(w, err)
		return
	default:
		if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(input.Password)) != nil {
			limited, err = app.recordFailedLogin(ctx, throttleKey)
			if err != nil {
				app.publicFailure(w, err)
				return
			}
			if limited {
				writeInvitationRateLimit(w)
				return
			}
			writeJSON(w, 401, map[string]string{"error": "Для существующего аккаунта введите его текущий пароль."})
			return
		}
	}
	err = tx.QueryRow(ctx, `INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3::membership_role)
		ON CONFLICT(tenant_id,user_id) DO NOTHING RETURNING id::text`, item.TenantID, actor.UserID, item.Role).Scan(&actor.MembershipID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 409, map[string]string{"error": "Этот аккаунт уже есть в команде. Свяжитесь с администратором компании."})
		return
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if item.Role == "driver" {
		if item.DriverID == nil {
			_, err = tx.Exec(ctx, `INSERT INTO drivers(tenant_id,membership_id,full_name,phone_e164,is_active,status)
				VALUES($1,$2,$3,$4,true,'ready')`, item.TenantID, actor.MembershipID, actor.DisplayName, input.Phone)
		} else {
			var driverID string
			err = tx.QueryRow(ctx, `UPDATE drivers SET membership_id=$3,is_active=true,status='ready',updated_at=now()
				WHERE tenant_id=$1 AND id=$2 AND membership_id IS NULL AND phone_e164=$4 RETURNING id::text`,
				item.TenantID, item.DriverID, actor.MembershipID, input.Phone).Scan(&driverID)
		}
		var pgErr *pgconn.PgError
		if errors.Is(err, pgx.ErrNoRows) || (errors.As(err, &pgErr) && pgErr.Code == "23505") {
			writeJSON(w, 409, map[string]string{"error": "Телефон не совпадает с профилем или уже занят. Уточните приглашение у владельца."})
			return
		}
		if err != nil {
			app.publicFailure(w, err)
			return
		}
	}
	_, err = tx.Exec(ctx, `UPDATE workspace_invitations SET accepted_at=now(),accepted_by=$2 WHERE id=$1`, item.ID, actor.MembershipID)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details)
			VALUES($1,$2,'human','invitation_accepted','team',$2::uuid::text,jsonb_build_object('invitationId',$3::text,'role',$4::text))`,
			item.TenantID, actor.MembershipID, item.ID, item.Role)
	}
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	session, err := createSessionWith(ctx, tx, actor)
	if err != nil {
		app.publicFailure(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		app.publicFailure(w, err)
		return
	}
	if capture, ok := ctx.Value(auditContextKey{}).(*auditCapture); ok {
		capture.activityRecorded = true
	}
	_ = app.redis.Del(ctx, throttleKey).Err()
	writeJSON(w, 201, session)
}

func writeExpiredInvitation(w http.ResponseWriter) {
	writeJSON(w, 404, map[string]string{"error": "Приглашение недействительно. Попросите у компании новую ссылку."})
}

func writeInvitationRateLimit(w http.ResponseWriter) {
	w.Header().Set("Retry-After", strconv.Itoa(int(loginFailureWindow.Seconds())))
	writeJSON(w, 429, map[string]string{"error": "Слишком много попыток. Повторите через 15 минут."})
}
