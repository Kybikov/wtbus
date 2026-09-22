export const publicTenantPattern = /^[a-z0-9-]{3,63}$/

export function isPublicBookingPath(pathname: string) {
  return /^\/book(?:\/[a-z0-9-]{3,63})?\/?$/.test(pathname)
}

export type PublicTrip = {
  id: string
  origin: string
  destination: string
  startsAt: string
  endsAt: string
  priceMinor: number
  currency: string
  availableSeats: number
}
export type PublicField = { key: string; label: string; type: "text" | "number" | "date" | "boolean" | "select"; options: string[] }
export type PublicCatalog = { name: string; timezone: string; routes: { origin: string; destination: string }[]; fields: PublicField[]; payment: { bankTransferAvailable: boolean } }
export type PublicPayment = { status: string; checkoutToken: string; expiresAt?: string; merchantName: string; iban: string; edrpou: string; bankName: string; bankMfo?: string; bankEdrpou?: string; purpose: string; paymentUrl: string }
export type PublicConfirmation = { reference: string; status: string; seats: number; priceMinor: number; currency: string; payment?: PublicPayment }

export function travelMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100)
}
export function travelTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(value))
}
export function travelDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", timeZone: timezone }).format(new Date(value))
}
export function travelDay(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).formatToParts(value)
  const part = (name: string) => parts.find((item) => item.type === name)?.value
  return `${part("year")}-${part("month")}-${part("day")}`
}
export function departureMinute(trip: PublicTrip, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).formatToParts(new Date(trip.startsAt))
  return Number(parts.find((part) => part.type === "hour")?.value) * 60 + Number(parts.find((part) => part.type === "minute")?.value)
}

export async function publicBookingFetch<T>(slug: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/public/${encodeURIComponent(slug)}/${path}`, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Не вдалося виконати запит. Спробуйте ще раз.")
  return data as T
}
