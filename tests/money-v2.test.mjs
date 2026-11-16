import test from "node:test"
import assert from "node:assert/strict"
import {
  parseMoneyInput,
  allocatedMinor,
  datedMoneyRate,
  moneyRequestIdentity,
  moneyOperationTimestamp,
} from "../lib/money-v2.ts"

test("native cash amounts preserve cents exactly and reject precision loss", () => {
  assert.equal(parseMoneyInput("4400"), 440000)
  assert.equal(parseMoneyInput("0,01"), 1)
  assert.equal(parseMoneyInput(" 80.10 "), 8010)
  for (const value of [
    "",
    "0",
    "-1",
    "1.001",
    "1e3",
    "Infinity",
    "4 400",
    "10.",
    "90071992547409.92",
  ])
    assert.equal(parseMoneyInput(value), null, value)
})
test("cross-currency allocation rounds only the result and never changes the quote", () => {
  assert.equal(allocatedMinor(440000, "0.0181818182"), 8000)
  assert.equal(allocatedMinor(1, "0.5"), 1)
  assert.equal(allocatedMinor(100, "0"), null)
  assert.equal(allocatedMinor(100, "1e3"), null)
  assert.equal(allocatedMinor(Number.MAX_SAFE_INTEGER, "2"), null)
})
test("historical rate selection never silently falls back to another day", () => {
  const rates = [
    {
      date: "2026-11-01",
      currency: "EUR",
      rateToUAH: "55",
      source: "Monobank",
    },
    {
      date: "2026-11-01",
      currency: "USD",
      rateToUAH: "44",
      source: "Monobank",
    },
  ]
  assert.equal(datedMoneyRate("USD", "EUR", "2026-11-01", rates), "0.8")
  assert.equal(datedMoneyRate("EUR", "UAH", "2026-11-01", rates), "55")
  assert.equal(datedMoneyRate("EUR", "UAH", "2026-11-02", rates), null)
  assert.equal(datedMoneyRate("PLN", "PLN", "2026-11-02", rates), "1")
})
test("a failed command keeps its key, changed data receives a new key", () => {
  let counter = 0
  const id = () => String(++counter)
  const first = moneyRequestIdentity(
    null,
    { action: "receive", amountMinor: 440000, currency: "UAH" },
    id
  )
  assert.equal(
    moneyRequestIdentity(
      first,
      { currency: "UAH", amountMinor: 440000, action: "receive" },
      id
    ),
    first
  )
  assert.equal(
    moneyRequestIdentity(
      first,
      { action: "receive", amountMinor: 450000, currency: "UAH" },
      id
    ).requestId,
    "2"
  )
})
test("operation dates reject impossible and future civil dates", () => {
  const now = new Date("2026-11-16T16:00:00Z")
  assert.equal(moneyOperationTimestamp("2026-02-31", now), null)
  assert.equal(moneyOperationTimestamp("2026-11-17", now), null)
  assert.equal(moneyOperationTimestamp("2026-11-16", now), now.toISOString())
  assert.ok(moneyOperationTimestamp("2026-11-15", now))
})
