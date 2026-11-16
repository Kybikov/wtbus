package main

import (
	"context"
	"github.com/jackc/pgx/v5"
)

// Linked drivers share the member wallet used by the crew's payment commands.
// Keep legacy commands on that same balance and reserve calculation.
func moneyDriverAvailable(ctx context.Context, tx pgx.Tx, tenant, driver, currency string) (int64, error) {
	var member string
	if err := tx.QueryRow(ctx, `SELECT coalesce(membership_id::text,'') FROM drivers WHERE tenant_id=$1 AND id=$2`, tenant, driver).Scan(&member); err != nil {
		return 0, err
	}
	if member != "" {
		return moneyAccountAvailable(ctx, tx, tenant, "member", member, currency)
	}
	return moneyAccountAvailable(ctx, tx, tenant, "driver", driver, currency)
}
