package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

type profileUpdate struct {
	DisplayName     *string `json:"displayName"`
	Email           *string `json:"email"`
	CurrentPassword string  `json:"currentPassword"`
	NewPassword     string  `json:"newPassword"`
}

func validProfileUpdate(input profileUpdate) bool {
	if input.DisplayName == nil && input.NewPassword == "" && input.Email == nil {
		return false
	}
	if input.DisplayName != nil {
		name := strings.TrimSpace(*input.DisplayName)
		if name == "" || utf8.RuneCountInString(name) > 100 || strings.ContainsAny(name, "\r\n\x00") {
			return false
		}
	}
	if input.Email != nil {
		email := strings.ToLower(strings.TrimSpace(*input.Email))
		parsed, err := mail.ParseAddress(email)
		if err != nil || parsed.Address != email || len(email) > 254 || strings.ContainsAny(email, "\r\n\x00") || input.CurrentPassword == "" || len(input.CurrentPassword) > 72 {
			return false
		}
	}
	if input.NewPassword != "" {
		if utf8.RuneCountInString(input.NewPassword) < 10 || len(input.NewPassword) > 72 || input.CurrentPassword == "" || len(input.CurrentPassword) > 72 {
			return false
		}
	} else if input.CurrentPassword != "" && input.Email == nil {
		return false
	}
	return true
}

// The account is resolved exclusively from the session, never from submitted IDs.
func (app *application) updateProfile(w http.ResponseWriter, r *http.Request) {
	actor, token, err := app.authenticate(r)
	if err != nil {
		writeAuthenticationError(w, err)
		return
	}
	var input profileUpdate
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || !validProfileUpdate(input) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Проверьте имя, email и пароль. Новый пароль — от 10 символов (до 72 байт)."})
		return
	}
	throttleKey := "auth:profile-password:" + actor.UserID
	credentialsChanged := input.NewPassword != "" || input.Email != nil
	if credentialsChanged {
		limited, err := app.loginIsLimited(r.Context(), throttleKey)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Сервис смены пароля временно недоступен."})
			return
		}
		if limited {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Слишком много попыток. Повторите позже."})
			return
		}
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "Не удалось сохранить профиль."})
		return
	}
	defer tx.Rollback(r.Context())
	var isSystem bool
	if err := tx.QueryRow(r.Context(), `SELECT is_system FROM users WHERE id = $1 FOR UPDATE`, actor.UserID).Scan(&isSystem); err != nil || isSystem {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Системный аккаунт нельзя редактировать."})
		return
	}
	if credentialsChanged {
		var currentHash string
		err := tx.QueryRow(r.Context(), `SELECT password_hash FROM user_credentials WHERE user_id = $1 FOR UPDATE`, actor.UserID).Scan(&currentHash)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(input.CurrentPassword)) != nil) {
			if _, err := app.recordFailedLogin(r.Context(), throttleKey); err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Сервис смены пароля временно недоступен."})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Текущий пароль неверен."})
			return
		}
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "Не удалось проверить пароль."})
			return
		}
		if input.NewPassword != "" {
			nextHash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
			if err != nil {
				writeJSON(w, 500, map[string]string{"error": "Не удалось изменить пароль."})
				return
			}
			if _, err := tx.Exec(r.Context(), `UPDATE user_credentials SET password_hash = $2, updated_at = now() WHERE user_id = $1`, actor.UserID, string(nextHash)); err != nil {
				writeJSON(w, 500, map[string]string{"error": "Не удалось изменить пароль."})
				return
			}
		}
		hash := sha256.Sum256([]byte(token))
		if _, err := tx.Exec(r.Context(), `UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL`, actor.UserID, hash[:]); err != nil {
			writeJSON(w, 500, map[string]string{"error": "Не удалось закрыть другие сессии."})
			return
		}
	}
	if input.Email != nil {
		actor.Email = strings.ToLower(strings.TrimSpace(*input.Email))
		if _, err := tx.Exec(r.Context(), `UPDATE users SET email=$2,updated_at=now() WHERE id=$1`, actor.UserID, actor.Email); err != nil {
			var conflict *pgconn.PgError
			if errors.As(err, &conflict) && conflict.Code == "23505" {
				writeError(w, 409, "Этот email уже используется.")
				return
			}
			writeError(w, 500, "Не удалось изменить email.")
			return
		}
	}

	if input.DisplayName != nil {
		actor.DisplayName = strings.TrimSpace(*input.DisplayName)
		if _, err := tx.Exec(r.Context(), `UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1`, actor.UserID, actor.DisplayName); err != nil {
			writeJSON(w, 500, map[string]string{"error": "Не удалось сохранить имя."})
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Не удалось сохранить профиль."})
		return
	}
	if credentialsChanged {
		if err := app.redis.Del(r.Context(), throttleKey).Err(); err != nil {
			app.log.Warn("clear profile password throttle", "error", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"tenantSlug": actor.TenantSlug, "membershipId": actor.MembershipID, "role": actor.Role, "displayName": actor.DisplayName, "email": actor.Email})
}
