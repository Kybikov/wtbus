import test from "node:test"
import assert from "node:assert/strict"
import { restorePublicCheckout, publicPaymentState } from "../lib/public-checkout-session.ts"

const now = Date.parse("2026-10-21T10:00:00Z")
function receipt() {
  return {
    savedAt: now,
    trip: { id: "12345678-1234-1234-1234-123456789abc", origin: "Kyiv", destination: "Lviv", startsAt: "2026-10-22T08:00:00Z", endsAt: "2026-10-22T16:00:00Z", priceMinor: 125000, currency: "UAH", availableSeats: 8 },
    confirmation: { reference: "87654321-1234-1234-1234-123456789abc", status: "awaiting_payment", seats: 2, priceMinor: 250000, currency: "UAH", payment: { status: "pending", checkoutToken: "a".repeat(43), expiresAt: "2026-10-21T10:30:00Z", merchantName: "QA", iban: "UA599999990000000000000000001", edrpou: "0000000000", bankName: "QA", purpose: "VIVAT-TEST", paymentUrl: "https://qr.bank.gov.ua/test" } },
  }
}
test("a mobile bank return restores only its scoped receipt, without passenger personal data", () => {
  const value = receipt()
  value.confirmation.passengers = [{ firstName: "Private", birthDate: "1990-01-01" }]
  value.confirmation.phone = "+380500000000"
  const saved = restorePublicCheckout(JSON.stringify(value), now)
  assert.equal(saved.confirmation.payment.checkoutToken, value.confirmation.payment.checkoutToken)
  assert.equal(saved.confirmation.seats, 2)
  assert.equal(JSON.stringify(saved).includes("Private"), false)
  assert.equal(JSON.stringify(saved).includes("+380500000000"), false)
})
test("old, malformed and unsafe saved checkouts cannot restore payment links", () => {
  assert.equal(restorePublicCheckout("not json", now), null)
  assert.equal(restorePublicCheckout(JSON.stringify(receipt()), now + 86400001), null)
  const unsafe = receipt()
  unsafe.confirmation.payment.paymentUrl = "javascript:alert(1)"
  assert.equal(restorePublicCheckout(JSON.stringify(unsafe), now), null)
  unsafe.confirmation.payment.paymentUrl = "https://attacker.test/payment"
  assert.equal(restorePublicCheckout(JSON.stringify(unsafe), now), null)
})
test("a bank checkout stops accepting payment at its deadline or cancellation, including a cancelled paid booking", () => {
  const { confirmation } = receipt()
  assert.equal(publicPaymentState(confirmation, now), "pending")
  assert.equal(publicPaymentState(confirmation, now + 1800000), "expired")
  confirmation.payment.status = "paid"
  confirmation.status = "confirmed"
  assert.equal(publicPaymentState(confirmation, now + 1800001), "paid")
  confirmation.status = "cancelled"
  assert.equal(publicPaymentState(confirmation, now), "cancelled")
  confirmation.status = "completed"
  confirmation.payment.status = "pending"
  assert.equal(publicPaymentState(confirmation, now), "cancelled")
})
