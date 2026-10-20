"use client"

import { ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatEntityDate, statusToneClass } from "@/lib/entity-columns"
import { valueLabels } from "@/lib/entity-details"
import { activityFields } from "@/lib/activity-labels"
import type { ActivityChange } from "@/lib/activity-changes"

function ChangeValue({
  change,
  side,
  timezone,
}: {
  change: ActivityChange
  side: "before" | "after"
  timezone: string
}) {
  const value = change[side],
    label = change[side === "before" ? "beforeLabel" : "afterLabel"]
  const currency =
    change[side === "before" ? "beforeCurrency" : "afterCurrency"]
  const tone = change[side === "before" ? "beforeTone" : "afterTone"]
  let text: string
  if (value === null || value === "") text = "Не задано"
  else if (typeof value === "boolean")
    text =
      change.field === "is_active"
        ? value
          ? "Доступен"
          : "Недоступен"
        : value
          ? "Да"
          : "Нет"
  else if (typeof value === "number")
    text = new Intl.NumberFormat(
      "ru-RU",
      change.field.endsWith("_minor") && currency
        ? { style: "currency", currency }
        : { maximumFractionDigits: 4 }
    ).format(change.field.endsWith("_minor") ? value / 100 : value)
  else if (label) text = label
  else if (change.field.endsWith("_at") && Number.isFinite(Date.parse(value)))
    text = formatEntityDate(value, timezone)
  else if (change.field.endsWith("_id")) text = "Другая запись"
  else
    text =
      valueLabels[value] ??
      (change.field === "status" && value.startsWith("custom_")
        ? "Другой статус"
        : value)
  if (change.field === "status" && value !== null)
    return (
      <Badge
        variant="secondary"
        className={`${statusToneClass(tone)} h-auto min-h-6 max-w-full text-left whitespace-normal ${side === "before" ? "line-through opacity-65" : ""}`}
      >
        {text}
      </Badge>
    )
  return (
    <span
      className={
        side === "before"
          ? "text-muted-foreground line-through decoration-muted-foreground/60"
          : "font-medium text-foreground"
      }
    >
      {text}
    </span>
  )
}

export function ActivityChanges({
  changes,
  timezone,
}: {
  changes: ActivityChange[]
  timezone: string
}) {
  return (
    <dl className="grid min-w-0 gap-2.5">
      {changes.map((change) => (
        <div key={change.field} className="min-w-0">
          <dt className="mb-1 text-[11px] text-muted-foreground">
            {activityFields[change.field] ?? "Поле"}
          </dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 [overflow-wrap:anywhere]">
            <span className="sr-only">Было:</span>
            <ChangeValue change={change} side="before" timezone={timezone} />
            <ArrowRight
              aria-hidden
              className="size-3 shrink-0 text-muted-foreground"
            />
            <span className="sr-only">Стало:</span>
            <ChangeValue change={change} side="after" timezone={timezone} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
