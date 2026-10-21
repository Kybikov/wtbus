package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

type moneyBalance struct {
	Currency     string `json:"currency"`
	BalanceMinor int64  `json:"balanceMinor"`
}
type financeDriver struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Phone     string `json:"phone"`
	Connected bool   `json:"connected"`
	Active    bool   `json:"active"`
}
type payrollRates struct {
	Income   int `json:"incomeTaxBps"`
	Levy     int `json:"levyTaxBps"`
	Employer int `json:"employerTaxBps"`
}
type payrollAmounts struct {
	Income   int64
	Levy     int64
	Employer int64
}

func validPayrollRates(r payrollRates) bool {
	return r.Income >= 0 && r.Levy >= 0 && r.Employer >= 0 && r.Income+r.Levy <= 10000 && r.Employer <= 10000
}
func calculatePayroll(gross int64, r payrollRates) (payrollAmounts, error) {
	if gross < 1 || gross > 10_000_000_000 || !validPayrollRates(r) {
		return payrollAmounts{}, errors.New("Некорректная сумма или налоговые ставки.")
	}
	round := func(bps int) int64 { return (gross*int64(bps) + 5000) / 10000 }
	result := payrollAmounts{Income: round(r.Income), Levy: round(r.Levy), Employer: round(r.Employer)}
	// A withholding can never exceed the gross amount, including a one-cent edge.
	if result.Income+result.Levy > gross {
		result.Levy = gross - result.Income
	}
	return result, nil
}

func (app *application) unlinkedDriverProfiles(ctx context.Context, tenantID string) ([]financeDriver, error) {
	rows, err := app.db.Query(ctx, `SELECT id::text,full_name,phone_e164,is_active FROM drivers WHERE tenant_id=$1 AND membership_id IS NULL ORDER BY full_name`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []financeDriver{}
	for rows.Next() {
		var d financeDriver
		if err = rows.Scan(&d.ID, &d.Name, &d.Phone, &d.Active); err != nil {
			return nil, err
		}
		result = append(result, d)
	}
	return result, rows.Err()
}
func (app *application) driverCashBalances(ctx context.Context, tenantID, driverID string) ([]driverCashBalance, error) {
	rows, err := app.db.Query(ctx, `SELECT d.id::text,d.full_name,l.currency,sum(CASE WHEN l.kind='cash_collected' THEN l.amount_minor ELSE -l.amount_minor END)::bigint
 FROM driver_cash_ledger l JOIN drivers d ON d.id=l.driver_id AND d.tenant_id=l.tenant_id WHERE l.tenant_id=$1 AND ($2='' OR d.id::text=$2) GROUP BY d.id,d.full_name,l.currency ORDER BY d.full_name,l.currency`, tenantID, driverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []driverCashBalance{}
	for rows.Next() {
		var b driverCashBalance
		if err = rows.Scan(&b.DriverID, &b.DriverName, &b.Currency, &b.BalanceMinor); err != nil {
			return nil, err
		}
		result = append(result, b)
	}
	return result, rows.Err()
}
func financeAuditDone(r *http.Request) {
	if state, ok := r.Context().Value(auditContextKey{}).(*auditCapture); ok {
		state.activityRecorded = true
	}
}
func writeFinanceActivity(ctx context.Context, tx pgx.Tx, actor identity, action, id string, details any) error {
	raw, err := json.Marshal(details)
	if err != nil {
		return err
	}
	var values map[string]any
	if err = json.Unmarshal(raw, &values); err != nil {
		return err
	}
	safe := map[string]any{}
	for _, key := range strings.Fields("amountMinor currency driverId tripId action category paymentSource reviewed turnoverTaxBps incomeTaxBps levyTaxBps employerTaxBps kind") {
		if value, ok := values[key]; ok {
			safe[key] = value
		}
	}
	if amount, ok := values["amountMinor"]; ok {
		safe["finance"] = map[string]any{"amountMinor": amount, "currency": values["currency"]}
	}
	data, err := json.Marshal(safe)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO activity_events(tenant_id,actor_membership_id,actor_kind,action,entity_type,entity_id,details) VALUES($1,NULLIF($2,'')::uuid,'human',$3,'finance',$4,$5)`, actor.TenantID, actor.MembershipID, action, id, data)
	return err
}

func (app *application) ensurePayrollAccrual(ctx context.Context, tx pgx.Tx, tenantID, expenseID string) error {
	var driverID, currency string
	var gross int64
	err := tx.QueryRow(ctx, `SELECT coalesce(e.driver_id,t.driver_id)::text,e.amount_minor,e.currency FROM operational_expenses e LEFT JOIN trips t ON t.id=e.trip_id AND t.tenant_id=e.tenant_id WHERE e.id=$1 AND e.tenant_id=$2 AND e.category='driver_pay' AND coalesce(e.driver_id,t.driver_id) IS NOT NULL`, expenseID, tenantID).Scan(&driverID, &gross, &currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	rates, err := app.loadPayrollRates(ctx, tx, tenantID, driverID)
	if err != nil {
		return err
	}
	configured := true
	amounts, err := calculatePayroll(gross, rates)
	if err != nil {
		return err
	}
	snapshot, _ := json.Marshal(rates)
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO driver_payroll_accruals(tenant_id,driver_id,expense_id,trip_id,gross_minor,currency,income_tax_minor,levy_tax_minor,employer_tax_minor,tax_configured,tax_snapshot,occurred_at)
 SELECT tenant_id,$3,id,trip_id,amount_minor,currency,$4,$5,$6,$7,$8,occurred_at FROM operational_expenses WHERE id=$1 AND tenant_id=$2
 ON CONFLICT(expense_id) DO NOTHING RETURNING id::text`, expenseID, tenantID, driverID, amounts.Income, amounts.Levy, amounts.Employer, configured, snapshot).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return app.recordEmployerTax(ctx, tx, tenantID, id)
}
func (app *application) recordEmployerTax(ctx context.Context, tx pgx.Tx, tenantID, accrualID string) error {
	_, err := tx.Exec(ctx, `INSERT INTO operational_expenses(tenant_id,driver_id,trip_id,category,amount_minor,currency,description,occurred_at,source_key)
 SELECT tenant_id,driver_id,trip_id,'payroll_tax',employer_tax_minor,currency,'Начисления компании на зарплату',occurred_at,'payroll-tax:'||id::text
 FROM driver_payroll_accruals WHERE tenant_id=$1 AND id=$2 AND tax_configured AND employer_tax_minor>0
 ON CONFLICT(tenant_id,source_key) WHERE source_key IS NOT NULL DO NOTHING`, tenantID, accrualID)
	return err
}
func (app *application) finalizeDriverPayroll(ctx context.Context, tx pgx.Tx, tenantID, driverID string) (int, error) {
	rates, err := app.loadPayrollRates(ctx, tx, tenantID, driverID)
	if err != nil {
		return 0, err
	}
	rows, err := tx.Query(ctx, `SELECT id::text,gross_minor FROM driver_payroll_accruals WHERE tenant_id=$1 AND driver_id=$2 AND NOT tax_configured ORDER BY id FOR UPDATE`, tenantID, driverID)
	if err != nil {
		return 0, err
	}
	type pending struct {
		id    string
		gross int64
	}
	items := []pending{}
	for rows.Next() {
		var p pending
		if err = rows.Scan(&p.id, &p.gross); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	snapshot, _ := json.Marshal(rates)
	for _, p := range items {
		a, e := calculatePayroll(p.gross, rates)
		if e != nil {
			return 0, e
		}
		if _, e = tx.Exec(ctx, `UPDATE driver_payroll_accruals SET income_tax_minor=$3,levy_tax_minor=$4,employer_tax_minor=$5,tax_snapshot=$6,tax_configured=true WHERE id=$1 AND tenant_id=$2 AND NOT tax_configured`, p.id, tenantID, a.Income, a.Levy, a.Employer, snapshot); e != nil {
			return 0, e
		}
		if e = app.recordEmployerTax(ctx, tx, tenantID, p.id); e != nil {
			return 0, e
		}
	}
	return len(items), nil
}
func (app *application) payrollSettings(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	driverID := r.PathValue("driverID")
	var exists bool
	if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM drivers WHERE id=$1 AND tenant_id=$2)`, driverID, tenant.ID).Scan(&exists); err != nil || !exists {
		writeJSON(w, 404, map[string]string{"error": "Водитель не найден."})
		return
	}
	if r.Method == "GET" {
		var rates payrollRates
		err := app.db.QueryRow(r.Context(), `SELECT income_tax_bps,levy_tax_bps,employer_tax_bps FROM driver_payroll_settings WHERE tenant_id=$1 AND driver_id=$2`, tenant.ID, driverID).Scan(&rates.Income, &rates.Levy, &rates.Employer)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 200, map[string]any{"item": nil})
			return
		}
		if err != nil {
			app.financeFailure(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"item": rates})
		return
	}
	var input struct {
		Income   *int `json:"incomeTaxBps"`
		Levy     *int `json:"levyTaxBps"`
		Employer *int `json:"employerTaxBps"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || input.Income == nil || input.Levy == nil || input.Employer == nil {
		writeJSON(w, 400, map[string]string{"error": "Укажите все три ставки. Если налог не применяется, укажите 0."})
		return
	}
	rates := payrollRates{*input.Income, *input.Levy, *input.Employer}
	if !validPayrollRates(rates) {
		writeJSON(w, 400, map[string]string{"error": "Ставки должны быть от 0 до 100%, сумма удержаний — не больше 100%."})
		return
	}
	actor, _ := identityFromContext(r.Context())
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `INSERT INTO driver_payroll_settings(tenant_id,driver_id,income_tax_bps,levy_tax_bps,employer_tax_bps,updated_by) VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::uuid) ON CONFLICT(driver_id) DO UPDATE SET income_tax_bps=$3,levy_tax_bps=$4,employer_tax_bps=$5,updated_by=NULLIF($6,'')::uuid,updated_at=now() WHERE driver_payroll_settings.tenant_id=$1`, tenant.ID, driverID, rates.Income, rates.Levy, rates.Employer, actor.MembershipID)
	if err == nil {
		err = writeFinanceActivity(r.Context(), tx, actor, "payroll.rates_changed", driverID, rates)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	financeAuditDone(r)
	writeJSON(w, 200, map[string]any{"item": rates})
}

func (app *application) loadPayrollRates(ctx context.Context, tx pgx.Tx, tenantID, driverID string) (payrollRates, error) {
	var rates payrollRates
	err := tx.QueryRow(ctx, `SELECT income_tax_bps,levy_tax_bps,employer_tax_bps FROM driver_payroll_settings WHERE tenant_id=$1 AND driver_id=$2`, tenantID, driverID).Scan(&rates.Income, &rates.Levy, &rates.Employer)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `SELECT income_tax_bps,levy_tax_bps,employer_tax_bps FROM finance_settings WHERE tenant_id=$1`, tenantID).Scan(&rates.Income, &rates.Levy, &rates.Employer)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return payrollRates{}, nil
	}
	return rates, err
}
