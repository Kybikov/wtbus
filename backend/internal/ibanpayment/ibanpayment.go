// Package ibanpayment builds the direct-to-IBAN payment payload shared by the
// public checkout and Telegram bot.
package ibanpayment

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

type Details struct {
	PaymentID   string
	Merchant    string
	IBAN        string
	EDRPOU      string
	Bank        string
	AmountMinor int64
	Currency    string
	Route       string
}

func NormalizeIBAN(value string) string {
	return strings.ToUpper(strings.NewReplacer(" ", "", "-", "").Replace(value))
}

func ValidUAIBAN(value string) bool {
	value = NormalizeIBAN(value)
	if len(value) != 29 || !strings.HasPrefix(value, "UA") {
		return false
	}
	rearranged := value[4:] + value[:4]
	remainder := 0
	for _, character := range rearranged {
		if character >= '0' && character <= '9' {
			remainder = (remainder*10 + int(character-'0')) % 97
			continue
		}
		if character < 'A' || character > 'Z' {
			return false
		}
		remainder = (remainder*100 + int(character-'A') + 10) % 97
	}
	return remainder == 1
}

func Reference(paymentID string) string {
	compact := strings.ToUpper(strings.ReplaceAll(paymentID, "-", ""))
	if len(compact) > 8 {
		compact = compact[:8]
	}
	return "VIVAT-" + compact
}

func Purpose(paymentID string) string {
	return "Оплата бронювання " + Reference(paymentID)
}

func QRURL(details Details, issuedAt time.Time) string {
	fields := []string{
		"BCD", "003", "1", "UCT", "", field(details.Merchant), NormalizeIBAN(details.IBAN), amount(details),
		field(details.EDRPOU), "SUPP/SUPP", Reference(details.PaymentID), field(Purpose(details.PaymentID)), "", "FFFF",
		issuedAt.Add(30 * time.Minute).Format("060102150405"), issuedAt.Format("060102150405"), "RFU",
	}
	return "https://qr.bank.gov.ua/" + base64.RawURLEncoding.EncodeToString([]byte(strings.Join(fields, "\n")))
}

func PNG(details Details, issuedAt time.Time, size int) ([]byte, error) {
	return qrcode.Encode(QRURL(details, issuedAt), qrcode.Medium, size)
}

func amount(details Details) string {
	if details.Currency != "UAH" {
		return ""
	}
	if details.AmountMinor%100 == 0 {
		return fmt.Sprintf("UAH%d", details.AmountMinor/100)
	}
	return fmt.Sprintf("UAH%d.%02d", details.AmountMinor/100, details.AmountMinor%100)
}

func field(value string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(strings.TrimSpace(value))
}
