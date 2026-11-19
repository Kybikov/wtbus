package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"net/http"
	"strings"
	"time"
)

type moneyCommand struct {
	Action             string `json:"action"`
	RequestID          string `json:"requestId"`
	AccountID          string `json:"accountId"`
	RecipientAccountID string `json:"recipientAccountId"`
	TargetMembershipID string `json:"targetMembershipId"`
	TargetKind         string `json:"targetKind"`
	BookingID          string `json:"bookingId"`
	TripID             string `json:"tripId"`
	Amount             int64  `json:"amountMinor"`
	Currency           string `json:"currency"`
	TargetCurrency     string `json:"targetCurrency"`
	TargetAmount       int64  `json:"targetAmountMinor"`
	Rate               string `json:"rate"`
	OccurredAt         string `json:"occurredAt"`
	Description        string `json:"description"`
	Category           string `json:"category"`
	ID                 string `json:"id"`
	Date               string `json:"date"`
	RateToUAH          string `json:"rateToUAH"`
}

func (app *application) moneyWorkspace(w http.ResponseWriter, r *http.Request) {
	t, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	a, _ := identityFromContext(r.Context())
	if r.Method == "GET" {
		app.moneyWorkspaceRead(w, r, t.ID, a)
		return
	}
	var in moneyCommand
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	d.DisallowUnknownFields()
	if d.Decode(&in) != nil || !validUUID(in.RequestID) {
		writeJSON(w, 400, map[string]string{"error": "Проверьте данные операции."})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	ctx := r.Context()
	_, err = tx.Exec(ctx, `SELECT id FROM tenants WHERE id=$1 FOR UPDATE`, t.ID)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	raw, _ := json.Marshal(in)
	hash := sha256.Sum256(raw)
	var prior []byte
	var actor string
	var result json.RawMessage
	err = tx.QueryRow(ctx, `SELECT actor_membership_id::text,request_hash,response FROM money_requests WHERE tenant_id=$1 AND request_id=$2`, t.ID, in.RequestID).Scan(&actor, &prior, &result)
	if err == nil {
		if actor != a.MembershipID || !bytes.Equal(prior, hash[:]) {
			writeJSON(w, 409, map[string]string{"error": "Этот номер операции уже использован с другими данными."})
			return
		}
		writeJSON(w, 200, result)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		app.financeFailure(w, err)
		return
	}
	at := time.Now()
	if in.OccurredAt != "" {
		at, err = time.Parse(time.RFC3339, in.OccurredAt)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": "Укажите дату операции."})
			return
		}
	}
	loc, err := time.LoadLocation(t.Timezone)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	id, err := app.moneyExecute(ctx, tx, a, in, at, at.In(loc).Format("2006-01-02"))
	if err != nil {
		status := 400
		if errors.Is(err, errMoneyPermission) {
			status = 403
		}
		var conflict moneyConflict
		if errors.As(err, &conflict) {
			status = 409
		}
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 404, map[string]string{"error": "Запись не найдена в этой компании."})
			return
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if pgErr.Code == "23505" {
				writeJSON(w, 409, map[string]string{"error": "Такая операция или исторический курс уже записаны."})
			} else if strings.HasPrefix(pgErr.Code, "22") {
				writeJSON(w, 400, map[string]string{"error": "Проверьте данные операции."})
			} else {
				app.financeFailure(w, err)
			}
			return
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	result, _ = json.Marshal(map[string]string{"id": id})
	_, err = tx.Exec(ctx, `INSERT INTO money_requests(tenant_id,request_id,actor_membership_id,request_hash,response) VALUES($1,$2,$3,$4,$5)`, t.ID, in.RequestID, a.MembershipID, hash[:], result)
	if err == nil {
		details, _ := json.Marshal(map[string]any{"action": in.Action, "amountMinor": in.Amount, "currency": in.Currency, "bookingId": in.BookingID, "tripId": in.TripID, "accountId": in.AccountID, "recipientAccountId": in.RecipientAccountID, "description": in.Description, "targetAmountMinor": in.TargetAmount, "targetCurrency": in.TargetCurrency, "rate": in.Rate, "occurredAt": at})
		_, err = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,$2,'human',$3,'finance',$4,$5)`, t.ID, a.MembershipID, "finance.money_"+in.Action, id, details)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	financeAuditDone(r)
	writeJSON(w, 200, result)
}

func (app *application) moneyExecute(ctx context.Context, tx pgx.Tx, a identity, in moneyCommand, at time.Time, date string) (string, error) {
	if len(in.Description) > 1000 {
		return "", errors.New("Комментарий не должен превышать 1000 символов.")
	}
	if in.TripID != "" {
		if !validUUID(in.TripID) {
			return "", errors.New("Выберите рейс.")
		}
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM trips WHERE tenant_id=$1 AND id=$2)`, a.TenantID, in.TripID).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return "", pgx.ErrNoRows
		}
	}
	if in.Action == "rate" {
		if !moneyManager(a) {
			return "", errMoneyPermission
		}
		if !validBookingCurrency(in.Currency) || len(strings.TrimSpace(in.Description)) < 3 {
			return "", errors.New("Укажите валюту и причину исторического курса.")
		}
		if _, err := time.Parse("2006-01-02", in.Date); err != nil {
			return "", err
		}
		if _, err := moneyRound(100, in.RateToUAH); err != nil {
			return "", err
		}
		_, err := tx.Exec(ctx, `INSERT INTO money_rate_history(tenant_id,rate_date,currency,rate_to_uah,source,description,actor_membership_id) VALUES($1,$2::date,$3,$4::numeric,'manual',$5,$6)`, a.TenantID, in.Date, in.Currency, in.RateToUAH, in.Description, a.MembershipID)
		return a.TenantID, err
	}
	if in.Action == "receive" {
		return app.moneyCollect(ctx, tx, a, in, at, date)
	}
	if in.Action == "accept" || in.Action == "reject" || in.Action == "cancel" {
		var from, to, status string
		var n int64
		err := tx.QueryRow(ctx, `SELECT account_id::text,recipient_account_id::text,status,amount_minor FROM money_transfers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, a.TenantID, in.ID).Scan(&from, &to, &status, &n)
		if err != nil {
			return "", err
		}
		if status != "pending" {
			return "", moneyConflict("Передача уже обработана.")
		}
		source, err := moneyWalletLoad(ctx, tx, a.TenantID, from)
		if err != nil {
			return "", err
		}
		dest, err := moneyWalletLoad(ctx, tx, a.TenantID, to)
		if err != nil {
			return "", err
		}
		if in.Action == "cancel" {
			if !moneySpend(a, source) {
				return "", errMoneyPermission
			}
		} else if !moneyReceive(a, dest) {
			return "", errMoneyPermission
		}
		status = map[string]string{"accept": "accepted", "reject": "rejected", "cancel": "cancelled"}[in.Action]
		if in.Action == "accept" {
			balance, err := moneyAccountAvailable(ctx, tx, a.TenantID, source.Kind, source.Owner, source.Currency)
			if err != nil {
				return "", err
			}
			if balance+n < n {
				return "", moneyConflict("Недостаточно денег у отправителя.")
			}
			if _, err = moneyPost(ctx, tx, a, "transfer", "transfer:"+in.ID, in.Description, "", "", at, map[string]int64{from: -n, to: n}); err != nil {
				return "", err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE money_transfers SET status=$3,resolved_by=$4,resolved_at=now() WHERE tenant_id=$1 AND id=$2`, a.TenantID, in.ID, status, a.MembershipID)
		return in.ID, err
	}
	if in.Action == "reverse" {
		return app.moneyReverse(ctx, tx, a, in, at)
	}
	if in.Amount <= 0 || in.Amount > 10_000_000_000 || !validBookingCurrency(in.Currency) {
		return "", errors.New("Укажите сумму и валюту.")
	}
	account := in.AccountID
	var err error
	if account == "" {
		account, err = moneyAccount(ctx, tx, a.TenantID, "member", a.MembershipID, in.Currency)
		if err != nil {
			return "", err
		}
	}
	source, err := moneyWalletLoad(ctx, tx, a.TenantID, account)
	if err != nil {
		return "", err
	}
	if source.Currency != in.Currency {
		return "", errors.New("Валюта кошелька не совпадает.")
	}
	if !moneySpend(a, source) {
		return "", errMoneyPermission
	}
	available, err := moneyAccountAvailable(ctx, tx, a.TenantID, source.Kind, source.Owner, source.Currency)
	if err != nil {
		return "", err
	}
	if available < in.Amount {
		return "", moneyConflict("Недостаточно доступных денег. Проверьте ожидающие передачи.")
	}
	switch in.Action {
	case "expense":
		if !moneyManager(a) {
			if in.TripID == "" {
				return "", errMoneyPermission
			}
			allowed, err := tripCrewCan(ctx, tx, a.TenantID, in.TripID, a.MembershipID, "collect")
			if err != nil {
				return "", err
			}
			if !allowed {
				return "", errMoneyPermission
			}
		}
		if in.TripID != "" {
			var exists bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM trips WHERE tenant_id=$1 AND id=$2)`, a.TenantID, in.TripID).Scan(&exists); err != nil {
				return "", err
			}
			if !exists {
				return "", pgx.ErrNoRows
			}
		}
		if !strings.Contains(" fuel driver_pay payroll_tax amortization marketing other wash tolls supplies staff_pay crew_pay ", " "+in.Category+" ") {
			return "", errors.New("Выберите категорию расхода.")
		}
		var legacy string
		err = tx.QueryRow(ctx, `INSERT INTO operational_expenses(tenant_id,trip_id,category,amount_minor,currency,description,occurred_at,actor_membership_id,payment_source,request_id,wallet_account_id) VALUES($1,NULLIF($2,'')::uuid,$3,$4,$5,$6,$7,$8,'cash',$9,$10) RETURNING id::text`, a.TenantID, in.TripID, in.Category, in.Amount, in.Currency, in.Description, at, a.MembershipID, in.RequestID, account).Scan(&legacy)
		if err != nil {
			return "", err
		}
		var id string
		err = tx.QueryRow(ctx, `SELECT id::text FROM money_journal WHERE tenant_id=$1 AND source_key=$2`, a.TenantID, "operational_expenses:"+legacy).Scan(&id)
		return id, err
	case "exchange":
		if !validBookingCurrency(in.TargetCurrency) || in.TargetCurrency == in.Currency || in.TargetAmount <= 0 || in.TargetAmount > 10_000_000_000 {
			return "", errors.New("Укажите обе фактические суммы обмена.")
		}
		target, err := moneyAccount(ctx, tx, a.TenantID, source.Kind, source.Owner, in.TargetCurrency)
		if err != nil {
			return "", err
		}
		one, err := moneyAccount(ctx, tx, a.TenantID, "system", a.TenantID, in.Currency)
		if err != nil {
			return "", err
		}
		two, err := moneyAccount(ctx, tx, a.TenantID, "system", a.TenantID, in.TargetCurrency)
		if err != nil {
			return "", err
		}
		return moneyPost(ctx, tx, a, "exchange", "command:"+in.RequestID, in.Description, in.TripID, "", at, map[string]int64{account: -in.Amount, one: in.Amount, target: in.TargetAmount, two: -in.TargetAmount})
	case "transfer", "deposit":
		target := in.RecipientAccountID
		if target == "" {
			kind, owner := "member", in.TargetMembershipID
			if in.TargetKind == "company" || in.Action == "deposit" {
				kind, owner = "company", a.TenantID
			}
			if owner == "" {
				return "", errors.New("Выберите получателя.")
			}
			target, err = moneyAccount(ctx, tx, a.TenantID, kind, owner, in.Currency)
			if err != nil {
				return "", err
			}
		}
		dest, err := moneyWalletLoad(ctx, tx, a.TenantID, target)
		if err != nil {
			return "", err
		}
		if dest.Currency != in.Currency || target == account || dest.Kind == "system" {
			return "", errors.New("Проверьте кошелек получателя.")
		}
		if dest.Kind == "member" {
			var active bool
			err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.id=$2 AND m.is_active AND NOT u.is_system)`, a.TenantID, dest.Owner).Scan(&active)
			if err != nil {
				return "", err
			}
			if !active {
				return "", errors.New("Получатель больше не имеет доступа к компании.")
			}
		}
		if in.Action == "deposit" {
			if !moneyOwner(a) || source.Kind != "member" || source.Owner != a.MembershipID || dest.Kind != "company" {
				return "", errMoneyPermission
			}
			return moneyPost(ctx, tx, a, "transfer", "command:"+in.RequestID, in.Description, in.TripID, "", at, map[string]int64{account: -in.Amount, target: in.Amount})
		}
		var id string
		err = tx.QueryRow(ctx, `INSERT INTO money_transfers(tenant_id,account_id,recipient_account_id,currency,amount_minor,requested_by,description,trip_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::uuid,$9) RETURNING id::text`, a.TenantID, account, target, in.Currency, in.Amount, a.MembershipID, in.Description, in.TripID, at).Scan(&id)
		if err == nil {
			body := fmt.Sprintf("Ожидает подтверждения: %d,%02d %s.", in.Amount/100, in.Amount%100, in.Currency)
			_, err = tx.Exec(ctx, `INSERT INTO app_notifications(membership_id,category,title,body,url,event_type)
 SELECT m.id,'payments','Передача денег',$3,
 CASE WHEN m.role::text IN ('owner','admin','developer','accountant') THEN '/finance' ELSE '/driver?tab=money' END,
 'paymentChanged' FROM memberships m LEFT JOIN notification_preferences p ON p.membership_id=m.id
 WHERE m.tenant_id=$1 AND m.is_active AND (($2='member' AND m.id=$4::uuid) OR ($2='company' AND m.role::text IN ('owner','developer')))
 AND coalesce((p.categories->>'payments')::boolean,true)`, a.TenantID, dest.Kind, body, dest.Owner)
		}
		return id, err
	}
	return "", errors.New("Неизвестная операция.")
}

func (app *application) moneyCollect(ctx context.Context, tx pgx.Tx, a identity, in moneyCommand, at time.Time, date string) (string, error) {
	if !validUUID(in.BookingID) || in.Amount <= 0 || in.Amount > 10_000_000_000 || !validBookingCurrency(in.Currency) {
		return "", errors.New("Проверьте бронирование, сумму и валюту.")
	}
	var trip, currency, phase string
	var price, cash, bank int64
	err := tx.QueryRow(ctx, `SELECT b.trip_id::text,b.currency,b.price_minor,workflow_status_phase(b.tenant_id,'bookings',b.status),coalesce(c.cash_minor,0),coalesce((SELECT sum(p.amount_minor) FROM payments p WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='paid' AND p.currency=b.currency),0) FROM bookings b LEFT JOIN driver_booking_checkins c ON c.tenant_id=b.tenant_id AND c.booking_id=b.id WHERE b.tenant_id=$1 AND b.id=$2 FOR UPDATE OF b`, a.TenantID, in.BookingID).Scan(&trip, &currency, &price, &phase, &cash, &bank)
	if err != nil {
		return "", err
	}
	if phase == "cancelled" {
		return "", moneyConflict("Нельзя принять оплату отмененного бронирования.")
	}
	if !moneyManager(a) {
		allowed, err := tripCrewCan(ctx, tx, a.TenantID, trip, a.MembershipID, "collect")
		if err != nil {
			return "", err
		}
		if !allowed {
			return "", errMoneyPermission
		}
	}
	var pending bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM payments WHERE tenant_id=$1 AND booking_id=$2 AND status IN ('pending','authorized'))`, a.TenantID, in.BookingID).Scan(&pending)
	if err != nil {
		return "", err
	}
	if pending {
		return "", moneyConflict("Сначала отмените или завершите ожидающую банковскую оплату.")
	}
	rate, rateErr := moneyRate(ctx, tx, a.TenantID, in.Currency, currency, date)
	if in.Rate != "" && in.Rate != rate {
		if !moneyManager(a) || len(strings.TrimSpace(in.Description)) < 3 {
			return "", errors.New("Для своего курса нужны права администратора и причина.")
		}
		rate = in.Rate
		rateErr = nil
	}
	if rateErr != nil {
		return "", errors.New("Нет исторического курса. Добавьте курс на дату операции с причиной.")
	}
	settled, err := moneyRound(in.Amount, rate)
	if err != nil {
		return "", err
	}
	if settled <= 0 || settled > price-cash-bank {
		return "", moneyConflict("Сумма превышает остаток по бронированию.")
	}
	account, err := moneyAccount(ctx, tx, a.TenantID, "member", a.MembershipID, in.Currency)
	if err != nil {
		return "", err
	}
	var legacy, id string
	err = tx.QueryRow(ctx, `INSERT INTO driver_cash_ledger(tenant_id,collector_membership_id,trip_id,amount_minor,currency,kind,occurred_at,actor_membership_id,description,request_id,source_key) VALUES($1,$2,$3,$4,$5,'cash_collected',$6,$2,$7,$8,$9) RETURNING id::text`, a.TenantID, a.MembershipID, trip, in.Amount, in.Currency, at, in.Description, in.RequestID, "money:"+in.RequestID).Scan(&legacy)
	if err != nil {
		return "", err
	}
	err = tx.QueryRow(ctx, `SELECT id::text FROM money_journal WHERE tenant_id=$1 AND source_key=$2`, a.TenantID, "driver_cash_ledger:"+legacy).Scan(&id)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO money_receipts(tenant_id,journal_id,booking_id,account_id,currency,amount_minor,booking_currency,settled_minor,rate) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric)`, a.TenantID, id, in.BookingID, account, in.Currency, in.Amount, currency, settled, rate)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO driver_booking_checkins(tenant_id,booking_id,cash_minor,actor_membership_id) VALUES($1,$2,$3,$4) ON CONFLICT(booking_id) DO UPDATE SET cash_minor=driver_booking_checkins.cash_minor+EXCLUDED.cash_minor,actor_membership_id=EXCLUDED.actor_membership_id,updated_at=now()`, a.TenantID, in.BookingID, settled, a.MembershipID)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `WITH corrected AS (UPDATE bookings SET status='confirmed',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='cash_on_boarding' AND price_minor<=$3 RETURNING id)
 INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) SELECT $1,$4,'human','record_updated','bookings',id,'{"changes":[{"field":"status","before":"cash_on_boarding","after":"confirmed"}]}'::jsonb FROM corrected`, a.TenantID, in.BookingID, cash+bank+settled, a.MembershipID)
	}
	return id, err
}

func (app *application) moneyReverse(ctx context.Context, tx pgx.Tx, a identity, in moneyCommand, at time.Time) (string, error) {
	if !moneyManager(a) {
		return "", errMoneyPermission
	}
	if len(strings.TrimSpace(in.Description)) < 3 {
		return "", errors.New("Укажите причину отмены операции.")
	}
	var kind string
	var reversed bool
	err := tx.QueryRow(ctx, `SELECT kind,EXISTS(SELECT 1 FROM money_reversals WHERE tenant_id=$1 AND journal_id=$2) FROM money_journal WHERE tenant_id=$1 AND id=$2`, a.TenantID, in.ID).Scan(&kind, &reversed)
	if err != nil {
		return "", err
	}
	if reversed || kind != "receipt" && kind != "expense" && kind != "exchange" {
		return "", moneyConflict("Эту операцию нельзя сторнировать.")
	}
	if kind == "expense" {
		var payroll bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM money_journal j JOIN operational_expenses e ON e.tenant_id=j.tenant_id AND j.source_key='operational_expenses:'||e.id::text WHERE j.tenant_id=$1 AND j.id=$2 AND (EXISTS(SELECT 1 FROM driver_payroll_accruals d WHERE d.tenant_id=e.tenant_id AND d.expense_id=e.id) OR EXISTS(SELECT 1 FROM crew_payroll_accruals c WHERE c.tenant_id=e.tenant_id AND c.expense_id=e.id)))`, a.TenantID, in.ID).Scan(&payroll)
		if err != nil {
			return "", err
		}
		if payroll {
			return "", errors.New("Начисление зарплаты требует отдельной корректировки расчета с сотрудником.")
		}
	}
	rows, err := tx.Query(ctx, `SELECT p.account_id::text,p.amount_minor,a.owner_type,a.owner_id::text,a.currency FROM money_postings p JOIN money_accounts a ON a.id=p.account_id AND a.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.journal_id=$2`, a.TenantID, in.ID)
	if err != nil {
		return "", err
	}
	entries := map[string]int64{}
	wallets := map[string]moneyWallet{}
	for rows.Next() {
		var id, kind, owner, c string
		var n int64
		if err = rows.Scan(&id, &n, &kind, &owner, &c); err != nil {
			rows.Close()
			return "", err
		}
		entries[id] -= n
		wallets[id] = moneyWallet{id, kind, owner, c}
	}
	rows.Close()
	for id, n := range entries {
		w := wallets[id]
		if n < 0 && w.Kind != "system" {
			balance, err := moneyAccountAvailable(ctx, tx, a.TenantID, w.Kind, w.Owner, w.Currency)
			if err != nil {
				return "", err
			}
			if balance < -n {
				return "", moneyConflict("Для сторно недостаточно свободных денег в исходном кошельке.")
			}
		}
	}
	id, err := moneyPost(ctx, tx, a, "reversal", "command:"+in.RequestID, in.Description, "", "", at, entries)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO money_reversals(tenant_id,journal_id,reversal_id) VALUES($1,$2,$3)`, a.TenantID, in.ID, id)
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE driver_booking_checkins c SET cash_minor=c.cash_minor-r.settled_minor,actor_membership_id=$3,updated_at=now() FROM money_receipts r WHERE r.tenant_id=$1 AND r.journal_id=$2 AND c.tenant_id=r.tenant_id AND c.booking_id=r.booking_id`, a.TenantID, in.ID, a.MembershipID)
	}
	return id, err
}
