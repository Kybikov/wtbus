package ibanpayment

import (
	"strings"
	"testing"
	"time"
)

func TestPaymentPayload(t *testing.T) {
	details := Details{PaymentID: "12345678-1234-1234-1234-123456789abc", Merchant: "ФОП Test", IBAN: "UA59 999999 0000000000000000001", EDRPOU: "0000000000", AmountMinor: 120050, Currency: "UAH"}
	if got := Reference(details.PaymentID); got != "VIVAT-12345678" {
		t.Fatalf("reference = %q", got)
	}
	if got := Purpose(details.PaymentID); got != "Оплата бронювання VIVAT-12345678" {
		t.Fatalf("purpose = %q", got)
	}
	if !ValidUAIBAN(details.IBAN) || ValidUAIBAN("UA123") {
		t.Fatal("IBAN validation failed")
	}
	url := QRURL(details, time.Unix(1_700_000_000, 0))
	if !strings.HasPrefix(url, "https://qr.bank.gov.ua/") {
		t.Fatalf("unexpected QR URL: %s", url)
	}
	if png, err := PNG(details, time.Unix(1_700_000_000, 0), 256); err != nil || len(png) < 100 {
		t.Fatalf("QR PNG was not generated: %v", err)
	}
}
