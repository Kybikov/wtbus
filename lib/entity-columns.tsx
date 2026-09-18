import { Badge } from "@/components/ui/badge"
import type { EntityColumn } from "@/components/entity-data-view"
import type { EntityFilter } from "@/lib/entity-views"
import type { MetricField } from "@/lib/entity-metrics"

export function textColumn<T>(
  id: string,
  label: string,
  get: (item: T) => string | undefined | null,
  visible = true
): EntityColumn<T> {
  return {
    id,
    label,
    defaultVisible: visible,
    text: (item) => get(item) ?? "",
    value: (item) => get(item) || "—",
  }
}
export function numberColumn<T>(
  id: string,
  label: string,
  get: (item: T) => number | undefined | null,
  visible = true
): EntityColumn<T> {
  return {
    id,
    label,
    defaultVisible: visible,
    value: (item) => get(item) ?? "—",
    metric: { kind: "number", getValue: get },
    className: "tabular-nums",
  }
}
export function dateColumn<T>(
  id: string,
  label: string,
  get: (item: T) => string | undefined | null,
  timeZone: string,
  visible = true
): EntityColumn<T> {
  return {
    id,
    label,
    defaultVisible: visible,
    value: (item) => formatEntityDate(get(item), timeZone),
    metric: { kind: "date", getValue: get },
    className: "tabular-nums",
  }
}
export function moneyColumn<T>(
  id: string,
  label: string,
  get: (item: T) => number,
  currency: (item: T) => string,
  visible = true
): EntityColumn<T> {
  return {
    id,
    label,
    defaultVisible: visible,
    value: (item) =>
      new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: currency(item),
      }).format(get(item) / 100),
    metric: {
      kind: "money",
      getValue: (item) => ({
        amountMinor: get(item),
        currency: currency(item),
      }),
    },
    className: "tabular-nums",
  }
}
export type StatusOption = NonNullable<MetricField<unknown>["options"]>[number]
export function statusColumn<T>(
  id: string,
  label: string,
  get: (item: T) => string,
  options: StatusOption[]
): EntityColumn<T> {
  return {
    id,
    label,
    value: (item) => {
      const option = options.find((x) => x.value === get(item))
      return (
        <Badge variant="secondary" className={statusToneClass(option?.tone)}>
          {option?.label ?? get(item)}
        </Badge>
      )
    },
    metric: { kind: "enum", getValue: get, options },
  }
}
export function statusToneClass(tone: StatusOption["tone"]) {
  return {
    success: "bg-emerald-500/15 text-emerald-500",
    warning: "bg-amber-500/15 text-amber-500",
    danger: "bg-red-500/15 text-red-500",
    info: "bg-sky-500/15 text-sky-500",
    neutral: "bg-muted text-muted-foreground",
  }[tone ?? "neutral"]
}
export const activeOptions: StatusOption[] = [
  { value: "active", label: "Активен", tone: "success" },
  { value: "inactive", label: "Отключён", tone: "neutral" },
]
export function activeFilter<T>(get: (item: T) => boolean): EntityFilter<T> {
  return {
    id: "active",
    label: "Активность",
    options: activeOptions,
    matches: (item, value) => get(item) === (value === "active"),
  }
}
export function formatEntityDate(
  value: string | undefined | null,
  timeZone = "Europe/Warsaw"
) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—"
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: value.length > 10 ? "short" : undefined,
    timeZone: value.length === 10 ? "UTC" : timeZone,
  }).format(new Date(value))
}
