export const moneyCurrencies = ["UAH", "PLN", "EUR", "USD"] as const
export type MoneyCurrency = (typeof moneyCurrencies)[number]
export type MoneyWallet = {
  accountId: string
  ownerType: "company" | "member" | "driver" | "system"
  ownerId: string
  name: string
  currency: MoneyCurrency
  balanceMinor: number
  reservedMinor: number
  availableMinor: number
  canSpend?: boolean
}
export type MoneyTransfer = {
  id: string
  accountId: string
  recipientAccountId: string
  fromName: string
  toName: string
  amountMinor: number
  currency: MoneyCurrency
  status: "pending" | "accepted" | "rejected" | "cancelled"
  occurredAt: string
  createdAt: string
  description: string
  canAccept?: boolean
  canReject?: boolean
  canCancel?: boolean
}
export type MoneyExpense = {
  id: string
  accountId: string
  amountMinor: number
  currency: MoneyCurrency
  tripId?: string
  tripName?: string
  category: string
  description: string
  occurredAt: string
  actorName: string
  reversed?: boolean
  canReverse?: boolean
}
export type MoneyReceipt = {
  id: string
  bookingId: string
  tripId?: string
  amountMinor: number
  currency: MoneyCurrency
  settledMinor: number
  bookingCurrency?: MoneyCurrency
  rate: string
  occurredAt: string
  collectorName: string
  description?: string
  reversed?: boolean
  canReverse?: boolean
}
export type HistoricalRate = {
  date: string
  currency: MoneyCurrency
  rateToUAH: string
  source: string
}
export type MoneyWorkspaceData = {
  wallets: MoneyWallet[]
  transfers: MoneyTransfer[]
  expenses: MoneyExpense[]
  receipts: MoneyReceipt[]
  members: { id: string; name: string }[]
  trips: { id: string; label: string; currency: MoneyCurrency }[]
  rates: HistoricalRate[]
  membershipId: string
  canManage: boolean
  isOwner: boolean
}
export type BookingPaymentData = {
  bookingId: string
  tripId: string
  passengerName?: string
  recordNumber?: string
  currency: MoneyCurrency
  priceMinor: number
  settledMinor: number
  outstandingMinor: number
  receipts: MoneyReceipt[]
  canReceive: boolean
  disabledReason: string
}
export type TripProfit = {
  label?: string
  startsAt?: string
  status?: string
  tripId: string
  currency: MoneyCurrency
  revenueMinor: number
  expenseMinor: number
  profitMinor: number
  outstandingMinor: number
  rateMissing: boolean
}

export function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
  }).format(minor / 100)
}

// Do not round entered amounts: additional decimal places are an error.
export function parseMoneyInput(text: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim())
  if (!match || match[1].length > 14) return null
  const amount =
    BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"))
  if (amount <= BigInt(0) || amount > BigInt(Number.MAX_SAFE_INTEGER))
    return null
  return Number(amount)
}

export function parsePositiveRate(
  text: string
): { units: bigint; scale: bigint } | null {
  const match = /^(\d{1,12})(?:[.,](\d{1,12}))?$/.exec(text.trim())
  if (!match) return null
  const fraction = match[2] ?? ""
  const scale = BigInt(10) ** BigInt(fraction.length)
  const units = BigInt(match[1]) * scale + BigInt(fraction || "0")
  return units > BigInt(0) ? { units, scale } : null
}

export function allocatedMinor(
  nativeMinor: number,
  rate: string
): number | null {
  const parsed = parsePositiveRate(rate)
  if (!parsed || !Number.isSafeInteger(nativeMinor) || nativeMinor < 0)
    return null
  const numerator = BigInt(nativeMinor) * parsed.units
  const amount = (numerator + parsed.scale / BigInt(2)) / parsed.scale
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null
}

// Rate is target units for one native unit. UAH is the quote denominator.
export function datedMoneyRate(
  from: MoneyCurrency,
  to: MoneyCurrency,
  date: string,
  rates: HistoricalRate[]
): string | null {
  if (from === to) return "1"
  const find = (currency: MoneyCurrency) =>
    currency === "UAH"
      ? { units: BigInt(1), scale: BigInt(1) }
      : parsePositiveRate(
          rates.find((row) => row.currency === currency && row.date === date)
            ?.rateToUAH ?? ""
        )
  const source = find(from),
    target = find(to)
  if (!source || !target) return null
  // Match the precision used by the server when it applies the rate.
  const scale = 12
  const precision = BigInt(10) ** BigInt(scale)
  const denominator = source.scale * target.units
  const units =
    (source.units * target.scale * precision + denominator / BigInt(2)) /
    denominator
  if (units === BigInt(0)) return null
  const whole = units / precision
  const fraction = String(units % precision)
    .padStart(scale, "0")
    .replace(/0+$/, "")
  return String(whole) + (fraction ? "." + fraction : "")
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])
    )
  return value
}
export type MoneyRequestIdentity = { fingerprint: string; requestId: string }
export function moneyRequestIdentity(
  previous: MoneyRequestIdentity | null,
  payload: object,
  createId: () => string
): MoneyRequestIdentity {
  const fingerprint = JSON.stringify(canonical(payload))
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, requestId: createId() }
}

export function localMoneyDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
export function moneyOperationTimestamp(
  day: string,
  now = new Date()
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const date = new Date(`${day}T12:00:00`)
  if (
    !Number.isFinite(date.getTime()) ||
    localMoneyDay(date) !== day ||
    day > localMoneyDay(now)
  )
    return null
  return day === localMoneyDay(now) ? now.toISOString() : date.toISOString()
}
