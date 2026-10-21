package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vivat-bus/tms/internal/ibanpayment"
	"github.com/vivat-bus/tms/internal/telegramoutbox"
)

type bankAccount struct {
	ID       string `json:"id"`
	IBAN     string `json:"iban"`
	Currency int    `json:"currencyCode"`
	Balance  int64  `json:"balance"`
}
type bankClient struct {
	Accounts []bankAccount `json:"accounts"`
	Managed  []struct {
		Accounts []bankAccount `json:"accounts"`
	} `json:"managedClients"`
}
type bankTransaction struct {
	ID          string `json:"id"`
	Time        int64  `json:"time"`
	Amount      int64  `json:"amount"`
	Balance     int64  `json:"balance"`
	Description string `json:"description"`
	Comment     string `json:"comment"`
	Hold        bool   `json:"hold"`
}

func findBankAccount(info bankClient, iban string) (bankAccount, bool) {
	accounts := append([]bankAccount{}, info.Accounts...)
	for _, client := range info.Managed {
		accounts = append(accounts, client.Accounts...)
	}
	for _, account := range accounts {
		if account.Currency == 980 && ibanpayment.NormalizeIBAN(account.IBAN) == ibanpayment.NormalizeIBAN(iban) {
			return account, true
		}
	}
	return bankAccount{}, false
}
func bankRead(ctx context.Context, client *http.Client, endpoint, token string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Token", token)
	req.Header.Set("Accept", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return errors.New("Monobank временно недоступен. Повторим автоматически.")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("Monobank: ошибка %d. Проверьте подключение.", response.StatusCode)
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 16<<20)).Decode(out); err != nil {
		return errors.New("Не удалось прочитать ответ Monobank.")
	}
	return nil
}
func (app *application) bankWorker(ctx context.Context) {
	ticker := time.NewTicker(65 * time.Second)
	defer ticker.Stop()
	for {
		rows, err := app.db.Query(ctx, `SELECT c.tenant_id::text,s.monobank_token,c.iban FROM tenant_payment_configs c JOIN tenant_integration_secrets s ON s.tenant_id=c.tenant_id WHERE c.is_enabled AND c.iban<>'' AND coalesce(s.monobank_token,'')<>''`)
		type target struct{ id, token, iban string }
		targets := []target{}
		if err == nil {
			for rows.Next() {
				var t target
				if rows.Scan(&t.id, &t.token, &t.iban) == nil {
					targets = append(targets, t)
				}
			}
			rows.Close()
		}
		for _, t := range targets {
			if ctx.Err() != nil {
				return
			}
			if err := app.syncBank(ctx, t.id, t.token, t.iban); err != nil && ctx.Err() == nil {
				app.log.Warn("bank statement sync failed", "tenantId", t.id, "error", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (app *application) syncBank(ctx context.Context, tenantID, token, iban string) error {
	conn, err := app.db.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	var locked bool
	err = conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended('bank:'||$1,0))`, tenantID).Scan(&locked)
	if err != nil || !locked {
		return err
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtextextended('bank:'||$1,0))`, tenantID)
	digest := sha256.Sum256([]byte(token + ":" + ibanpayment.NormalizeIBAN(iban)))
	hash := hex.EncodeToString(digest[:])
	var accountID, storedHash string
	var attempted, synced *time.Time
	err = conn.QueryRow(ctx, `SELECT account_id,token_hash,last_attempt_at,statement_synced_at FROM payment_reconciliation_state WHERE tenant_id=$1`, tenantID).Scan(&accountID, &storedHash, &attempted, &synced)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if attempted != nil && time.Since(*attempted) < 65*time.Second {
		return nil
	}
	if storedHash != hash {
		accountID = ""
		synced = nil
	}
	_, err = conn.Exec(ctx, `INSERT INTO payment_reconciliation_state(tenant_id,last_attempt_at) VALUES($1,now()) ON CONFLICT(tenant_id) DO UPDATE SET last_attempt_at=now()`, tenantID)
	if err != nil {
		return err
	}
	failure := func(e error) error {
		_, _ = conn.Exec(ctx, `UPDATE payment_reconciliation_state SET last_error=$2,updated_at=now() WHERE tenant_id=$1`, tenantID, e.Error())
		return e
	}
	client := app.bankHTTPClient
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	base := app.bankBaseURL
	if base == "" {
		base = "https://api.monobank.ua"
	}
	var initialBalance *int64
	if accountID == "" {
		var info bankClient
		if err = bankRead(ctx, client, base+"/personal/client-info", token, &info); err != nil {
			return failure(err)
		}
		account, found := findBankAccount(info, iban)
		if !found {
			return failure(errors.New("Гривневый IBAN не найден среди счетов Monobank. Проверьте токен и IBAN."))
		}
		accountID = account.ID
		initialBalance = &account.Balance
	}
	now := time.Now().UTC()
	from := now.Add(-30 * 24 * time.Hour)
	if synced != nil && synced.Add(-2*time.Hour).After(from) {
		from = synced.Add(-2 * time.Hour)
	}
	var statement []bankTransaction
	if err = bankRead(ctx, client, fmt.Sprintf("%s/personal/statement/%s/%d/%d", base, url.PathEscape(accountID), from.Unix(), now.Unix()), token, &statement); err != nil {
		return failure(err)
	}
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var balanceAt *time.Time
	balance := initialBalance
	for _, item := range statement {
		if strings.TrimSpace(item.ID) == "" || item.Time <= 0 {
			return failure(errors.New("Monobank вернул операцию без идентификатора или даты."))
		}
		at := time.Unix(item.Time, 0).UTC()
		if balanceAt == nil || at.After(*balanceAt) {
			b := item.Balance
			balance = &b
			balanceAt = &at
		}
		_, err = tx.Exec(ctx, `INSERT INTO bank_statement_transactions(tenant_id,account_id,provider_id,amount_minor,currency,balance_minor,description,comment,occurred_at,is_hold) VALUES($1,$2,$3,$4,'UAH',$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,account_id,provider_id) DO UPDATE SET amount_minor=excluded.amount_minor,balance_minor=excluded.balance_minor,description=excluded.description,comment=excluded.comment,is_hold=excluded.is_hold,synced_at=now() WHERE (bank_statement_transactions.amount_minor,bank_statement_transactions.balance_minor,bank_statement_transactions.description,bank_statement_transactions.comment,bank_statement_transactions.is_hold) IS DISTINCT FROM (excluded.amount_minor,excluded.balance_minor,excluded.description,excluded.comment,excluded.is_hold)`, tenantID, accountID, item.ID, item.Amount, item.Balance, item.Description, item.Comment, at, item.Hold)
		if err != nil {
			return err
		}
		if !item.Hold && item.Amount > 0 {
			if err = app.matchBankPayment(ctx, tx, tenantID, item); err != nil {
				return err
			}
		}
	}
	if initialBalance != nil && balanceAt == nil {
		balanceAt = &now
	}
	_, err = tx.Exec(ctx, `UPDATE payment_reconciliation_state SET account_id=$2,token_hash=$3,last_success_at=now(),statement_synced_at=$4,last_error='',updated_at=now(),bank_balance_minor=coalesce($5,bank_balance_minor),bank_balance_at=coalesce($6,bank_balance_at) WHERE tenant_id=$1`, tenantID, accountID, hash, now, balance, balanceAt)
	if err == nil {
		err = tx.Commit(ctx)
	}
	return err
}
func (app *application) matchBankPayment(ctx context.Context, tx pgx.Tx, tenantID string, item bankTransaction) error {
	rows, err := tx.Query(ctx, `SELECT p.id::text,p.booking_id::text FROM payments p JOIN bookings b ON b.id=p.booking_id AND b.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.provider='internal' AND p.payment_method='bank_transfer' AND p.status='pending' AND p.amount_minor=$2 AND p.currency='UAH' AND b.status='awaiting_payment' AND b.payment_hold_expires_at>now() AND NOT EXISTS(SELECT 1 FROM payments existing WHERE existing.tenant_id=$1 AND existing.provider_payment_id=$3) ORDER BY p.id`, tenantID, item.Amount, item.ID)
	if err != nil {
		return err
	}
	type match struct{ id, booking string }
	matches := []match{}
	description := strings.ToUpper(item.Description + " " + item.Comment)
	for rows.Next() {
		var m match
		if err = rows.Scan(&m.id, &m.booking); err != nil {
			break
		}
		if strings.Contains(description, ibanpayment.Reference(m.id)) {
			matches = append(matches, m)
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil || len(matches) != 1 {
		return err
	}
	m := matches[0]
	// Lock the booking first, matching the manual confirmation path.
	var status string
	var expiresAt *time.Time
	err = tx.QueryRow(ctx, `SELECT status,payment_hold_expires_at FROM bookings WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenantID, m.booking).Scan(&status, &expiresAt)
	if err != nil {
		return err
	}
	// Check wall-clock time after obtaining the lock: now() is fixed when the
	// transaction begins and the booking may have expired while we waited.
	if status != "awaiting_payment" || expiresAt == nil || !expiresAt.After(time.Now()) {
		return nil
	}
	result, err := tx.Exec(ctx, `UPDATE payments SET status='paid',provider_payment_id=$3,paid_at=to_timestamp($4),updated_at=now(),provider_payload=provider_payload||'{"reconciliation":"monobank_statement"}'::jsonb WHERE tenant_id=$1 AND id=$2 AND status='pending'`, tenantID, m.id, item.ID, item.Time)
	if err != nil || result.RowsAffected() == 0 {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE bookings SET status='confirmed',payment_hold_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2`, tenantID, m.booking)
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(telegramoutbox.PaymentConfirmedPayload{BookingID: m.booking, AmountMinor: item.Amount, Currency: "UAH"})
	_, err = tx.Exec(ctx, `INSERT INTO telegram_notification_outbox(tenant_id,chat_id,kind,payload) SELECT $1,c.telegram_id,$3,$4 FROM bookings b JOIN customers c ON c.id=b.customer_id WHERE b.tenant_id=$1 AND b.id=$2 AND c.telegram_id IS NOT NULL`, tenantID, m.booking, telegramoutbox.KindPaymentConfirmed, payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,'system','payment.reconciled','payment',$2,jsonb_build_object('provider','monobank_statement','amountMinor',$3::bigint,'currency','UAH'))`, tenantID, m.id, item.Amount)
	return err
}
