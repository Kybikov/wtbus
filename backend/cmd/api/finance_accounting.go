package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (app *application) financeFailure(w http.ResponseWriter, err error) {
	app.log.Error("finance operation", "error", err)
	writeJSON(w, 503, map[string]string{"error": "Не удалось выполнить финансовую операцию. Повторите попытку."})
}

// Cash is an asset, separate from earned revenue and payroll accruals.
func companyCash(ctx context.Context, tx pgx.Tx, tenantID, currency string) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx, `SELECT
 coalesce((SELECT sum(amount_minor) FROM company_cash_receipts WHERE tenant_id=$1 AND currency=$2),0)
 +coalesce((SELECT sum(amount_minor) FROM driver_cash_ledger WHERE tenant_id=$1 AND currency=$2 AND kind='collection'),0)
 -coalesce((SELECT sum(amount_minor) FROM operational_expenses WHERE tenant_id=$1 AND currency=$2 AND payment_source='cash'),0)
 -coalesce((SELECT sum(amount_minor) FROM driver_payroll_payouts WHERE tenant_id=$1 AND currency=$2 AND payment_source='cash'),0)
 -coalesce((SELECT sum(amount_minor) FROM finance_tax_payments WHERE tenant_id=$1 AND currency=$2 AND payment_source='cash'),0)`, tenantID, currency).Scan(&balance)
	return balance, err
}

type accountingSettings struct {
	Turnover int `json:"turnoverTaxBps"`
	payrollRates
}

func (app *application) accountingReport(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	location, err := time.LoadLocation(tenant.Timezone)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	from, to, ok := financeRange(w, r, location)
	if !ok {
		return
	}
	var categories, daily json.RawMessage
	err = app.db.QueryRow(r.Context(), `SELECT coalesce(jsonb_agg(jsonb_build_object('category',category,'currency',currency,'amountMinor',amount) ORDER BY amount DESC),'[]') FROM (SELECT category,currency,sum(amount_minor)::bigint amount FROM operational_expenses WHERE tenant_id=$1 AND occurred_at>=$2 AND occurred_at<$3 GROUP BY category,currency)s`, tenant.ID, from, to).Scan(&categories)
	if err == nil {
		err = app.db.QueryRow(r.Context(), `SELECT coalesce(jsonb_agg(jsonb_build_object('date',expense_day,'currency',currency,'amountMinor',amount) ORDER BY expense_day),'[]') FROM (SELECT (occurred_at AT TIME ZONE $4)::date AS expense_day,currency,sum(amount_minor)::bigint amount FROM operational_expenses WHERE tenant_id=$1 AND occurred_at>=$2 AND occurred_at<$3 GROUP BY expense_day,currency)s`, tenant.ID, from, to, tenant.Timezone).Scan(&daily)
	}
	var turnover int
	if err == nil {
		rateErr := app.db.QueryRow(r.Context(), `SELECT turnover_tax_bps FROM finance_settings WHERE tenant_id=$1`, tenant.ID).Scan(&turnover)
		if rateErr != nil && !errors.Is(rateErr, pgx.ErrNoRows) {
			err = rateErr
		}
	}
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"categories": categories, "dailyExpenses": daily, "turnoverTaxBps": turnover})
}

func (app *application) accountingSettings(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	actor, _ := identityFromContext(r.Context())
	if r.Method == "GET" {
		settings := accountingSettings{}
		err := app.db.QueryRow(r.Context(), `SELECT turnover_tax_bps,income_tax_bps,levy_tax_bps,employer_tax_bps FROM finance_settings WHERE tenant_id=$1`, tenant.ID).Scan(&settings.Turnover, &settings.Income, &settings.Levy, &settings.Employer)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			app.financeFailure(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"item": settings})
		return
	}
	var input accountingSettings
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || input.Turnover < 0 || input.Turnover > 10000 || !validPayrollRates(input.payrollRates) {
		writeJSON(w, 400, map[string]string{"error": "Проверьте ставки: от 0 до 100%, сумма удержаний не больше 100%."})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `INSERT INTO finance_settings(tenant_id,turnover_tax_bps,income_tax_bps,levy_tax_bps,employer_tax_bps,updated_by) VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::uuid) ON CONFLICT(tenant_id) DO UPDATE SET turnover_tax_bps=$2,income_tax_bps=$3,levy_tax_bps=$4,employer_tax_bps=$5,updated_by=NULLIF($6,'')::uuid,updated_at=now()`, tenant.ID, input.Turnover, input.Income, input.Levy, input.Employer, actor.MembershipID)
	if err == nil {
		err = writeFinanceActivity(r.Context(), tx, actor, "finance.settings_changed", tenant.ID, input)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	financeAuditDone(r)
	writeJSON(w, 200, map[string]any{"item": input})
}

func (app *application) ownFinanceDriver(r *http.Request, tenantID string) (string, error) {
	actor, _ := identityFromContext(r.Context())
	var id string
	err := app.db.QueryRow(r.Context(), `SELECT id::text FROM drivers WHERE tenant_id=$1 AND membership_id=$2`, tenantID, actor.MembershipID).Scan(&id)
	return id, err
}

func (app *application) accountingSnapshot(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	driverID := ""
	if strings.HasSuffix(r.URL.Path, "/driver/wallet") {
		var err error
		driverID, err = app.ownFinanceDriver(r, tenant.ID)
		if err != nil {
			writeJSON(w, 404, map[string]string{"error": "Профиль водителя не подключён к вашему аккаунту."})
			return
		}
	}
	// Current liabilities always include the complete history, independent of report dates.
	rows, err := app.db.Query(r.Context(), `WITH currencies AS (
 SELECT driver_id,currency FROM driver_cash_ledger WHERE tenant_id=$1
 UNION SELECT driver_id,currency FROM driver_payroll_accruals WHERE tenant_id=$1
 UNION SELECT driver_id,currency FROM driver_payroll_payouts WHERE tenant_id=$1
 ), balances AS (SELECT c.driver_id,c.currency,
 coalesce((SELECT sum(CASE WHEN kind='cash_collected' THEN amount_minor ELSE -amount_minor END) FROM driver_cash_ledger WHERE tenant_id=$1 AND driver_id=c.driver_id AND currency=c.currency),0)::bigint cash,
 coalesce((SELECT sum(amount_minor) FROM driver_cash_handovers WHERE tenant_id=$1 AND driver_id=c.driver_id AND currency=c.currency AND status='pending'),0)::bigint pending,
 coalesce((SELECT sum(gross_minor) FROM driver_payroll_accruals WHERE tenant_id=$1 AND driver_id=c.driver_id AND currency=c.currency),0)::bigint gross,
 coalesce((SELECT sum(income_tax_minor+levy_tax_minor) FROM driver_payroll_accruals WHERE tenant_id=$1 AND driver_id=c.driver_id AND currency=c.currency),0)::bigint withheld,
 coalesce((SELECT sum(employer_tax_minor) FROM driver_payroll_accruals WHERE tenant_id=$1 AND driver_id=c.driver_id AND currency=c.currency),0)::bigint employer,
 coalesce((SELECT sum(amount_minor) FROM driver_payroll_payouts WHERE tenant_id=$1 AND driver_id=c.driver_id AND currency=c.currency),0)::bigint paid
 FROM currencies c)
 SELECT jsonb_build_object('driverId',d.id,'driverName',d.full_name,'connected',d.membership_id IS NOT NULL,'currency',b.currency,'cashMinor',cash,'pendingMinor',pending,'grossMinor',gross,'withheldMinor',withheld,'employerMinor',employer,'paidMinor',paid,'payableMinor',gross-withheld-paid,'taxDueMinor',jsonb_build_object(
 'income',coalesce((SELECT sum(income_tax_minor) FROM driver_payroll_accruals WHERE tenant_id=$1 AND driver_id=b.driver_id AND currency=b.currency),0)-coalesce((SELECT sum(amount_minor) FROM finance_tax_payments WHERE tenant_id=$1 AND driver_id=b.driver_id AND currency=b.currency AND tax_kind='income'),0),
 'levy',coalesce((SELECT sum(levy_tax_minor) FROM driver_payroll_accruals WHERE tenant_id=$1 AND driver_id=b.driver_id AND currency=b.currency),0)-coalesce((SELECT sum(amount_minor) FROM finance_tax_payments WHERE tenant_id=$1 AND driver_id=b.driver_id AND currency=b.currency AND tax_kind='levy'),0),
 'employer',employer-coalesce((SELECT sum(amount_minor) FROM finance_tax_payments WHERE tenant_id=$1 AND driver_id=b.driver_id AND currency=b.currency AND tax_kind='employer'),0)))
 FROM balances b JOIN drivers d ON d.id=b.driver_id AND d.tenant_id=$1 WHERE ($2='' OR d.id::text=$2) ORDER BY d.full_name,b.currency`, tenant.ID, driverID)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	balances := []json.RawMessage{}
	for rows.Next() {
		var raw json.RawMessage
		if err = rows.Scan(&raw); err != nil {
			break
		}
		balances = append(balances, raw)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	var handovers json.RawMessage
	err = app.db.QueryRow(r.Context(), `SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC),'[]') FROM (SELECT h.created_at,jsonb_build_object('id',h.id,'driverId',h.driver_id,'driverName',d.full_name,'amountMinor',h.amount_minor,'currency',h.currency,'status',h.status,'description',h.description,'createdAt',h.created_at,'resolvedAt',h.resolved_at) item FROM driver_cash_handovers h JOIN drivers d ON d.id=h.driver_id AND d.tenant_id=h.tenant_id WHERE h.tenant_id=$1 AND ($2='' OR h.driver_id::text=$2) ORDER BY h.created_at DESC) s`, tenant.ID, driverID).Scan(&handovers)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	result := map[string]any{"balances": balances, "handovers": handovers, "driverId": driverID, "currency": tenant.BaseCurrency}
	if driverID == "" {
		var allDrivers json.RawMessage
		err = app.db.QueryRow(r.Context(), `SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'connected',membership_id IS NOT NULL,'active',is_active) ORDER BY full_name),'[]') FROM drivers WHERE tenant_id=$1`, tenant.ID).Scan(&allDrivers)
		if err != nil {
			app.financeFailure(w, err)
			return
		}
		result["drivers"] = allDrivers
		tx, err := app.db.Begin(r.Context())
		if err != nil {
			app.financeFailure(w, err)
			return
		}
		defer tx.Rollback(r.Context())
		cash := []moneyBalance{}
		for _, currency := range []string{"UAH", "EUR", "USD", "PLN"} {
			amount, err := companyCash(r.Context(), tx, tenant.ID, currency)
			if err != nil {
				app.financeFailure(w, err)
				return
			}
			cash = append(cash, moneyBalance{currency, amount})
		}
		result["companyCash"] = cash
		var bank json.RawMessage
		err = tx.QueryRow(r.Context(), `SELECT jsonb_build_object('lastSync',statement_synced_at,'balanceMinor',bank_balance_minor,'balanceAt',bank_balance_at,'lastError',last_error) FROM payment_reconciliation_state WHERE tenant_id=$1`, tenant.ID).Scan(&bank)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			app.financeFailure(w, err)
			return
		}
		result["bank"] = bank
	}
	writeJSON(w, 200, result)
}

type accountingOperation struct {
	Action      string `json:"action"`
	RequestID   string `json:"requestId"`
	DriverID    string `json:"driverId"`
	Amount      int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
	Source      string `json:"paymentSource"`
	Description string `json:"description"`
	Category    string `json:"category"`
	ID          string `json:"id"`
}

func (app *application) accountingOperation(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	actor, _ := identityFromContext(r.Context())
	var input accountingOperation
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	dec.DisallowUnknownFields()
	if dec.Decode(&input) != nil {
		writeJSON(w, 400, map[string]string{"error": "Проверьте данные операции."})
		return
	}
	input.Description = strings.TrimSpace(input.Description)
	input.Currency = normalizedFinanceCurrency(input.Currency, "UAH")
	own := strings.HasSuffix(r.URL.Path, "/driver/handovers")
	if own {
		id, err := app.ownFinanceDriver(r, tenant.ID)
		if err != nil {
			writeJSON(w, 403, map[string]string{"error": "Профиль водителя не подключён."})
			return
		}
		input.DriverID = id
		if input.Action != "request_handover" && input.Action != "cancel_handover" {
			writeJSON(w, 403, map[string]string{"error": "Водитель может только передать свои наличные."})
			return
		}
	}
	resolving := input.Action == "accept_handover" || input.Action == "reject_handover" || input.Action == "cancel_handover"
	if len([]rune(input.Description)) > 500 || (!resolving && (!validUUID(input.RequestID) || input.Amount < 1 || input.Amount > 1_000_000_000 || !validBookingCurrency(input.Currency))) || (resolving && !validUUID(input.ID)) || (input.DriverID != "" && !validUUID(input.DriverID)) {
		writeJSON(w, 400, map[string]string{"error": "Укажите корректную сумму, валюту и водителя."})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// All company money movements use the same lock order: company, then driver.
	if _, err = tx.Exec(r.Context(), `SELECT id FROM tenants WHERE id=$1 FOR UPDATE`, tenant.ID); err != nil {
		app.financeFailure(w, err)
		return
	}
	if !resolving {
		var previous json.RawMessage
		err = tx.QueryRow(r.Context(), `SELECT payload FROM finance_operation_requests WHERE tenant_id=$1 AND request_id=$2`, tenant.ID, input.RequestID).Scan(&previous)
		if err == nil {
			var saved struct {
				Input accountingOperation `json:"input"`
				ID    string              `json:"id"`
			}
			if json.Unmarshal(previous, &saved) != nil || saved.Input != input {
				writeJSON(w, 409, map[string]string{"error": "Эта операция уже записана с другими данными."})
				return
			}
			writeJSON(w, 200, map[string]string{"id": saved.ID})
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			app.financeFailure(w, err)
			return
		}
	}
	id := ""
	if resolving {
		var driver, status, currency string
		var amount int64
		err = tx.QueryRow(r.Context(), `SELECT driver_id::text,status,currency,amount_minor FROM driver_cash_handovers WHERE tenant_id=$1 AND id=$2`, tenant.ID, input.ID).Scan(&driver, &status, &currency, &amount)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 404, map[string]string{"error": "Передача не найдена."})
			return
		}
		if err != nil {
			app.financeFailure(w, err)
			return
		}
		if own && driver != input.DriverID {
			writeJSON(w, 403, map[string]string{"error": "Это передача другого водителя."})
			return
		}
		target := map[string]string{"accept_handover": "accepted", "reject_handover": "rejected", "cancel_handover": "cancelled"}[input.Action]
		if status == target {
			writeJSON(w, 200, map[string]string{"id": input.ID})
			return
		}
		if status != "pending" {
			writeJSON(w, 409, map[string]string{"error": "Передача уже обработана. Обновите список."})
			return
		}
		_, err = tx.Exec(r.Context(), `SELECT id FROM drivers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant.ID, driver)
		if err == nil && target == "accepted" {
			var available int64
			err = tx.QueryRow(r.Context(), `SELECT coalesce(sum(CASE WHEN kind='cash_collected' THEN amount_minor ELSE -amount_minor END),0) FROM driver_cash_ledger WHERE tenant_id=$1 AND driver_id=$2 AND currency=$3`, tenant.ID, driver, currency).Scan(&available)
			if err == nil && amount > available {
				writeJSON(w, 409, map[string]string{"error": "У водителя недостаточно наличных. Проверьте остаток."})
				return
			}
			if err == nil {
				_, err = tx.Exec(r.Context(), `INSERT INTO driver_cash_ledger(tenant_id,driver_id,amount_minor,currency,kind,actor_membership_id,description,handover_id) VALUES($1,$2,$3,$4,'collection',NULLIF($5,'')::uuid,'Передача наличных в кассу',$6)`, tenant.ID, driver, amount, currency, actor.MembershipID, input.ID)
			}
		}
		if err == nil {
			_, err = tx.Exec(r.Context(), `UPDATE driver_cash_handovers SET status=$3,resolved_by=NULLIF($4,'')::uuid,resolved_at=now() WHERE tenant_id=$1 AND id=$2`, tenant.ID, input.ID, target, actor.MembershipID)
		}
		input.DriverID = driver
		input.Currency = currency
		input.Amount = amount
		id = input.ID
	} else {
		if input.DriverID != "" {
			var exists string
			err = tx.QueryRow(r.Context(), `SELECT id::text FROM drivers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant.ID, input.DriverID).Scan(&exists)
			if errors.Is(err, pgx.ErrNoRows) {
				writeJSON(w, 404, map[string]string{"error": "Водитель не найден."})
				return
			}
			if err != nil {
				app.financeFailure(w, err)
				return
			}
		}
		if input.Source == "cash" && (input.Action == "payout" || input.Action == "expense" || input.Action == "tax_payment") {
			available, e := companyCash(r.Context(), tx, tenant.ID, input.Currency)
			if e != nil {
				app.financeFailure(w, e)
				return
			}
			if input.Amount > available {
				writeJSON(w, 409, map[string]string{"error": "В кассе недостаточно средств в этой валюте."})
				return
			}
		}
		switch input.Action {
		case "receipt":
			if input.Description == "" || (input.Category != "income" && input.Category != "funding") {
				writeJSON(w, 400, map[string]string{"error": "Укажите назначение и вид поступления."})
				return
			}
			err = tx.QueryRow(r.Context(), `INSERT INTO company_cash_receipts(tenant_id,amount_minor,currency,description,kind,actor_membership_id,request_id) VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::uuid,$7) RETURNING id::text`, tenant.ID, input.Amount, input.Currency, input.Description, input.Category, actor.MembershipID, input.RequestID).Scan(&id)
		case "expense":
			if !validExpenseCategory(input.Category) || input.Category == "driver_pay" || input.Category == "payroll_tax" || (input.Source != "bank" && input.Source != "cash") || input.Description == "" {
				writeJSON(w, 400, map[string]string{"error": "Выберите категорию, счёт списания и назначение расхода."})
				return
			}
			err = tx.QueryRow(r.Context(), `INSERT INTO operational_expenses(tenant_id,category,amount_minor,currency,description,payment_source,actor_membership_id,request_id) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,'')::uuid,$8) RETURNING id::text`, tenant.ID, input.Category, input.Amount, input.Currency, input.Description, input.Source, actor.MembershipID, input.RequestID).Scan(&id)
		case "accrual":
			if input.DriverID == "" {
				writeJSON(w, 400, map[string]string{"error": "Выберите водителя."})
				return
			}
			err = tx.QueryRow(r.Context(), `INSERT INTO operational_expenses(tenant_id,driver_id,category,amount_minor,currency,description,actor_membership_id,request_id) VALUES($1,$2,'driver_pay',$3,$4,$5,NULLIF($6,'')::uuid,$7) RETURNING id::text`, tenant.ID, input.DriverID, input.Amount, input.Currency, input.Description, actor.MembershipID, input.RequestID).Scan(&id)
			if err == nil {
				err = app.ensurePayrollAccrual(r.Context(), tx, tenant.ID, id)
			}
		case "tax_payment":
			if input.DriverID == "" || (input.Source != "cash" && input.Source != "bank") || (input.Category != "income" && input.Category != "levy" && input.Category != "employer") {
				writeJSON(w, 400, map[string]string{"error": "Выберите водителя, вид начисления и счёт списания."})
				return
			}
			var due int64
			err = tx.QueryRow(r.Context(), "SELECT coalesce((SELECT sum(CASE $4 WHEN 'income' THEN income_tax_minor WHEN 'levy' THEN levy_tax_minor ELSE employer_tax_minor END) FROM driver_payroll_accruals WHERE tenant_id=$1 AND driver_id=$2 AND currency=$3),0)-coalesce((SELECT sum(amount_minor) FROM finance_tax_payments WHERE tenant_id=$1 AND driver_id=$2 AND currency=$3 AND tax_kind=$4),0)", tenant.ID, input.DriverID, input.Currency, input.Category).Scan(&due)
			if err == nil && input.Amount > due {
				writeJSON(w, 409, map[string]string{"error": "Сумма превышает остаток начислений к перечислению."})
				return
			}
			if err == nil {
				err = tx.QueryRow(r.Context(), "INSERT INTO finance_tax_payments(tenant_id,driver_id,tax_kind,amount_minor,currency,payment_source,description,actor_membership_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::uuid,$9) RETURNING id::text", tenant.ID, input.DriverID, input.Category, input.Amount, input.Currency, input.Source, input.Description, actor.MembershipID, input.RequestID).Scan(&id)
			}
		case "payout":
			if input.DriverID == "" || (input.Source != "bank" && input.Source != "cash") {
				writeJSON(w, 400, map[string]string{"error": "Выберите водителя и способ выплаты."})
				return
			}
			_, err = app.finalizeDriverPayroll(r.Context(), tx, tenant.ID, input.DriverID)
			var payable int64
			if err == nil {
				err = tx.QueryRow(r.Context(), `SELECT coalesce((SELECT sum(gross_minor-income_tax_minor-levy_tax_minor) FROM driver_payroll_accruals WHERE tenant_id=$1 AND driver_id=$2 AND currency=$3),0)-coalesce((SELECT sum(amount_minor) FROM driver_payroll_payouts WHERE tenant_id=$1 AND driver_id=$2 AND currency=$3),0)`, tenant.ID, input.DriverID, input.Currency).Scan(&payable)
			}
			if err == nil && input.Amount > payable {
				writeJSON(w, 409, map[string]string{"error": "Сумма превышает начисленную зарплату к выплате."})
				return
			}
			if err == nil {
				err = tx.QueryRow(r.Context(), `INSERT INTO driver_payroll_payouts(tenant_id,driver_id,amount_minor,currency,payment_source,description,actor_membership_id,request_id) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,'')::uuid,$8) RETURNING id::text`, tenant.ID, input.DriverID, input.Amount, input.Currency, input.Source, input.Description, actor.MembershipID, input.RequestID).Scan(&id)
			}
		case "request_handover":
			if input.DriverID == "" {
				writeJSON(w, 400, map[string]string{"error": "Выберите водителя."})
				return
			}
			var available int64
			err = tx.QueryRow(r.Context(), `SELECT coalesce((SELECT sum(CASE WHEN kind='cash_collected' THEN amount_minor ELSE -amount_minor END) FROM driver_cash_ledger WHERE tenant_id=$1 AND driver_id=$2 AND currency=$3),0)-coalesce((SELECT sum(amount_minor) FROM driver_cash_handovers WHERE tenant_id=$1 AND driver_id=$2 AND currency=$3 AND status='pending'),0)`, tenant.ID, input.DriverID, input.Currency).Scan(&available)
			if err == nil && input.Amount > available {
				writeJSON(w, 409, map[string]string{"error": "Сумма превышает свободный остаток водителя. Проверьте ожидающие передачи."})
				return
			}
			if err == nil {
				err = tx.QueryRow(r.Context(), `INSERT INTO driver_cash_handovers(tenant_id,driver_id,amount_minor,currency,description,requested_by,request_id) VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::uuid,$7) RETURNING id::text`, tenant.ID, input.DriverID, input.Amount, input.Currency, input.Description, actor.MembershipID, input.RequestID).Scan(&id)
			}
		default:
			writeJSON(w, 400, map[string]string{"error": "Неизвестная операция."})
			return
		}
	}
	if err == nil {
		err = writeFinanceActivity(r.Context(), tx, actor, "finance."+input.Action, id, input)
	}
	if err == nil && !resolving {
		payload, _ := json.Marshal(map[string]any{"input": input, "id": id})
		_, err = tx.Exec(r.Context(), `INSERT INTO finance_operation_requests(tenant_id,request_id,payload) VALUES($1,$2,$3)`, tenant.ID, input.RequestID, payload)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	financeAuditDone(r)
	writeJSON(w, 201, map[string]string{"id": id})
}

type ledgerCursor struct {
	At time.Time `json:"at"`
	ID string    `json:"id"`
}

func (app *application) accountingLedger(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	location, err := time.LoadLocation(tenant.Timezone)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	from, to, ok := financeRange(w, r, location)
	if !ok {
		return
	}
	q := r.URL.Query()
	cursor := ledgerCursor{At: to, ID: "~"}
	if encoded := q.Get("cursor"); encoded != "" {
		raw, e := base64.RawURLEncoding.DecodeString(encoded)
		if e != nil || json.Unmarshal(raw, &cursor) != nil || cursor.At.IsZero() || len(cursor.ID) > 80 {
			writeJSON(w, 400, map[string]string{"error": "Некорректная следующая страница."})
			return
		}
	}
	rows, err := app.db.Query(r.Context(), `SELECT jsonb_build_object('id',e.entry_id,'kind',e.kind,'category',e.category,'amountMinor',e.amount_minor,'currency',e.currency,'occurredAt',e.occurred_at,'description',e.description,'driverName',e.driver_name,'actorName',e.actor_name,'tripId',e.trip_id,'bookingId',e.booking_id,'paymentSource',e.payment_source,'isHold',e.is_hold,'reviewed',coalesce(m.reviewed,false),'note',coalesce(m.note,'')),e.occurred_at,e.entry_id
 FROM finance_ledger_entries e LEFT JOIN finance_review_marks m ON m.tenant_id=e.tenant_id AND m.entry_id=e.entry_id WHERE e.tenant_id=$1 AND e.occurred_at>=$2 AND e.occurred_at<$3 AND (e.occurred_at,e.entry_id)<($4,$5) AND ($6='' OR e.kind=$6) AND ($7='' OR e.currency=$7) AND ($8='' OR e.description ILIKE '%'||$8||'%' OR e.driver_name ILIKE '%'||$8||'%') ORDER BY e.occurred_at DESC,e.entry_id DESC LIMIT 51`, tenant.ID, from, to, cursor.At, cursor.ID, q.Get("kind"), q.Get("currency"), q.Get("search"))
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	defer rows.Close()
	items := []json.RawMessage{}
	last := ledgerCursor{}
	next := ""
	for rows.Next() {
		var raw json.RawMessage
		var c ledgerCursor
		if err = rows.Scan(&raw, &c.At, &c.ID); err != nil {
			break
		}
		if len(items) == 50 {
			encoded, _ := json.Marshal(last)
			next = base64.RawURLEncoding.EncodeToString(encoded)
			break
		}
		items = append(items, raw)
		last = c
	}
	if err == nil {
		err = rows.Err()
	}
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "nextCursor": next})
}

func (app *application) reviewFinanceEntry(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	actor, _ := identityFromContext(r.Context())
	var input struct {
		ID       string `json:"id"`
		Reviewed bool   `json:"reviewed"`
		Note     string `json:"note"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	dec.DisallowUnknownFields()
	if dec.Decode(&input) != nil || len(input.ID) > 80 || len([]rune(input.Note)) > 1000 {
		writeJSON(w, 400, map[string]string{"error": "Проверьте отметку и примечание."})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var exists bool
	err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM finance_ledger_entries WHERE tenant_id=$1 AND entry_id=$2)`, tenant.ID, input.ID).Scan(&exists)
	if err == nil && !exists {
		writeJSON(w, 404, map[string]string{"error": "Операция не найдена."})
		return
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO finance_review_marks(tenant_id,entry_id,reviewed,note,reviewed_by) VALUES($1,$2,$3,$4,NULLIF($5,'')::uuid) ON CONFLICT(tenant_id,entry_id) DO UPDATE SET reviewed=$3,note=$4,reviewed_by=NULLIF($5,'')::uuid,updated_at=now()`, tenant.ID, input.ID, input.Reviewed, input.Note, actor.MembershipID)
	}
	if err == nil {
		err = writeFinanceActivity(r.Context(), tx, actor, "finance.reviewed", input.ID, input)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	financeAuditDone(r)
	writeJSON(w, 200, map[string]bool{"ok": true})
}
