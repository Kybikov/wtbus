package main

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"math/big"
	"strings"
	"time"
)

var errMoneyPermission = errors.New("Недостаточно прав для этой операции.")

type moneyConflict string

func (e moneyConflict) Error() string { return string(e) }

func moneyManager(a identity) bool {
	return a.Role == "owner" || a.Role == "admin" || a.Role == "developer"
}
func moneyViewer(a identity) bool { return moneyManager(a) || a.Role == "accountant" }
func moneyOwner(a identity) bool  { return a.Role == "owner" || a.Role == "developer" }
func moneyAccountBalance(ctx context.Context, tx pgx.Tx, tenant, kind, owner, currency string) (int64, error) {
	var n int64
	err := tx.QueryRow(ctx, `SELECT coalesce(sum(p.amount_minor),0)::bigint FROM money_accounts a LEFT JOIN money_postings p ON p.tenant_id=a.tenant_id AND p.account_id=a.id WHERE a.tenant_id=$1 AND a.owner_type=$2 AND a.owner_id=$3 AND a.currency=$4`, tenant, kind, owner, currency).Scan(&n)
	return n, err
}
func moneyAccountAvailable(ctx context.Context, tx pgx.Tx, tenant, kind, owner, currency string) (int64, error) {
	n, err := moneyAccountBalance(ctx, tx, tenant, kind, owner, currency)
	if err != nil {
		return 0, err
	}
	var held int64
	err = tx.QueryRow(ctx, `SELECT coalesce((SELECT sum(t.amount_minor) FROM money_transfers t JOIN money_accounts a ON a.id=t.account_id AND a.tenant_id=t.tenant_id WHERE a.tenant_id=$1 AND a.owner_type=$2 AND a.owner_id=$3 AND a.currency=$4 AND t.status='pending'),0)+coalesce((SELECT sum(h.amount_minor) FROM driver_cash_handovers h JOIN drivers d ON d.id=h.driver_id AND d.tenant_id=h.tenant_id WHERE h.tenant_id=$1 AND h.currency=$4 AND h.status='pending' AND (($2='driver' AND d.id=$3::uuid) OR ($2='member' AND d.membership_id=$3::uuid))),0)`, tenant, kind, owner, currency).Scan(&held)
	return n - held, err
}
func moneyAccount(ctx context.Context, tx pgx.Tx, tenant, kind, owner, currency string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `SELECT money_account($1,$2,$3,$4)::text`, tenant, kind, owner, currency).Scan(&id)
	return id, err
}

type moneyWallet struct{ ID, Kind, Owner, Currency string }

func moneyWalletLoad(ctx context.Context, tx pgx.Tx, tenant, id string) (moneyWallet, error) {
	var a moneyWallet
	err := tx.QueryRow(ctx, `SELECT id::text,owner_type,owner_id::text,currency FROM money_accounts WHERE tenant_id=$1 AND id=$2`, tenant, id).Scan(&a.ID, &a.Kind, &a.Owner, &a.Currency)
	return a, err
}
func moneySpend(a identity, w moneyWallet) bool {
	return w.Kind == "member" && w.Owner == a.MembershipID || w.Kind == "company" && moneyManager(a)
}
func moneyReceive(a identity, w moneyWallet) bool {
	return w.Kind == "member" && w.Owner == a.MembershipID || w.Kind == "company" && moneyOwner(a)
}
func moneyRound(amount int64, rate string) (int64, error) {
	r, ok := new(big.Rat).SetString(strings.TrimSpace(rate))
	if !ok || r.Sign() <= 0 || amount < 0 {
		return 0, errors.New("Укажите положительный курс.")
	}
	r.Mul(r, new(big.Rat).SetInt64(amount))
	q, rem := new(big.Int), new(big.Int)
	q.QuoRem(r.Num(), r.Denom(), rem)
	if new(big.Int).Lsh(rem, 1).Cmp(r.Denom()) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	if !q.IsInt64() {
		return 0, errors.New("Слишком большая сумма.")
	}
	return q.Int64(), nil
}
func moneyPost(ctx context.Context, tx pgx.Tx, a identity, kind, key, description, trip, booking string, at time.Time, entries map[string]int64) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `INSERT INTO money_journal(tenant_id,actor_membership_id,kind,source_key,description,trip_id,booking_id,occurred_at) VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::uuid,NULLIF($7,'')::uuid,$8) RETURNING id::text`, a.TenantID, a.MembershipID, kind, key, description, trip, booking, at).Scan(&id)
	if err != nil {
		return "", err
	}
	for account, n := range entries {
		if n == 0 {
			continue
		}
		_, err = tx.Exec(ctx, `INSERT INTO money_postings(tenant_id,journal_id,account_id,currency,amount_minor) SELECT tenant_id,$2,id,currency,$3 FROM money_accounts WHERE tenant_id=$1 AND id=$4`, a.TenantID, id, n, account)
		if err != nil {
			return "", err
		}
	}
	return id, nil
}
