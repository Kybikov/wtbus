package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	"time"
)

func moneyJSON(ctx context.Context, tx pgx.Tx, sql string, args ...any) (json.RawMessage, error) {
	var out json.RawMessage
	err := tx.QueryRow(ctx, sql, args...).Scan(&out)
	return out, err
}
func (app *application) moneyWorkspaceRead(w http.ResponseWriter, r *http.Request, tenant string, a identity) {
	ctx := r.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	for _, c := range []string{"UAH", "EUR", "PLN", "USD"} {
		if _, err = moneyAccount(ctx, tx, tenant, "member", a.MembershipID, c); err == nil && moneyViewer(a) {
			_, err = moneyAccount(ctx, tx, tenant, "company", tenant, c)
		}
		if err != nil {
			app.financeFailure(w, err)
			return
		}
	}
	result := map[string]any{"membershipId": a.MembershipID, "canManage": moneyManager(a), "isOwner": moneyOwner(a)}
	queries := map[string]string{
		"wallets":   `SELECT coalesce(jsonb_agg(item),'[]') FROM (SELECT jsonb_build_object('accountId',a.id,'ownerType',a.owner_type,'ownerId',a.owner_id,'name',CASE WHEN a.owner_type='company' THEN 'Касса компании' ELSE coalesce(u.display_name,d.full_name,'Кошелек') END,'currency',a.currency,'balanceMinor',coalesce((SELECT sum(p.amount_minor) FROM money_postings p WHERE p.tenant_id=a.tenant_id AND p.account_id=a.id),0),'reservedMinor',coalesce((SELECT sum(t.amount_minor) FROM money_transfers t WHERE t.tenant_id=a.tenant_id AND t.account_id=a.id AND t.status='pending'),0),'availableMinor',0,'canSpend',(a.owner_type='member' AND a.owner_id=$2::uuid) OR (a.owner_type='company' AND $4)) item FROM money_accounts a LEFT JOIN memberships m ON m.id=a.owner_id AND m.tenant_id=a.tenant_id LEFT JOIN users u ON u.id=m.user_id LEFT JOIN drivers d ON d.id=a.owner_id AND d.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.owner_type<>'system' AND ($3 OR a.owner_type='member' AND a.owner_id=$2::uuid) ORDER BY a.owner_type,a.owner_id,a.currency)s`,
		"transfers": `SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC),'[]') FROM (SELECT t.created_at,jsonb_build_object('id',t.id,'accountId',t.account_id,'recipientAccountId',t.recipient_account_id,'fromName',coalesce(fu.display_name,'Касса компании'),'toName',coalesce(tu.display_name,'Касса компании'),'amountMinor',t.amount_minor,'currency',t.currency,'status',t.status,'occurredAt',t.occurred_at,'createdAt',t.created_at,'description',t.description,'canAccept',t.status='pending' AND ((b.owner_type='member' AND b.owner_id=$2::uuid) OR (b.owner_type='company' AND $5)),'canReject',t.status='pending' AND ((b.owner_type='member' AND b.owner_id=$2::uuid) OR (b.owner_type='company' AND $5)),'canCancel',t.status='pending' AND ((a.owner_type='member' AND a.owner_id=$2::uuid) OR (a.owner_type='company' AND $4))) item FROM money_transfers t JOIN money_accounts a ON a.id=t.account_id JOIN money_accounts b ON b.id=t.recipient_account_id LEFT JOIN memberships fm ON fm.id=a.owner_id LEFT JOIN users fu ON fu.id=fm.user_id LEFT JOIN memberships tm ON tm.id=b.owner_id LEFT JOIN users tu ON tu.id=tm.user_id WHERE t.tenant_id=$1 AND ($3 OR a.owner_id=$2::uuid OR b.owner_id=$2::uuid))s`,
		"expenses":  `SELECT coalesce(jsonb_agg(item ORDER BY occurred_at DESC),'[]') FROM (SELECT j.occurred_at,jsonb_build_object('id',j.id,'accountId',e.wallet_account_id,'amountMinor',e.amount_minor,'currency',e.currency,'tripId',e.trip_id,'category',e.category,'description',e.description,'occurredAt',e.occurred_at,'actorName',u.display_name,'reversed',EXISTS(SELECT 1 FROM money_reversals v WHERE v.tenant_id=j.tenant_id AND v.journal_id=j.id),'canReverse',$4 AND NOT EXISTS(SELECT 1 FROM driver_payroll_accruals d WHERE d.tenant_id=e.tenant_id AND d.expense_id=e.id) AND NOT EXISTS(SELECT 1 FROM crew_payroll_accruals c WHERE c.tenant_id=e.tenant_id AND c.expense_id=e.id) AND NOT EXISTS(SELECT 1 FROM money_reversals v WHERE v.tenant_id=j.tenant_id AND v.journal_id=j.id)) item FROM operational_expenses e JOIN money_journal j ON j.tenant_id=e.tenant_id AND j.source_key='operational_expenses:'||e.id::text LEFT JOIN memberships m ON m.id=j.actor_membership_id LEFT JOIN users u ON u.id=m.user_id WHERE e.tenant_id=$1 AND ($3 OR e.actor_membership_id=$2::uuid))s`,
		"receipts":  moneyReceiptQuery(`r.tenant_id=$1 AND ($3 OR j.actor_membership_id=$2::uuid)`),
		"members":   `SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',u.display_name) ORDER BY u.display_name),'[]') FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.is_active AND NOT u.is_system`,
		"trips":     `SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',t.origin_name||' → '||t.destination_name,'currency',t.currency)),'[]') FROM trips t WHERE t.tenant_id=$1 AND ($3 OR EXISTS(SELECT 1 FROM trip_crew c WHERE c.tenant_id=t.tenant_id AND c.trip_id=t.id AND c.membership_id=$2::uuid AND c.is_active))`,
		"rates":     `SELECT coalesce(jsonb_agg(jsonb_build_object('date',rate_date,'currency',currency,'rateToUAH',rate_to_uah::text,'source',source) ORDER BY rate_date DESC),'[]') FROM money_rate_history WHERE tenant_id=$1 AND rate_date>=current_date-60 AND ($3 OR $2::uuid IS NOT NULL)`}
	for key, query := range queries { // Numbered arguments deliberately shared by all scope predicates.
		query = `WITH scope AS (SELECT $1::uuid tenant,$2::uuid member,$3::boolean viewer,$4::boolean manager,$5::boolean owner) ` + query
		data, e := moneyJSON(ctx, tx, query, tenant, a.MembershipID, moneyViewer(a), moneyManager(a), moneyOwner(a))
		if e != nil {
			app.financeFailure(w, e)
			return
		}
		result[key] = data
	}
	var wallets []map[string]any
	decoder := json.NewDecoder(bytes.NewReader(result["wallets"].(json.RawMessage)))
	decoder.UseNumber()
	_ = decoder.Decode(&wallets)
	for _, v := range wallets {
		n, e := moneyAccountAvailable(ctx, tx, tenant, v["ownerType"].(string), v["ownerId"].(string), v["currency"].(string))
		if e != nil {
			app.financeFailure(w, e)
			return
		}
		v["availableMinor"] = n
		balance, _ := v["balanceMinor"].(json.Number).Int64()
		v["reservedMinor"] = balance - n
	}
	result["wallets"] = wallets
	if err = tx.Commit(ctx); err != nil {
		app.financeFailure(w, err)
		return
	}
	writeJSON(w, 200, result)
}

func moneyReceiptQuery(where string) string {
	return `SELECT coalesce(jsonb_agg(item ORDER BY occurred_at DESC),'[]') FROM (SELECT j.occurred_at,jsonb_build_object('id',j.id,'bookingId',r.booking_id,'tripId',j.trip_id,'accountId',r.account_id,'amountMinor',r.amount_minor,'currency',r.currency,'settledMinor',r.settled_minor,'bookingCurrency',r.booking_currency,'rate',r.rate::text,'occurredAt',j.occurred_at,'collectorName',u.display_name,'description',j.description,'reversed',EXISTS(SELECT 1 FROM money_reversals v WHERE v.tenant_id=j.tenant_id AND v.journal_id=j.id),'canReverse',$4 AND NOT EXISTS(SELECT 1 FROM money_reversals v WHERE v.tenant_id=j.tenant_id AND v.journal_id=j.id)) item FROM money_receipts r JOIN money_journal j ON j.tenant_id=r.tenant_id AND j.id=r.journal_id LEFT JOIN memberships m ON m.id=j.actor_membership_id LEFT JOIN users u ON u.id=m.user_id WHERE ` + where + `)s`
}

func (app *application) bookingPayments(w http.ResponseWriter, r *http.Request) {
	t, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	a, _ := identityFromContext(r.Context())
	ctx := r.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	booking, trip := r.URL.Query().Get("bookingId"), r.URL.Query().Get("tripId")
	if booking == "" && !validUUID(trip) || booking != "" && !validUUID(booking) {
		writeJSON(w, 400, map[string]string{"error": "Выберите бронирование или рейс."})
		return
	}
	rows, err := tx.Query(ctx, `SELECT b.id::text,b.trip_id::text,b.currency,b.price_minor,coalesce(c.cash_minor,0)+coalesce((SELECT sum(p.amount_minor) FROM payments p WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='paid' AND p.currency=b.currency),0),workflow_status_phase(b.tenant_id,'bookings',b.status),coalesce(cu.full_name,'Пассажир'),coalesce(n.number,'') FROM bookings b JOIN customers cu ON cu.id=b.customer_id AND cu.tenant_id=b.tenant_id LEFT JOIN driver_booking_checkins c ON c.booking_id=b.id AND c.tenant_id=b.tenant_id LEFT JOIN record_numbers n ON n.tenant_id=b.tenant_id AND n.entity='bookings' AND n.record_id=b.id WHERE b.tenant_id=$1 AND (($2<>'' AND b.id::text=$2) OR ($2='' AND b.trip_id::text=$3))`, t.ID, booking, trip)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	items := []map[string]any{}
	for rows.Next() {
		var id, trip, currency, phase, name, number string
		var price, settled int64
		if err = rows.Scan(&id, &trip, &currency, &price, &settled, &phase, &name, &number); err != nil {
			break
		}
		items = append(items, map[string]any{"bookingId": id, "tripId": trip, "currency": currency, "priceMinor": price, "settledMinor": settled, "outstandingMinor": max(int64(0), price-settled), "passengerName": name, "recordNumber": number, "phase": phase})
	}
	rows.Close()
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	for _, v := range items {
		allowed := moneyManager(a)
		if !allowed {
			allowed, err = tripCrewCan(ctx, tx, t.ID, v["tripId"].(string), a.MembershipID, "collect")
			if err != nil {
				app.financeFailure(w, err)
				return
			}
		}
		if !allowed && !moneyViewer(a) {
			writeJSON(w, 403, map[string]string{"error": "Нет доступа к пассажирам этого рейса."})
			return
		}
		reason := ""
		if !allowed {
			reason = "Нет права принимать оплату."
		}
		if v["phase"] == "cancelled" {
			allowed = false
			reason = "Бронирование отменено."
		}
		if v["outstandingMinor"].(int64) == 0 {
			allowed = false
			reason = "Бронирование полностью оплачено."
		}
		var pending bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM payments WHERE tenant_id=$1 AND booking_id=$2 AND status IN ('pending','authorized'))`, t.ID, v["bookingId"]).Scan(&pending); err != nil {
			app.financeFailure(w, err)
			return
		}
		if pending {
			allowed = false
			reason = "Сначала отмените или завершите ожидающую банковскую оплату."
		}
		v["canReceive"], v["disabledReason"] = allowed, reason
		delete(v, "phase")
		data, e := moneyJSON(ctx, tx, `WITH scope AS(SELECT $3::boolean viewer,$4::boolean manager) `+moneyReceiptQuery(`r.tenant_id=$1 AND r.booking_id=$2`), t.ID, v["bookingId"], moneyViewer(a), moneyManager(a))
		if e != nil {
			app.financeFailure(w, e)
			return
		}
		v["receipts"] = data
	}
	if booking != "" {
		if len(items) == 0 {
			writeJSON(w, 404, map[string]string{"error": "Бронирование не найдено."})
			return
		}
		writeJSON(w, 200, items[0])
	} else {
		writeJSON(w, 200, map[string]any{"items": items})
	}
}

func (app *application) tripMoney(w http.ResponseWriter, r *http.Request) {
	t, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	a, _ := identityFromContext(r.Context())
	if !moneyViewer(a) {
		writeJSON(w, 403, map[string]string{"error": "Нет доступа к финансовым итогам."})
		return
	}
	ctx := r.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	trip := r.URL.Query().Get("tripId")
	if trip != "" && !validUUID(trip) {
		writeJSON(w, 400, map[string]string{"error": "Выберите рейс."})
		return
	}
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	for _, value := range []string{from, to} {
		if value != "" {
			if _, e := time.Parse("2006-01-02", value); e != nil {
				writeJSON(w, 400, map[string]string{"error": "Укажите период отчета."})
				return
			}
		}
	}
	rows, err := tx.Query(ctx, `SELECT id::text,currency,origin_name||' → '||destination_name,starts_at,status::text FROM trips WHERE tenant_id=$1 AND ($2='' OR id::text=$2) AND ($3='' OR (starts_at AT TIME ZONE $5)::date>=NULLIF($3,'')::date) AND ($4='' OR (starts_at AT TIME ZONE $5)::date<=NULLIF($4,'')::date) ORDER BY starts_at DESC`, t.ID, trip, from, to, t.Timezone)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	items := []map[string]any{}
	for rows.Next() {
		var id, c, label, status string
		var starts time.Time
		if err = rows.Scan(&id, &c, &label, &starts, &status); err != nil {
			rows.Close()
			app.financeFailure(w, err)
			return
		}
		items = append(items, map[string]any{"tripId": id, "currency": c, "label": label, "startsAt": starts, "status": status})
	}
	rows.Close()
	loc, _ := time.LoadLocation(t.Timezone)
	if loc == nil {
		loc = time.UTC
	}
	for _, v := range items {
		id, c := v["tripId"].(string), v["currency"].(string)
		var revenue, expense, debt int64
		missing := false
		movements, e := tx.Query(ctx, `SELECT j.id::text,j.kind,abs(p.amount_minor),p.currency,j.occurred_at FROM money_journal j JOIN money_postings p ON p.tenant_id=j.tenant_id AND p.journal_id=j.id JOIN money_accounts a ON a.tenant_id=p.tenant_id AND a.id=p.account_id WHERE j.tenant_id=$1 AND j.trip_id=$2 AND j.kind IN ('receipt','expense') AND a.owner_type<>'system' AND NOT EXISTS(SELECT 1 FROM money_reversals x WHERE x.tenant_id=j.tenant_id AND x.journal_id=j.id) UNION ALL SELECT j.id::text,j.kind,abs(p.amount_minor),p.currency,j.occurred_at FROM money_journal j JOIN money_postings p ON p.tenant_id=j.tenant_id AND p.journal_id=j.id JOIN money_accounts a ON a.id=p.account_id WHERE j.tenant_id=$1 AND j.trip_id=$2 AND j.kind='expense' AND a.owner_type='system' AND p.amount_minor<0 AND NOT EXISTS(SELECT 1 FROM money_reversals x WHERE x.tenant_id=j.tenant_id AND x.journal_id=j.id)`, t.ID, id)
		if e != nil {
			app.financeFailure(w, e)
			return
		}
		type movement struct {
			id, kind, c string
			n           int64
			at          time.Time
		}
		list := []movement{}
		for movements.Next() {
			var m movement
			if e = movements.Scan(&m.id, &m.kind, &m.n, &m.c, &m.at); e != nil {
				break
			}
			list = append(list, m)
		}
		movements.Close()
		if e != nil {
			app.financeFailure(w, e)
			return
		}
		for _, m := range list {
			var n int64
			e = tx.QueryRow(ctx, `SELECT amount_minor FROM money_valuations WHERE tenant_id=$1 AND journal_id=$2 AND reporting_currency=$3`, t.ID, m.id, c).Scan(&n)
			if e != nil {
				rate, e := moneyRate(ctx, tx, t.ID, m.c, c, m.at.In(loc).Format("2006-01-02"))
				if e != nil {
					missing = true
					continue
				}
				n, e = moneyRound(m.n, rate)
				if e != nil {
					app.financeFailure(w, e)
					return
				}
				_, e = tx.Exec(ctx, `INSERT INTO money_valuations(tenant_id,journal_id,reporting_currency,rate,amount_minor,source) VALUES($1,$2,$3,$4::numeric,$5,'historical') ON CONFLICT DO NOTHING`, t.ID, m.id, c, rate, n)
				if e != nil {
					app.financeFailure(w, e)
					return
				}
			}
			if m.kind == "receipt" {
				revenue += n
			} else {
				expense += n
			}
		} // Bank receipts are native payment amounts; paid_at fixes their historical date.
		bankRows, e := tx.Query(ctx, `SELECT p.amount_minor,p.currency,coalesce(p.paid_at,p.created_at) FROM payments p JOIN bookings b ON b.id=p.booking_id AND b.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND b.trip_id=$2 AND p.status='paid'`, t.ID, id)
		if e != nil {
			app.financeFailure(w, e)
			return
		}
		bank := []movement{}
		for bankRows.Next() {
			var m movement
			_ = bankRows.Scan(&m.n, &m.c, &m.at)
			bank = append(bank, m)
		}
		bankRows.Close()
		for _, m := range bank {
			rate, e := moneyRate(ctx, tx, t.ID, m.c, c, m.at.In(loc).Format("2006-01-02"))
			if e != nil {
				missing = true
				continue
			}
			n, e := moneyRound(m.n, rate)
			if e != nil {
				app.financeFailure(w, e)
				return
			}
			revenue += n
		}
		debtRows, e := tx.Query(ctx, `SELECT greatest(0,b.price_minor-coalesce(c.cash_minor,0)-coalesce((SELECT sum(p.amount_minor) FROM payments p WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='paid' AND p.currency=b.currency),0))::bigint,b.currency,b.created_at FROM bookings b LEFT JOIN driver_booking_checkins c ON c.booking_id=b.id AND c.tenant_id=b.tenant_id WHERE b.tenant_id=$1 AND b.trip_id=$2 AND workflow_status_phase(b.tenant_id,'bookings',b.status)<>'cancelled'`, t.ID, id)
		if e != nil {
			app.financeFailure(w, e)
			return
		}
		debts := []movement{}
		for debtRows.Next() {
			var m movement
			if e = debtRows.Scan(&m.n, &m.c, &m.at); e != nil {
				break
			}
			debts = append(debts, m)
		}
		debtRows.Close()
		if e != nil {
			app.financeFailure(w, e)
			return
		}
		for _, m := range debts {
			if m.n == 0 {
				continue
			}
			rate, e := moneyRate(ctx, tx, t.ID, m.c, c, m.at.In(loc).Format("2006-01-02"))
			if e != nil {
				missing = true
				continue
			}
			n, e := moneyRound(m.n, rate)
			if e != nil {
				app.financeFailure(w, e)
				return
			}
			debt += n
		}
		v["revenueMinor"], v["expenseMinor"], v["profitMinor"], v["outstandingMinor"], v["rateMissing"] = revenue, expense, revenue-expense, debt, missing
	}
	if err = tx.Commit(ctx); err != nil {
		app.financeFailure(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
