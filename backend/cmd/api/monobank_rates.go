package main

import (
	"encoding/json"
	"io"
	"math"
	"net/http"
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
func (app *application) monobankExchangeRates(w http.ResponseWriter, r *http.Request) {
	tenant, ok := app.loadTenant(w, r, r.PathValue("slug"))
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	key := "public:monobank-currency"
	raw, _ := app.redis.Get(r.Context(), key).Bytes()
	fetched := len(raw) == 0
	if len(raw) == 0 {
		req, _ := http.NewRequestWithContext(r.Context(), "GET", "https://api.monobank.ua/bank/currency", nil)
		response, err := integrationTestClient.Do(req)
		if err != nil {
			writeError(w, 502, "Курсы Monobank временно недоступны.")
			return
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			writeError(w, 502, "Не удалось получить курсы Monobank. Повторите позже.")
			return
		}
		raw, err = io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if err != nil {
			writeError(w, 502, "Не удалось получить курсы Monobank.")
			return
		}
	}
	var items []monobankRate
	if json.Unmarshal(raw, &items) != nil || len(items) == 0 {
		writeError(w, 502, "Не удалось прочитать курсы Monobank.")
		return
	}
	rates, updated := convertMonobankRates(items, tenant.BaseCurrency)
	if len(rates) < 2 || updated.After(time.Now().Add(time.Hour)) || time.Since(updated) > 7*24*time.Hour {
		writeError(w, 502, "Актуальный курс базовой валюты не найден.")
		return
	}
	if fetched {
		_ = app.redis.Set(r.Context(), key, raw, 5*time.Minute).Err()
	}
	writeJSON(w, 200, map[string]any{"baseCurrency": tenant.BaseCurrency, "rates": rates, "updatedAt": updated, "source": "Monobank"})
}
