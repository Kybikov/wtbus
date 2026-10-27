package main

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type statisticsMetrics struct {
	Bookings       int64 `json:"bookings"`
	Passengers     int64 `json:"passengers"`
	Confirmed      int64 `json:"confirmed"`
	Cancelled      int64 `json:"cancelled"`
	Expired        int64 `json:"expired"`
	Trips          int64 `json:"trips"`
	CompletedTrips int64 `json:"completedTrips"`
	CancelledTrips int64 `json:"cancelledTrips"`
	Capacity       int64 `json:"capacity"`
	OccupiedSeats  int64 `json:"occupiedSeats"`
}
type statisticsDay struct {
	Date string `json:"date"`
	statisticsMetrics
}
type statisticsBucket struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Color string `json:"color,omitempty"`
	Count int64  `json:"count"`
}
type statisticsRoute struct {
	Label      string `json:"label"`
	Trips      int64  `json:"trips"`
	Passengers int64  `json:"passengers"`
	Capacity   int64  `json:"capacity"`
}
type statisticsMoney struct {
	Revenue  int64 `json:"revenueMinor"`
	Expenses int64 `json:"expensesMinor"`
	Refunds  int64 `json:"refundsMinor"`
}
type statisticsMoneyDay struct {
	Date string `json:"date"`
	statisticsMoney
}
type statisticsMoneyBucket struct {
	Key    string `json:"key"`
	Amount int64  `json:"amountMinor"`
}
type statisticsPeriod struct {
	Key  string `json:"key"`
	From string `json:"from"`
	To   string `json:"to"`
	statisticsMetrics
}
type statisticsMoneyPeriod struct {
	Key string `json:"key"`
	statisticsMoney
}
type statisticsFinance struct {
	Currency   string                  `json:"currency"`
	Totals     statisticsMoney         `json:"totals"`
	Previous   statisticsMoney         `json:"previous"`
	Daily      []statisticsMoneyDay    `json:"daily"`
	Periods    []statisticsMoneyPeriod `json:"periods"`
	Methods    []statisticsMoneyBucket `json:"methods"`
	Categories []statisticsMoneyBucket `json:"categories"`
}
type statisticsResponse struct {
	From         string             `json:"from"`
	To           string             `json:"to"`
	Today        string             `json:"today"`
	Timezone     string             `json:"timezone"`
	PreviousFrom string             `json:"previousFrom"`
	PreviousTo   string             `json:"previousTo"`
	Metrics      statisticsMetrics  `json:"metrics"`
	Previous     statisticsMetrics  `json:"previous"`
	Daily        []statisticsDay    `json:"daily"`
	Periods      []statisticsPeriod `json:"periods"`
	Statuses     []statisticsBucket `json:"statuses"`
	Sources      []statisticsBucket `json:"sources"`
	Routes       []statisticsRoute  `json:"routes"`
	Finance      *statisticsFinance `json:"finance,omitempty"`
}

// Civil-day arithmetic must not divide local durations by 24h across DST.
func statisticsDays(from, to time.Time) int {
	utc := func(d time.Time) time.Time { return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC) }
	return int(utc(to).Sub(utc(from)) / (24 * time.Hour))
}
func statisticsRange(r *http.Request, today time.Time) (time.Time, time.Time, bool) {
	from := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, today.Location())
	to := today.AddDate(0, 0, 1)
	for _, item := range []struct {
		key    string
		target *time.Time
	}{{"from", &from}, {"to", &to}} {
		if raw := r.URL.Query().Get(item.key); raw != "" {
			d, err := time.ParseInLocation("2006-01-02", raw, today.Location())
			if err != nil || d.Year() < 1900 || d.Year() > 2100 {
				return from, to, false
			}
			*item.target = d
			if item.key == "to" {
				*item.target = d.AddDate(0, 0, 1)
			}
		}
	}
	return from, to, statisticsDays(from, to) >= 1 && statisticsDays(from, to) <= 366
}
func (m *statisticsMetrics) add(v statisticsMetrics) {
	m.Bookings += v.Bookings
	m.Passengers += v.Passengers
	m.Confirmed += v.Confirmed
	m.Cancelled += v.Cancelled
	m.Expired += v.Expired
	m.Trips += v.Trips
	m.CompletedTrips += v.CompletedTrips
	m.CancelledTrips += v.CancelledTrips
	m.Capacity += v.Capacity
	m.OccupiedSeats += v.OccupiedSeats
}
func (m *statisticsMoney) add(v statisticsMoney) {
	m.Revenue += v.Revenue
	m.Expenses += v.Expenses
	m.Refunds += v.Refunds
}

func (app *application) statistics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	company, ok := app.loadTenant(w, r, strings.ToLower(r.PathValue("slug")))
	if !ok {
		return
	}
	location, err := time.LoadLocation(company.Timezone)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	now := time.Now().In(location)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	from, to, valid := statisticsRange(r, today)
	if !valid {
		writeJSON(w, 400, map[string]string{"error": "Выберите период от 1 до 366 дней в формате ДД.ММ.ГГГГ."})
		return
	}
	currency := r.URL.Query().Get("currency")
	if currency == "" {
		currency = company.BaseCurrency
	}
	if !validBookingCurrency(currency) {
		writeJSON(w, 400, map[string]string{"error": "Выберите валюту статистики."})
		return
	}
	previousFrom := from.AddDate(0, 0, -statisticsDays(from, to))
	low := previousFrom
	if today.AddDate(0, 0, -29).Before(low) {
		low = today.AddDate(0, 0, -29)
	}
	high := to
	if today.AddDate(0, 0, 1).After(high) {
		high = today.AddDate(0, 0, 1)
	}
	// All charts and totals read one snapshot while dispatchers keep working.
	tx, err := app.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	result := statisticsResponse{From: from.Format("2006-01-02"), To: to.AddDate(0, 0, -1).Format("2006-01-02"), Today: today.Format("2006-01-02"), Timezone: company.Timezone, PreviousFrom: previousFrom.Format("2006-01-02"), PreviousTo: from.AddDate(0, 0, -1).Format("2006-01-02"), Daily: []statisticsDay{}, Periods: []statisticsPeriod{}, Statuses: []statisticsBucket{}, Sources: []statisticsBucket{}, Routes: []statisticsRoute{}}
	days := map[string]statisticsMetrics{}
	statuses, sources := map[string]statisticsBucket{}, map[string]statisticsBucket{}
	routes := map[string]statisticsRoute{}
	selected := func(day string) bool { return day >= result.From && day <= result.To }
	rows, err := tx.Query(r.Context(), `SELECT (b.created_at AT TIME ZONE $4)::date::text,b.status,
 coalesce(s.label,b.status),coalesce(s.tone,'slate'),workflow_status_phase(b.tenant_id,'bookings',b.status),b.source::text,
 count(*),coalesce(sum(b.seats) FILTER(WHERE workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('pending','confirmed','completed') OR (workflow_status_phase(b.tenant_id,'bookings',b.status)='awaiting_payment' AND b.payment_hold_expires_at>$5)),0)
 FROM bookings b LEFT JOIN workflow_statuses s ON s.tenant_id=b.tenant_id AND s.entity_type='bookings' AND s.key=b.status
 WHERE b.tenant_id=$1 AND b.created_at>=$2 AND b.created_at<$3 GROUP BY 1,2,3,4,5,6`, company.ID, low, high, company.Timezone, now)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	for rows.Next() {
		var day, key, label, color, phase, source string
		var count, seats int64
		if err = rows.Scan(&day, &key, &label, &color, &phase, &source, &count, &seats); err != nil {
			break
		}
		m := days[day]
		m.Bookings += count
		m.Passengers += seats
		switch phase {
		case "confirmed", "completed":
			m.Confirmed += count
		case "cancelled":
			m.Cancelled += count
		case "expired":
			m.Expired += count
		}
		days[day] = m
		if selected(day) {
			s := statuses[key]
			s.Key = key
			s.Label = label
			s.Color = color
			s.Count += count
			statuses[key] = s
			s = sources[source]
			s.Key = source
			s.Label = source
			s.Count += count
			sources[source] = s
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	rows, err = tx.Query(r.Context(), `WITH scoped AS (
 SELECT t.*,(SELECT coalesce(sum(b.seats),0) FROM bookings b WHERE b.tenant_id=t.tenant_id AND b.trip_id=t.id AND
 (workflow_status_phase(b.tenant_id,'bookings',b.status) IN ('pending','confirmed','completed') OR (workflow_status_phase(b.tenant_id,'bookings',b.status)='awaiting_payment' AND b.payment_hold_expires_at>$5))) occupied,
 workflow_status_phase(t.tenant_id,'trips',t.status) phase FROM trips t WHERE t.tenant_id=$1 AND t.starts_at>=$2 AND t.starts_at<$3)
 SELECT (starts_at AT TIME ZONE $4)::date::text,origin_name||' → '||destination_name,count(*),
 count(*) FILTER(WHERE phase='completed'),count(*) FILTER(WHERE phase='cancelled'),
 coalesce(sum(capacity) FILTER(WHERE phase<>'cancelled'),0),coalesce(sum(occupied) FILTER(WHERE phase<>'cancelled'),0)
 FROM scoped GROUP BY 1,2`, company.ID, low, high, company.Timezone, now)
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	for rows.Next() {
		var day, label string
		var m statisticsMetrics
		if err = rows.Scan(&day, &label, &m.Trips, &m.CompletedTrips, &m.CancelledTrips, &m.Capacity, &m.OccupiedSeats); err != nil {
			break
		}
		d := days[day]
		d.add(m)
		days[day] = d
		if selected(day) {
			v := routes[label]
			v.Label = label
			v.Trips += m.Trips
			v.Passengers += m.OccupiedSeats
			v.Capacity += m.Capacity
			routes[label] = v
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		app.financeFailure(w, err)
		return
	}
	actor, _ := identityFromContext(r.Context())
	financial := actor.Role == "developer" || actor.Role == "owner" || actor.Role == "admin" || actor.Role == "accountant"
	moneyDays := map[string]statisticsMoney{}
	if financial {
		result.Finance = &statisticsFinance{Currency: currency, Daily: []statisticsMoneyDay{}, Periods: []statisticsMoneyPeriod{}, Methods: []statisticsMoneyBucket{}, Categories: []statisticsMoneyBucket{}}
		// Use the same recognition as financeSummary: paid bank payments minus
		// refunds, cash received from passengers and company cash income. Cash
		// handovers/funding and salary payouts are not a second income/expense.
		rows, err = tx.Query(r.Context(), `WITH entries AS (
 SELECT paid_at occurred_at,'bank' kind,'' category,amount_minor revenue,0::bigint expense,0::bigint refund FROM payments WHERE tenant_id=$1 AND currency=$4 AND paid_at>=$2 AND paid_at<$3 AND workflow_status_phase(tenant_id,'payments',status) IN ('paid','refunded')
 UNION ALL SELECT updated_at,'bank','',-amount_minor,0,amount_minor FROM payments WHERE tenant_id=$1 AND currency=$4 AND updated_at>=$2 AND updated_at<$3 AND workflow_status_phase(tenant_id,'payments',status)='refunded'
 UNION ALL SELECT occurred_at,'driver_cash','',amount_minor,0,0 FROM driver_cash_ledger WHERE tenant_id=$1 AND currency=$4 AND kind='cash_collected' AND occurred_at>=$2 AND occurred_at<$3
 UNION ALL SELECT occurred_at,'cash','',amount_minor,0,0 FROM company_cash_receipts WHERE tenant_id=$1 AND currency=$4 AND kind='income' AND occurred_at>=$2 AND occurred_at<$3
 UNION ALL SELECT occurred_at,'expense',category,0,amount_minor,0 FROM operational_expenses WHERE tenant_id=$1 AND currency=$4 AND occurred_at>=$2 AND occurred_at<$3)
 SELECT (occurred_at AT TIME ZONE $5)::date::text,kind,category,sum(revenue)::bigint,sum(expense)::bigint,sum(refund)::bigint FROM entries GROUP BY 1,2,3`, company.ID, low, high, currency, company.Timezone)
		if err != nil {
			app.financeFailure(w, err)
			return
		}
		methods, categories := map[string]int64{}, map[string]int64{}
		for rows.Next() {
			var day, kind, category string
			var m statisticsMoney
			if err = rows.Scan(&day, &kind, &category, &m.Revenue, &m.Expenses, &m.Refunds); err != nil {
				break
			}
			d := moneyDays[day]
			d.add(m)
			moneyDays[day] = d
			if selected(day) {
				if kind == "expense" {
					categories[category] += m.Expenses
				} else {
					methods[kind] += m.Revenue
				}
			}
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			app.financeFailure(w, err)
			return
		}
		for k, v := range methods {
			result.Finance.Methods = append(result.Finance.Methods, statisticsMoneyBucket{k, v})
		}
		for k, v := range categories {
			result.Finance.Categories = append(result.Finance.Categories, statisticsMoneyBucket{k, v})
		}
		sort.Slice(result.Finance.Methods, func(i, j int) bool { return result.Finance.Methods[i].Key < result.Finance.Methods[j].Key })
		sort.Slice(result.Finance.Categories, func(i, j int) bool { return result.Finance.Categories[i].Amount > result.Finance.Categories[j].Amount })
	}
	sum := func(a, b time.Time) (statisticsMetrics, statisticsMoney) {
		var m statisticsMetrics
		var cash statisticsMoney
		for d := a; d.Before(b); d = d.AddDate(0, 0, 1) {
			key := d.Format("2006-01-02")
			m.add(days[key])
			cash.add(moneyDays[key])
		}
		return m, cash
	}
	result.Metrics, _ = sum(from, to)
	result.Previous, _ = sum(previousFrom, from)
	if financial {
		_, result.Finance.Totals = sum(from, to)
		_, result.Finance.Previous = sum(previousFrom, from)
	}
	for d := from; d.Before(to); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		result.Daily = append(result.Daily, statisticsDay{key, days[key]})
		if financial {
			result.Finance.Daily = append(result.Finance.Daily, statisticsMoneyDay{key, moneyDays[key]})
		}
	}
	for _, period := range []struct {
		key  string
		days int
	}{{"today", 1}, {"week", 7}, {"month", 30}} {
		a, b := today.AddDate(0, 0, 1-period.days), today.AddDate(0, 0, 1)
		m, cash := sum(a, b)
		result.Periods = append(result.Periods, statisticsPeriod{period.key, a.Format("2006-01-02"), today.Format("2006-01-02"), m})
		if financial {
			result.Finance.Periods = append(result.Finance.Periods, statisticsMoneyPeriod{period.key, cash})
		}
	}
	for _, s := range statuses {
		result.Statuses = append(result.Statuses, s)
	}
	for _, s := range sources {
		result.Sources = append(result.Sources, s)
	}
	for _, v := range routes {
		result.Routes = append(result.Routes, v)
	}
	sort.Slice(result.Statuses, func(i, j int) bool {
		if result.Statuses[i].Count == result.Statuses[j].Count {
			return result.Statuses[i].Key < result.Statuses[j].Key
		}
		return result.Statuses[i].Count > result.Statuses[j].Count
	})
	sort.Slice(result.Sources, func(i, j int) bool { return result.Sources[i].Key < result.Sources[j].Key })
	sort.Slice(result.Routes, func(i, j int) bool {
		if result.Routes[i].Passengers == result.Routes[j].Passengers {
			return result.Routes[i].Label < result.Routes[j].Label
		}
		return result.Routes[i].Passengers > result.Routes[j].Passengers
	})
	if err = tx.Commit(r.Context()); err != nil {
		app.financeFailure(w, err)
		return
	}
	writeJSON(w, 200, result)
}
