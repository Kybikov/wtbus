import type { PublicConfirmation, PublicTrip } from "./public-booking"

export type SavedPublicCheckout = {
  savedAt: number
  trip: PublicTrip
  confirmation: PublicConfirmation
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object"
const amount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0
const date = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value))

// Only a receipt and its access token survive a mobile bank-app round trip.
// Passenger names, dates of birth and contact details are never persisted here.
export function restorePublicCheckout(
  raw: string | null,
  now = Date.now()
): SavedPublicCheckout | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null")
    if (
      !record(value) ||
      typeof value.savedAt !== "number" ||
      value.savedAt > now ||
      now - value.savedAt > 24 * 60 * 60 * 1000 ||
      !record(value.trip) ||
      !record(value.confirmation)
    )
      return null
    const t = value.trip,
      c = value.confirmation
    if (
      typeof t.id !== "string" ||
      !uuid.test(t.id) ||
      typeof t.origin !== "string" ||
      typeof t.destination !== "string" ||
      !date(t.startsAt) ||
      !date(t.endsAt) ||
      !amount(t.priceMinor) ||
      !["UAH", "EUR", "USD", "PLN"].includes(String(t.currency))
    )
      return null
    if (
      typeof c.reference !== "string" ||
      !uuid.test(c.reference) ||
      typeof c.status !== "string" ||
      !Number.isInteger(c.seats) ||
      Number(c.seats) < 1 ||
      Number(c.seats) > 20 ||
      !amount(c.priceMinor) ||
      c.currency !== t.currency
    )
      return null
    const confirmation: PublicConfirmation = {
      reference: c.reference,
      status: c.status,
      seats: Number(c.seats),
      priceMinor: c.priceMinor,
      currency: String(c.currency),
    }
    if (c.payment !== undefined) {
      const p = c.payment
      if (
        !record(p) ||
        typeof p.checkoutToken !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(p.checkoutToken) ||
        ![
          "status",
          "merchantName",
          "iban",
          "edrpou",
          "bankName",
          "purpose",
          "paymentUrl",
        ].every((key) => typeof p[key] === "string") ||
        new URL(String(p.paymentUrl)).origin !== "https://qr.bank.gov.ua" ||
        (p.expiresAt !== undefined && !date(p.expiresAt))
      )
        return null
      confirmation.payment = {
        status: String(p.status),
        checkoutToken: p.checkoutToken,
        merchantName: String(p.merchantName),
        iban: String(p.iban),
        edrpou: String(p.edrpou),
        bankName: String(p.bankName),
        purpose: String(p.purpose),
        paymentUrl: String(p.paymentUrl),
        ...(typeof p.bankMfo === "string" ? { bankMfo: p.bankMfo } : {}),
        ...(typeof p.bankEdrpou === "string"
          ? { bankEdrpou: p.bankEdrpou }
          : {}),
        ...(typeof p.expiresAt === "string" ? { expiresAt: p.expiresAt } : {}),
      }
    }
    return {
      savedAt: value.savedAt,
      trip: {
        id: t.id,
        origin: t.origin,
        destination: t.destination,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        priceMinor: t.priceMinor,
        currency: String(t.currency),
        availableSeats: 0,
      },
      confirmation,
    }
  } catch {
    return null
  }
}

export function publicPaymentState(
  confirmation: PublicConfirmation | null,
  now = Date.now()
): "pending" | "paid" | "expired" | "cancelled" | "cash" {
  if (["cancelled", "expired"].includes(confirmation?.status ?? ""))
    return confirmation?.status === "expired" ? "expired" : "cancelled"
  if (!confirmation?.payment) return "cash"
  if (confirmation.payment.status === "paid") return "paid"
  if (confirmation.status !== "awaiting_payment") return "cancelled"
  if (["cancelled", "failed", "refunded"].includes(confirmation.payment.status))
    return "cancelled"
  if (
    confirmation.payment.expiresAt &&
    Date.parse(confirmation.payment.expiresAt) <= now
  )
    return "expired"
  return "pending"
}
