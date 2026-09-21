"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  CalendarDays,
  SlidersHorizontal,
  Users,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { entityDetailHref, valueLabels } from "@/lib/entity-details"
import { formatEntityDate, statusToneClass } from "@/lib/entity-columns"
import type { EntityCollection } from "@/lib/entity-views"

export type EntityRelatedRecord = {
  id: string
  entity: EntityCollection
  label: string
  meta?: Record<string, unknown>
}

const metricOrder = [
  "status",
  "occupied_seats",
  "seats",
  "capacity",
  "starts_at",
  "created_at",
  "source",
  "payment_status",
  "payment_method",
]

const metricLabels: Record<string, string> = {
  status: "Статус",
  occupied_seats: "Занято мест",
  seats: "Мест",
  capacity: "Вместимость",
  starts_at: "Отправление",
  created_at: "Создано",
  source: "Источник",
  payment_status: "Статус оплаты",
  payment_method: "Метод оплаты",
}

function tone(value: unknown) {
  const normalized = String(value)
  if (["confirmed", "completed", "paid", "closed"].includes(normalized))
    return "success"
  if (["cancelled", "failed", "expired"].includes(normalized)) return "danger"
  return "info"
}

function availableMetricKeys(records: EntityRelatedRecord[]) {
  const keys = new Set(
    records.flatMap((record) => Object.keys(record.meta ?? {}))
  )
  return [
    ...metricOrder.filter((key) => keys.has(key)),
    ...[...keys].filter((key) => !metricOrder.includes(key)).sort(),
  ]
}

function recordCountLabel(count: number) {
  const form = new Intl.PluralRules("ru-RU").select(count)
  return `${count} ${form === "one" ? "запись" : form === "few" ? "записи" : "записей"}`
}

export function EntityRelatedRecords({
  ownerEntity,
  records,
  timezone,
}: {
  ownerEntity: EntityCollection
  records: EntityRelatedRecord[]
  timezone: string
}) {
  const available = React.useMemo(() => availableMetricKeys(records), [records])
  const storageKey = `entity-detail-related-fields:${ownerEntity}`
  const subscribe = React.useCallback((listener: () => void) => {
    window.addEventListener("storage", listener)
    window.addEventListener("vivat-related-fields", listener)
    return () => {
      window.removeEventListener("storage", listener)
      window.removeEventListener("vivat-related-fields", listener)
    }
  }, [])
  const getSnapshot = React.useCallback(
    () => localStorage.getItem(storageKey),
    [storageKey]
  )
  const storedSelection = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => null
  )
  const shown = React.useMemo(() => {
    try {
      const stored = JSON.parse(storedSelection ?? "null")
      if (Array.isArray(stored)) {
        return stored.filter(
          (key): key is string =>
            typeof key === "string" && available.includes(key)
        )
      }
    } catch {
      // Ignore malformed browser preferences and use the available fields.
    }
    return available
  }, [available, storedSelection])

  function toggleMetric(key: string, checked: boolean) {
    const next = checked
      ? [...shown, key].filter(
          (value, index, values) => values.indexOf(value) === index
        )
      : shown.filter((value) => value !== key)
    localStorage.setItem(storageKey, JSON.stringify(next))
    window.dispatchEvent(new Event("vivat-related-fields"))
  }

  if (!records.length)
    return (
      <p className="text-sm text-muted-foreground">
        Связанных записей пока нет.
      </p>
    )

  return (
    <div className="space-y-3">
      {available.length ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {recordCountLabel(records.length)}
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" variant="ghost" className="h-8 rounded-lg" />
              }
            >
              <SlidersHorizontal className="size-3.5" />
              Поля
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Показывать в карточках</DropdownMenuLabel>
                {available.map((key) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={shown.includes(key)}
                    onCheckedChange={(checked) => toggleMetric(key, checked)}
                  >
                    {metricLabels[key] ?? key.replaceAll("_", " ")}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      <div className="grid gap-2">
        {records.map((record, index) => {
          const meta = record.meta ?? {}
          return (
            <Link
              key={`${record.entity}:${record.id}:${index}`}
              href={entityDetailHref(record.entity, record.id)}
              className="group rounded-xl border border-border bg-background/35 p-3 transition-colors hover:border-primary/35 hover:bg-accent/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="truncate text-sm font-semibold">
                  {record.label}
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              {shown.some((key) => meta[key] !== undefined) ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                  {shown.map((key) => {
                    const value = meta[key]
                    if (value === null || value === undefined || value === "")
                      return null
                    if (key === "status" || key === "payment_status")
                      return (
                        <Badge
                          key={key}
                          variant="secondary"
                          className={statusToneClass(tone(value))}
                        >
                          {valueLabels[String(value)] ?? String(value)}
                        </Badge>
                      )
                    if (key === "occupied_seats")
                      return (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1.5"
                        >
                          <Users className="size-3.5" />
                          Занято {String(value)}
                          {shown.includes("capacity") &&
                          meta.capacity !== undefined
                            ? ` / ${String(meta.capacity)}`
                            : ""}
                        </span>
                      )
                    if (key === "capacity" && shown.includes("occupied_seats"))
                      return null
                    if (key === "seats" || key === "capacity")
                      return (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1.5"
                        >
                          <Users className="size-3.5" />
                          {metricLabels[key]}: {String(value)}
                        </span>
                      )
                    if (key.endsWith("_at"))
                      return (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1.5"
                        >
                          <CalendarDays className="size-3.5" />
                          {formatEntityDate(String(value), timezone)}
                        </span>
                      )
                    return (
                      <span key={key}>
                        {metricLabels[key] ?? key.replaceAll("_", " ")}:{" "}
                        {valueLabels[String(value)] ?? String(value)}
                      </span>
                    )
                  })}
                </div>
              ) : null}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
