package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"sort"
	"time"
)

type monobankRate struct {
	A     int     `json:"currencyCodeA"`
	B     int     `json:"currencyCodeB"`
	Date  int64   `json:"date"`
	Buy   float64 `json:"rateBuy"`
	Sell  float64 `json:"rateSell"`
	Cross float64 `json:"rateCross"`
}

func convertMonobankRates(items []monobankRate, base string) (map[string]float64, time.Time) {
	codes := map[int]string{978: "EUR", 840: "USD", 985: "PLN", 980: "UAH"}
	uah := map[string]float64{"UAH": 1}
	var updated int64
	for _, item := range items {
		rate := item.Cross
		if item.Buy > 0 && item.Sell > 0 {
			rate = (item.Buy + item.Sell) / 2
		}
		if math.IsNaN(rate) || math.IsInf(rate, 0) || rate <= 0 {
			continue
		}
		if item.B == 980 && codes[item.A] != "" {
			uah[codes[item.A]] = rate
		} else if item.A == 980 && codes[item.B] != "" {
			uah[codes[item.B]] = 1 / rate
		} else {
			continue
		}
		if item.Date > updated {
			updated = item.Date
		}
	}
	result := map[string]float64{}
	if uah[base] <= 0 {
		return result, time.Time{}
	}
	for code, rate := range uah {
		result[code] = math.Round(rate/uah[base]*1e8) / 1e8
	}
	result[base] = 1
	return result, time.Unix(updated, 0)
}

// Each quote is for one unit of foreign currency, expressed in hryvnias.
// Cross-only currencies must not be presented as a fictitious buy/sell spread.
type currencyQuote struct {
	Currency  string    `json:"currency"`
	Buy       float64   `json:"buy,omitempty"`
	Sell      float64   `json:"sell,omitempty"`
	Cross     float64   `json:"cross,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func monobankQuotes(items []monobankRate) []currencyQuote {
	codes := map[int]string{978: "EUR", 840: "USD", 985: "PLN"}
	quotes := make([]currencyQuote, 0)
	for _, item := range items {
		code := codes[item.A]
		if item.B != 980 || code == "" || item.Date <= 0 {
			continue
		}
		q := currencyQuote{Currency: code, UpdatedAt: time.Unix(item.Date, 0)}
		valid := func(v float64) bool { return v > 0 && v < 1_000_000 && !math.IsNaN(v) && !math.IsInf(v, 0) }
		if valid(item.Buy) && valid(item.Sell) {
			q.Buy = item.Buy
			q.Sell = item.Sell
		} else if valid(item.Cross) {
			q.Cross = item.Cross
		} else {
			continue
		}
		if q.UpdatedAt.After(time.Now().Add(time.Hour)) || time.Since(q.UpdatedAt) > 7*24*time.Hour {
			continue
		}
		quotes = append(quotes, q)
	}
	return quotes
}

// Fresh data is shared by all companies. A separate last-good copy survives a
// provider outage; it never extends the fresh cache's five-minute lifetime.
func (app *application) loadMonobankRates(ctx context.Context, fetch bool) ([]monobankRate, bool, error) {
	key := "public:monobank-currency"
	decode := func(raw []byte) ([]monobankRate, error) {
		var items []monobankRate
		if json.Unmarshal(raw, &items) != nil || len(monobankQuotes(items)) == 0 {
			return nil, errors.New("Курсы Monobank временно недоступны.")
		}
		return items, nil
	}
	if raw, err := app.redis.Get(ctx, key).Bytes(); err == nil {
		items, err := decode(raw)
		if err == nil {
			return items, false, nil
		}
	}
	if fetch {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.monobank.ua/bank/currency", nil)
		response, err := integrationTestClient.Do(req)
		if err == nil {
			defer response.Body.Close()
			if response.StatusCode == 200 {
				raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
				if err == nil {
					if items, err := decode(raw); err == nil {
						_ = app.redis.Set(ctx, key, raw, 5*time.Minute).Err()
						_ = app.redis.Set(ctx, key+":last-good", raw, 7*24*time.Hour).Err()
						return items, false, nil
					}
				}
			}
		}
	}
	raw, _ := app.redis.Get(ctx, key+":last-good").Bytes()
	items, err := decode(raw)
	return items, true, err
}
func (app *application) storeMonobankRates(ctx context.Context, tenantID, base string, items []monobankRate) error {
	valid := make([]monobankRate, 0)
	codes := map[string]int{"EUR": 978, "USD": 840, "PLN": 985}
	for _, q := range monobankQuotes(items) {
		valid = append(valid, monobankRate{A: codes[q.Currency], B: 980, Buy: q.Buy, Sell: q.Sell, Cross: q.Cross, Date: q.UpdatedAt.Unix()})
	}
	rates, _ := convertMonobankRates(valid, base)
	if len(rates) < 2 {
		return errors.New("Курс базовой валюты не найден.")
	}
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// The worker and settings reads can refresh one company concurrently.
	// Lock rows in the same order in every transaction to avoid a deadlock.
	codesToStore := make([]string, 0, len(rates))
	for code := range rates {
		codesToStore = append(codesToStore, code)
	}
	sort.Strings(codesToStore)
	for _, code := range codesToStore {
		rate := rates[code]
		_, err = tx.Exec(ctx, `INSERT INTO tenant_exchange_rates(tenant_id,currency,rate_to_base) VALUES($1,$2,$3) ON CONFLICT(tenant_id,currency) DO UPDATE SET rate_to_base=EXCLUDED.rate_to_base,updated_at=now() WHERE tenant_exchange_rates.rate_to_base IS DISTINCT FROM EXCLUDED.rate_to_base`, tenantID, code, rate)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (app *application) currencyWorker(ctx context.Context) {
	sync := func() {
		cycle, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		items, stale, err := app.loadMonobankRates(cycle, true)
		if err != nil || stale {
			app.log.Warn("currency sync unavailable; retaining saved rates")
			return
		}
		rows, err := app.db.Query(cycle, `SELECT id::text,base_currency FROM tenants`)
		if err != nil {
			return
		}
		type company struct{ id, base string }
		var companies []company
		for rows.Next() {
			var c company
			if rows.Scan(&c.id, &c.base) == nil {
				companies = append(companies, c)
			}
		}
		rows.Close()
		for _, c := range companies {
			if err := app.storeMonobankRates(cycle, c.id, c.base, items); err != nil {
				app.log.Warn("currency sync failed", "tenant", c.id)
			}
		}
	}
	sync()
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sync()
		}
	}
}
func (app *application) monobankExchangeRates(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	items, stale, err := app.loadMonobankRates(r.Context(), true)
	if err != nil {
		writeError(w, 503, "Курсы Monobank временно недоступны.")
		return
	}
	rates, updated := convertMonobankRates(items, tenant.BaseCurrency)
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, 200, map[string]any{"baseCurrency": tenant.BaseCurrency, "rates": rates, "quotes": monobankQuotes(items), "quoteCurrency": "UAH", "updatedAt": updated, "source": "Monobank", "stale": stale})
}
