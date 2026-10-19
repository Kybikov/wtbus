package main

import (
	"math"
	"testing"
)

func TestMonobankCrossRates(t *testing.T) {
	items := []monobankRate{{A: 840, B: 980, Buy: 40, Sell: 42, Date: 100}, {A: 978, B: 980, Buy: 44, Sell: 46, Date: 100}, {A: 985, B: 980, Cross: 10, Date: 90}}
	rates, _ := convertMonobankRates(items, "EUR")
	for code, want := range map[string]float64{"EUR": 1, "USD": 41.0 / 45, "UAH": 1.0 / 45, "PLN": 10.0 / 45} {
		if math.Abs(rates[code]-want) > 1e-8 {
			t.Fatalf("%s=%v want %v", code, rates[code], want)
		}
	}
	missing, _ := convertMonobankRates(items, "GBP")
	if len(missing) != 0 {
		t.Fatal("invented missing base rate")
	}
	partial, _ := convertMonobankRates(items[:2], "EUR")
	if _, ok := partial["PLN"]; ok {
		t.Fatal("invented absent PLN rate")
	}
}
func TestMaskedIntegrationSecret(t *testing.T) {
	token := "abcd-secret-middle-wxyz"
	if got := maskedIntegrationSecret(token); got != "abcd••••••••wxyz" {
		t.Fatal(got)
	}
	if got := maskedIntegrationSecret("short"); got != "••••••••" {
		t.Fatal("short secret exposed", got)
	}
	if maskedIntegrationSecret("") != "" {
		t.Fatal("empty secret has preview")
	}
}
