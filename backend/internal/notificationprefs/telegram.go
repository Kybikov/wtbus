package notificationprefs

import (
	"context"
	"crypto/sha256"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Consume a private-chat link once, bound to this bot's company. Replacing a
// connection deletes its pending jobs, so old notices cannot reach a new account.
func ClaimTelegramLink(ctx context.Context, db *pgxpool.Pool, tenant, token string, chat int64, username string) (bool, error) {
	if len(token) != 43 || chat <= 0 || len(username) > 64 {
		return false, nil
	}
	hash := sha256.Sum256([]byte(token))
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var member string
	err = tx.QueryRow(ctx, `DELETE FROM staff_telegram_link_tokens t USING memberships m,users u WHERE t.token_hash=$1 AND t.tenant_id=$2 AND t.expires_at>now() AND m.id=t.membership_id AND m.tenant_id=t.tenant_id AND m.is_active AND u.id=m.user_id AND NOT u.is_system RETURNING t.membership_id::text`, hash[:], tenant).Scan(&member)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM staff_telegram_connections WHERE membership_id=$1`, member); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO staff_telegram_connections(membership_id,tenant_id,chat_id,username) VALUES($1,$2,$3,$4)`, member, tenant, chat, username); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
