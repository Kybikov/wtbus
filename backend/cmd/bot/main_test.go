package main

import (
	"encoding/base64"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/vivat-bus/tms/internal/telegramoutbox"
)

func TestPriceForBooking(t *testing.T) {
	tests := []struct {
		name      string
		unitPrice int64
		seats     int16
		mode      string
		want      int64
		ok        bool
	}{
		{name: "per passenger", unitPrice: 7900, seats: 3, mode: "per_passenger", want: 23700, ok: true},
		{name: "per booking", unitPrice: 7900, seats: 3, mode: "per_booking", want: 7900, ok: true},
		{name: "overflow is rejected", unitPrice: 1 << 62, seats: 3, mode: "per_passenger", ok: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := priceForBooking(test.unitPrice, test.seats, test.mode)
			if ok != test.ok || got != test.want {
				t.Fatalf("priceForBooking(%d, %d, %q) = (%d, %t), want (%d, %t)", test.unitPrice, test.seats, test.mode, got, ok, test.want, test.ok)
			}
		})
	}
}

func TestParseBotBindings(t *testing.T) {
	t.Run("uses the legacy single-bot configuration", func(t *testing.T) {
		bindings, err := parseBotBindings("", botBinding{Token: "token-one", TenantSlug: "vivat-bus"})
		if err != nil {
			t.Fatalf("parse fallback bindings: %v", err)
		}
		if len(bindings) != 1 || bindings[0].TenantSlug != "vivat-bus" || bindings[0].Token != "token-one" {
			t.Fatalf("unexpected fallback bindings: %#v", bindings)
		}
	})
	t.Run("accepts multiple isolated tenants", func(t *testing.T) {
		bindings, err := parseBotBindings(`[{"token":"token-one","tenantSlug":"vivat-bus"},{"token":"token-two","tenantSlug":"another-company"}]`, botBinding{})
		if err != nil {
			t.Fatalf("parse multi-bot bindings: %v", err)
		}
		if len(bindings) != 2 || bindings[1].TenantSlug != "another-company" {
			t.Fatalf("unexpected multi-bot bindings: %#v", bindings)
		}
	})
	for _, raw := range []string{
		`[]`,
		`[{"token":"token-one","tenantSlug":"vivat-bus"},{"token":"token-two","tenantSlug":"vivat-bus"}]`,
		`[{"token":"token-one","tenantSlug":"vivat-bus"},{"token":"token-one","tenantSlug":"another-company"}]`,
		`[{"tenantSlug":"vivat-bus"}]`,
	} {
		if _, err := parseBotBindings(raw, botBinding{}); err == nil {
			t.Fatalf("parseBotBindings(%s) returned no error", raw)
		}
	}
}

func TestStateKeyIsTenantScoped(t *testing.T) {
	first := (&app{tenantID: "tenant-one"}).stateKey(12345)
	second := (&app{tenantID: "tenant-two"}).stateKey(12345)
	if first == second {
		t.Fatalf("tenant-scoped state keys must differ: %q", first)
	}
	if first != "vivat:booking-state:tenant-one:12345" {
		t.Fatalf("unexpected state key: %q", first)
	}
}

func TestWelcomeMessageUsesTenantName(t *testing.T) {
	message := welcomeMessage("North Travel")
	if !strings.Contains(message, "North Travel") || strings.Contains(message, "Vivat Bus") {
		t.Fatalf("unexpected tenant welcome message: %q", message)
	}
	if !strings.Contains(welcomeMessage("  "), "перевозчик") {
		t.Fatal("blank company name must use a neutral fallback")
	}
}

func TestNBUPaymentQRIncludesPaymentDetails(t *testing.T) {
	payment := telegramPayment{
		ID:           "12345678-1234-1234-1234-123456789abc",
		MerchantName: "Vivat Bus",
		IBAN:         "UA213223130000026007233566001",
		EDRPOU:       "12345678",
		AmountMinor:  12345,
		Currency:     "UAH",
	}
	issuedAt := time.Date(2026, time.August, 30, 9, 45, 0, 0, time.UTC)
	encoded := strings.TrimPrefix(nbuPaymentQRAt(payment, issuedAt), "https://qr.bank.gov.ua/")
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode QR payload: %v", err)
	}
	fields := strings.Split(string(decoded), "\n")
	if len(fields) != 17 {
		t.Fatalf("QR fields = %d, want 17", len(fields))
	}
	if fields[0] != "BCD" || fields[1] != "003" || fields[2] != "1" || fields[3] != "UCT" {
		t.Fatalf("unexpected QR header: %#v", fields[:4])
	}
	if fields[6] != payment.IBAN || fields[7] != "UAH123.45" || fields[8] != payment.EDRPOU || fields[9] != "SUPP/SUPP" {
		t.Fatalf("unexpected payment fields: %#v", fields)
	}
	if fields[10] != "VIVAT-12345678" || !strings.Contains(fields[11], "12345678") {
		t.Fatalf("payment identifiers are incorrect: %#v", fields[10:12])
	}
	if fields[13] != "FFFF" || fields[14] != "260830101500" || fields[15] != "260830094500" || fields[16] != "RFU" {
		t.Fatalf("unexpected QR expiration fields: %#v", fields[13:])
	}
}

func TestSupportedBanksContainAllNBUQRPriorityBanks(t *testing.T) {
	seen := make(map[string]struct{}, len(primaryBanks)+len(otherBanks))
	for _, bank := range append(primaryBanks, otherBanks...) {
		if bank.Code == "" || bank.Label == "" {
			t.Fatalf("bank entry must have a code and label: %#v", bank)
		}
		if _, duplicate := seen[bank.Code]; duplicate {
			t.Fatalf("duplicate bank code: %q", bank.Code)
		}
		seen[bank.Code] = struct{}{}
	}
	for _, code := range []string{
		"mono", "privat", "pumb", "abank", "sense", "grant", "ukrgas", "izi", "credit-dnipro",
		"globus", "rada", "credit-agricole", "otp", "vst", "idea", "pravex", "mtb", "piraeus",
		"altbank", "ukrsib", "kredo", "raif", "unex", "accord", "threequarters", "pivdennyi",
	} {
		if _, ok := seen[code]; !ok {
			t.Fatalf("missing NBU QR-compatible bank: %q", code)
		}
	}
}

func TestBankPaymentCallbacksFitTelegramLimit(t *testing.T) {
	const paymentID = "12345678-1234-1234-1234-123456789abc"
	for _, bank := range append(primaryBanks, otherBanks...) {
		callback := "pay:bank:" + bank.Code + ":" + paymentID
		if len(callback) > 64 {
			t.Fatalf("callback for %q has %d bytes, Telegram allows at most 64", bank.Code, len(callback))
		}
	}
}

func TestNBUAmount(t *testing.T) {
	for _, test := range []struct {
		payment telegramPayment
		want    string
	}{
		{payment: telegramPayment{AmountMinor: 12345, Currency: "UAH"}, want: "UAH123.45"},
		{payment: telegramPayment{AmountMinor: 120000, Currency: "UAH"}, want: "UAH1200"},
		{payment: telegramPayment{AmountMinor: 7900, Currency: "EUR"}, want: ""},
	} {
		if got := nbuAmount(test.payment); got != test.want {
			t.Fatalf("nbuAmount(%#v) = %q, want %q", test.payment, got, test.want)
		}
	}
}

func TestValidUAIBAN(t *testing.T) {
	const valid = "UA213223130000026007233566001"
	for _, value := range []string{valid, "UA21 3223 1300 0002 6007 2335 6600 1"} {
		if !validUAIBAN(value) {
			t.Fatalf("validUAIBAN(%q) = false, want true", value)
		}
	}
	for _, value := range []string{"UA003223130000026007233566001", "UA213223130000026007233566002", "UA21322313000002600723356600", "DE89370400440532013000"} {
		if validUAIBAN(value) {
			t.Fatalf("validUAIBAN(%q) = true, want false", value)
		}
	}
}

func TestMonobankReconciliationRequiresExactAmountAndReference(t *testing.T) {
	payment := pendingIBANPayment{ID: "12345678-1234-1234-1234-123456789abc", AmountMinor: 120050, Currency: "UAH"}
	valid := monobankStatementItem{ID: "statement-1", Amount: 120050, Description: "Оплата бронювання VIVAT-12345678"}
	if !matchesMonobankTransaction(valid, payment) {
		t.Fatal("exact incoming transaction did not match")
	}
	for name, transaction := range map[string]monobankStatementItem{
		"wrong amount":    {ID: "statement-2", Amount: 120000, Description: valid.Description},
		"wrong reference": {ID: "statement-3", Amount: 120050, Description: "VIVAT-87654321"},
		"outgoing":        {ID: "statement-4", Amount: -120050, Description: valid.Description},
		"hold":            {ID: "statement-5", Amount: 120050, Description: valid.Description, Hold: true},
		"missing id":      {Amount: 120050, Description: valid.Description},
	} {
		t.Run(name, func(t *testing.T) {
			if matchesMonobankTransaction(transaction, payment) {
				t.Fatal("unsafe transaction matched")
			}
		})
	}
}

func TestFormatMoneyUsesExactMinorUnits(t *testing.T) {
	for _, test := range []struct {
		minor int64
		want  string
	}{
		{minor: 120000, want: "1200.00 UAH"},
		{minor: 7900, want: "79.00 EUR"},
		{minor: -125, want: "-1.25 UAH"},
	} {
		if got := formatMoney(test.minor, strings.Fields(test.want)[1]); got != test.want {
			t.Fatalf("formatMoney(%d) = %q, want %q", test.minor, got, test.want)
		}
	}
}

func TestParsePassengerBirthDate(t *testing.T) {
	location := time.FixedZone("test", 0)
	now := time.Date(2026, time.August, 29, 12, 0, 0, 0, location)
	tests := []struct {
		name  string
		value string
		want  string
		ok    bool
	}{
		{name: "valid date", value: "07.11.1994", want: "1994-11-07", ok: true},
		{name: "maximum supported age", value: "29.08.1901", want: "1901-08-29", ok: true},
		{name: "unrealistically old date", value: "28.08.1901", ok: false},
		{name: "future date", value: "30.08.2026", ok: false},
		{name: "invalid format", value: "1994-11-07", ok: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := parsePassengerBirthDate(test.value, location, now)
			if got != test.want || ok != test.ok {
				t.Fatalf("parsePassengerBirthDate(%q) = (%q, %t), want (%q, %t)", test.value, got, ok, test.want, test.ok)
			}
		})
	}
}

func TestParseRequestDeparture(t *testing.T) {
	location := time.FixedZone("test", 2*60*60)
	now := time.Date(2026, time.August, 29, 10, 0, 0, 0, location)
	departure, ok := parseRequestDeparture("2026-08-30", "09:30", location, now)
	if !ok || departure.Format(time.RFC3339) != "2026-08-30T09:30:00+02:00" {
		t.Fatalf("valid departure = (%s, %t), want 2026-08-30T09:30:00+02:00 and true", departure.Format(time.RFC3339), ok)
	}
	for _, value := range []struct{ date, time string }{{"2026-08-29", "10:00"}, {"2026-08-29", "09:59"}, {"2026-08-30", "9:30"}, {"bad", "09:30"}} {
		if _, ok := parseRequestDeparture(value.date, value.time, location, now); ok {
			t.Fatalf("parseRequestDeparture(%q, %q) must be rejected", value.date, value.time)
		}
	}
}

func TestCalendarCallbacksAndDateRange(t *testing.T) {
	location := time.FixedZone("test", 2*60*60)
	now := time.Date(2026, time.August, 29, 10, 0, 0, 0, location)

	kind, flow, value, ok := parseCalendarCallback("cal:d:r:20260829")
	if !ok || kind != "d" || flow != "r" || value != "20260829" {
		t.Fatalf("parseCalendarCallback returned (%q, %q, %q, %t)", kind, flow, value, ok)
	}
	for _, raw := range []string{"cal:x", "cal:d:x:20260829", "cal:d:r", "book:trip"} {
		if _, _, _, ok := parseCalendarCallback(raw); ok {
			t.Fatalf("parseCalendarCallback(%q) must be rejected", raw)
		}
	}

	if month, ok := parseCalendarMonth("2027-08", location, now); !ok || month.Format("2006-01") != "2027-08" {
		t.Fatalf("valid calendar month = (%s, %t)", month.Format("2006-01"), ok)
	}
	for _, value := range []string{"2026-07", "2027-09", "invalid"} {
		if _, ok := parseCalendarMonth(value, location, now); ok {
			t.Fatalf("parseCalendarMonth(%q) must be rejected", value)
		}
	}

	if day, ok := parseCalendarDate("20260829", location, now); !ok || day.Format("2006-01-02") != "2026-08-29" {
		t.Fatalf("valid calendar date = (%s, %t)", day.Format("2006-01-02"), ok)
	}
	for _, value := range []string{"20260828", "20270901", "invalid"} {
		if _, ok := parseCalendarDate(value, location, now); ok {
			t.Fatalf("parseCalendarDate(%q) must be rejected", value)
		}
	}
}

func TestCalendarShowsMonthBeforeWeekdays(t *testing.T) {
	location := time.UTC
	now := time.Now().In(location)
	app := app{timezone: location}
	state := bookingState{CalendarMonth: now.Format("2006-01")}

	_, markup := app.calendarMarkup(state, "r")
	if len(markup.InlineKeyboard) < 2 {
		t.Fatalf("calendar has %d rows, want at least 2", len(markup.InlineKeyboard))
	}
	monthRow := markup.InlineKeyboard[0]
	weekdayRow := markup.InlineKeyboard[1]
	if len(monthRow) != 3 || monthRow[1].Text != monthNameRU(now.Month())+" "+strconv.Itoa(now.Year()) {
		t.Fatalf("first row must contain current month navigation, got %#v", monthRow)
	}
	if len(weekdayRow) != 7 || weekdayRow[0].Text != "Пн" || weekdayRow[6].Text != "Вс" {
		t.Fatalf("second row must contain weekdays, got %#v", weekdayRow)
	}
}

func TestTelegramBookingCancellationEligibility(t *testing.T) {
	now := time.Date(2026, time.August, 29, 10, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name string
		item customerTrip
		want bool
	}{
		{name: "future cash booking", item: customerTrip{Status: "cash_on_boarding", TripStatus: "assigned", StartsAt: now.Add(time.Hour)}, want: true},
		{name: "future paid booking", item: customerTrip{Status: "confirmed", TripStatus: "new", StartsAt: now.Add(time.Hour)}, want: true},
		{name: "past departure", item: customerTrip{Status: "cash_on_boarding", TripStatus: "assigned", StartsAt: now.Add(-time.Minute)}},
		{name: "started trip", item: customerTrip{Status: "cash_on_boarding", TripStatus: "in_progress", StartsAt: now.Add(time.Hour)}},
		{name: "cancelled booking", item: customerTrip{Status: "cancelled", TripStatus: "assigned", StartsAt: now.Add(time.Hour)}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := canCancelTelegramBooking(test.item, now); got != test.want {
				t.Fatalf("canCancelTelegramBooking() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestValidBookingID(t *testing.T) {
	for _, value := range []string{
		"12345678-1234-1234-1234-123456789abc",
		"ABCDEF12-1234-1234-1234-123456789ABC",
	} {
		if !validBookingID(value) {
			t.Fatalf("validBookingID(%q) = false, want true", value)
		}
	}
	for _, value := range []string{"", "12345678-1234-1234-1234-123456789ab", "12345678-1234-1234-1234-123456789abz", "123456781234-1234-1234-123456789abc"} {
		if validBookingID(value) {
			t.Fatalf("validBookingID(%q) = true, want false", value)
		}
	}
}

func TestBookingStatusLabel(t *testing.T) {
	if got := bookingStatusLabel("cash_on_boarding"); got != "оплата при посадке" {
		t.Fatalf("cash status = %q", got)
	}
	if got := bookingStatusLabel("unexpected"); got != "unexpected" {
		t.Fatalf("fallback status = %q", got)
	}
}

func TestFormatTripStatusNotificationIncludesOperationalDetails(t *testing.T) {
	text := formatTripStatusNotification(telegramoutbox.TripStatusPayload{
		Status:      "in_progress",
		Origin:      "Варшава",
		Destination: "Киев",
		StartsAt:    time.Date(2026, 8, 29, 8, 30, 0, 0, time.UTC),
		Vehicle:     "Mercedes Sprinter",
		Driver:      "Андрей П.",
		DriverPhone: "+380670000001",
	}, time.UTC)
	for _, expected := range []string{"Варшава → Киев", "рейс отправился", "29.08.2026 08:30", "Mercedes Sprinter", "+380670000001"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("notification %q does not contain %q", text, expected)
		}
	}
}

func TestFormatIndividualTransferRequestStatusNotification(t *testing.T) {
	text := formatIndividualTransferRequestStatusNotification(telegramoutbox.IndividualTransferRequestPayload{
		Status:               "in_progress",
		Origin:               "Краков",
		Destination:          "Львов",
		RequestedDepartureAt: time.Date(2026, 8, 30, 9, 30, 0, 0, time.UTC),
	}, time.UTC)
	for _, expected := range []string{"Индивидуальный трансфер", "Краков → Львов", "30.08.2026 в 09:30", "принял заявку в работу"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("notification %q does not contain %q", text, expected)
		}
	}
}
