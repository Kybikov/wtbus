export type StatisticsMetrics = {
  bookings: number
  passengers: number
  confirmed: number
  cancelled: number
  expired: number
  trips: number
  completedTrips: number
  cancelledTrips: number
  capacity: number
  occupiedSeats: number
}
export type StatisticsMoney = {
  revenueMinor: number
  expensesMinor: number
  refundsMinor: number
}
export type StatisticsReport = {
  from: string
  to: string
  today: string
  timezone: string
  previousFrom: string
  previousTo: string
  metrics: StatisticsMetrics
  previous: StatisticsMetrics
  daily: (StatisticsMetrics & { date: string })[]
  periods: (StatisticsMetrics & { key: string; from: string; to: string })[]
  statuses: { key: string; label: string; color?: string; count: number }[]
  sources: { key: string; label: string; count: number }[]
  routes: {
    label: string
    trips: number
    passengers: number
    capacity: number
  }[]
  finance?: {
    currency: string
    totals: StatisticsMoney
    previous: StatisticsMoney
    daily: (StatisticsMoney & { date: string })[]
    periods: (StatisticsMoney & { key: string })[]
    methods: { key: string; amountMinor: number }[]
    categories: { key: string; amountMinor: number }[]
  }
}

// Civil dates are deliberately independent of the browser's timezone and DST.
export function shiftStatisticsDate(value: string, days: number) {
  const date = new Date(value + "T12:00:00Z")
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
export function isStatisticsDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + "T12:00:00Z")
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= "1900-01-01" &&
    value <= "2100-12-31"
  )
}
export function statisticsPreset(today: string, preset: string) {
  if (preset === "lastMonth") return statisticsMonth(today, -1)
  if (preset === "year")
    return { from: today.slice(0, 4) + "-01-01", to: today }
  if (preset === "lastYear") {
    const year = Number(today.slice(0, 4)) - 1
    return { from: `${year}-01-01`, to: `${year}-12-31` }
  }
  const days: Record<string, number> = {
    today: 1,
    week: 7,
    "30days": 30,
    "90days": 90,
    "180days": 180,
    "365days": 365,
  }
  return {
    from:
      preset === "month"
        ? today.slice(0, 7) + "-01"
        : shiftStatisticsDate(today, 1 - (days[preset] ?? 1)),
    to: today,
  }
}
export const statisticsPeriodPresets = [
  { key: "month", label: "Этот месяц" },
  { key: "lastMonth", label: "Прошлый месяц" },
  { key: "today", label: "Сегодня" },
  { key: "week", label: "7 дней" },
  { key: "30days", label: "30 дней" },
  { key: "90days", label: "90 дней" },
  { key: "180days", label: "180 дней" },
  { key: "365days", label: "365 дней" },
  { key: "year", label: "Этот год" },
  { key: "lastYear", label: "Прошлый год" },
]
export function statisticsPeriodLabel(
  today: string | undefined,
  from: string,
  to: string
) {
  if (!isStatisticsDate(from) || !isStatisticsDate(to)) return "Период"
  const preset =
    today &&
    statisticsPeriodPresets.find((item) => {
      const range = statisticsPreset(today, item.key)
      return from === range.from && to === range.to
    })
  if (preset) return preset.label
  if (from.slice(5) === "01-01" && to === from.slice(0, 4) + "-12-31")
    return from.slice(0, 4) + " год"
  if (from === statisticsMonth(from).from && to === statisticsMonth(from).to) {
    const label = new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(from + "T12:00:00Z"))
    return label[0].toUpperCase() + label.slice(1)
  }
  const short = (value: string) =>
    `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(2, 4)}`
  return from === to ? short(from) : `${short(from)} — ${short(to)}`
}
export function statisticsMonth(value: string, offset = 0) {
  const date = new Date(value.slice(0, 7) + "-01T12:00:00Z")
  date.setUTCMonth(date.getUTCMonth() + offset)
  const from = date.toISOString().slice(0, 10)
  date.setUTCMonth(date.getUTCMonth() + 1)
  date.setUTCDate(0)
  return { from, to: date.toISOString().slice(0, 10) }
}
export function statisticsCalendar(value: string) {
  const month = statisticsMonth(value)
  const weekday = new Date(month.from + "T12:00:00Z").getUTCDay()
  const first = shiftStatisticsDate(month.from, -((weekday + 6) % 7))
  const count =
    Math.ceil((((weekday + 6) % 7) + Number(month.to.slice(-2))) / 7) * 7
  return Array.from({ length: count }, (_, i) => shiftStatisticsDate(first, i))
}
export function statisticsChange(current: number, previous: number) {
  if (previous === 0)
    return current === 0 ? "Без изменений" : "Нет базы сравнения"
  const value = ((current - previous) / Math.abs(previous)) * 100
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)}%`
}
export function statisticsOccupancy(occupied: number, capacity: number) {
  return capacity > 0 ? (occupied / capacity) * 100 : null
}
export const statisticsSourceLabels: Record<string, string> = {
  web: "Сайт",
  website: "Сайт",
  site: "Сайт",
  telegram: "Telegram",
  dispatcher: "Диспетчер",
  import: "Импорт",
}
export const statisticsMethodLabels: Record<string, string> = {
  bank: "Безналичные",
  driver_cash: "Наличные у водителей",
  cash: "Касса компании",
}
export const statisticsCategoryLabels: Record<string, string> = {
  driver_pay: "Зарплата",
  payroll_tax: "Налоги на зарплату",
  amortization: "Амортизация",
  marketing: "Маркетинг",
  fuel: "Топливо",
  salary: "Зарплата",
  payroll: "Зарплата",
  tax: "Налоги",
  taxes: "Налоги",
  maintenance: "Обслуживание",
  repair: "Ремонт",
  insurance: "Страховка",
  toll: "Платные дороги",
  parking: "Парковка",
  other: "Прочее",
}
