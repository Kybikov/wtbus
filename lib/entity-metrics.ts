export type MetricOperation =
  "filled" | "empty" | "unique" | "equals" | "sum" | "average" | "min" | "max"
export type EntityMetric = {
  field: string
  operation: MetricOperation
  value?: string
}
export type MetricMoney = { amountMinor: number; currency: string }
export type MetricValue =
  string | number | boolean | null | undefined | MetricMoney | MetricMoney[]
export type MetricField<T> = {
  id: string
  label: string
  kind: "text" | "number" | "money" | "date" | "enum" | "boolean"
  getValue: (item: T) => MetricValue
  options?: {
    value: string
    label: string
    tone?: "success" | "warning" | "danger" | "info" | "neutral"
  }[]
}
export const metricLabels: Record<MetricOperation, string> = {
  filled: "Заполнено",
  empty: "Пустых",
  unique: "Разных значений",
  equals: "Количество",
  sum: "Сумма",
  average: "Среднее",
  min: "Минимум",
  max: "Максимум",
}
export const MAX_VIEW_METRICS = 12
export function metricKey(metric: EntityMetric) {
  return JSON.stringify([metric.field, metric.operation, metric.value ?? ""])
}
export function metricOperations(
  kind: MetricField<unknown>["kind"]
): MetricOperation[] {
  return [
    "filled",
    "empty",
    "unique",
    ...(kind === "number" || kind === "money"
      ? (["sum", "average", "min", "max"] as const)
      : []),
  ]
}
export function normalizeMetrics<T>(
  metrics: EntityMetric[] | undefined,
  fields: MetricField<T>[]
) {
  const seen = new Set<string>()
  return (metrics ?? [])
    .filter((metric) => {
      const field = fields.find((field) => field.id === metric.field)
      if (
        !field ||
        !(
          metricOperations(field.kind).includes(metric.operation) ||
          (metric.operation === "equals" &&
            field.options?.some((option) => option.value === metric.value))
        )
      )
        return false
      const key = metricKey(metric)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_VIEW_METRICS)
}
export function metricValue(value: unknown): MetricValue {
  return typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
    ? value
    : null
}
function present(value: MetricValue): boolean {
  if (value == null) return false
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.some(present)
  return (
    typeof value === "boolean" ||
    (Number.isFinite(value.amountMinor) && Boolean(value.currency))
  )
}
function distinctKey(value: MetricValue): string {
  if (typeof value === "string") return JSON.stringify(value.trim())
  if (Array.isArray(value)) return JSON.stringify(value.map(distinctKey).sort())
  if (value && typeof value === "object")
    return JSON.stringify([value.currency, value.amountMinor])
  return JSON.stringify(value)
}
export function calculateMetric<T>(
  items: T[],
  field: MetricField<T>,
  metric: EntityMetric
): { value: number; currency?: string }[] {
  const raw = items.map(field.getValue)
  const values = raw.filter(present)
  if (metric.operation === "filled") return [{ value: values.length }]
  if (metric.operation === "empty")
    return [{ value: raw.length - values.length }]
  if (metric.operation === "unique")
    return [{ value: new Set(values.map(distinctKey)).size }]
  if (metric.operation === "equals")
    return [
      {
        value: values.filter((value) => String(value) === metric.value).length,
      },
    ]
  const groups = new Map<string, number[]>()
  for (const value of values) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      const number =
        typeof entry === "number"
          ? entry
          : entry && typeof entry === "object"
            ? entry.amountMinor
            : undefined
      if (number === undefined || !Number.isFinite(number)) continue
      const currency = entry && typeof entry === "object" ? entry.currency : ""
      const group = groups.get(currency) ?? []
      group.push(number)
      groups.set(currency, group)
    }
  }
  if (groups.size === 0)
    return field.kind === "number" && metric.operation === "sum"
      ? [{ value: 0 }]
      : []
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, numbers]) => {
      const total = numbers.reduce((a, b) => a + b, 0)
      const value =
        metric.operation === "sum"
          ? total
          : metric.operation === "average"
            ? total / numbers.length
            : metric.operation === "min"
              ? Math.min(...numbers)
              : Math.max(...numbers)
      return {
        value: currency ? value / 100 : value,
        ...(currency ? { currency } : {}),
      }
    })
}
