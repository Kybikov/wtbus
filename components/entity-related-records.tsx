"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  CalendarDays,
  Link2,
  Plus,
  SlidersHorizontal,
  Users,
} from "lucide-react"
import { sessionFetch } from "@/lib/session-navigation"
import type { WorkflowStatus } from "@/components/route-status-field"
import { CardHeader, CardContent, CardTitle } from "@/components/ui/card"
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
  "starts_at",
  "occupied_seats",
  "seats",
  "capacity",
  "created_at",
  "status",
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
  createHref,
  createStatus,
  createAvailable = true,
  createBusy = false,
}: {
  ownerEntity: EntityCollection
  records: EntityRelatedRecord[]
  timezone: string
  createHref?: string
  createStatus?: string
  createAvailable?: boolean
  createBusy?: boolean
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
        return available.filter((key) => stored.includes(key))
      }
    } catch {
      // Ignore malformed browser preferences and use the available fields.
    }
    return available
  }, [available, storedSelection])

  const [statusCatalog, setStatusCatalog] = React.useState<
    Record<string, WorkflowStatus[]>
  >({})
  const workflowTypes = [
    ...new Set(
      records
        .map(
          (record) =>
            (
              ({
                routes: "routes",
                fleet: "vehicles",
                trips: "trips",
                bookings: "bookings",
                requests: "requests",
              }) as Partial<Record<EntityCollection, string>>
            )[record.entity]
        )
        .filter(Boolean)
        .concat(createHref ? ["routes"] : [])
    ),
  ]
    .sort()
    .join(",")
  React.useEffect(() => {
    const controller = new AbortController()
    const types = workflowTypes.split(",").filter(Boolean)
    const refresh = () => {
      for (const entity of types)
        void sessionFetch(`/api/workflow-statuses?entity=${entity}`, {
          signal: controller.signal,
          cache: "no-store",
        })
          .then(async (response) => {
            const payload = await response.json()
            if (
              response.ok &&
              Array.isArray(payload?.items) &&
              !controller.signal.aborted
            )
              setStatusCatalog((current) => ({
                ...current,
                [entity]: payload.items,
              }))
          })
          .catch(() => undefined)
    }
    const updates = types.map((entity) => {
      const name = `workflow-statuses-changed:${entity}`
      const listener = (event: Event) => {
        const item = (event as CustomEvent<WorkflowStatus>).detail
        if (item)
          setStatusCatalog((current) => ({
            ...current,
            [entity]: [
              ...(current[entity] ?? []).filter((old) => old.key !== item.key),
              item,
            ],
          }))
      }
      window.addEventListener(name, listener)
      return () => window.removeEventListener(name, listener)
    })
    refresh()
    window.addEventListener("focus", refresh)
    return () => {
      controller.abort()
      window.removeEventListener("focus", refresh)
      updates.forEach((remove) => remove())
    }
  }, [workflowTypes])

  function toggleMetric(key: string, checked: boolean) {
    const next = checked
      ? [...shown, key].filter(
          (value, index, values) => values.indexOf(value) === index
        )
      : shown.filter((value) => value !== key)
    localStorage.setItem(storageKey, JSON.stringify(next))
    window.dispatchEvent(new Event("vivat-related-fields"))
  }

  const canCreate =
    !createBusy &&
    (statusCatalog.routes?.find((status) => status.key === createStatus)
      ?.isAvailable ??
      createAvailable)
  return (
    <>
      <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 border-b border-border/70">
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <Link2 aria-hidden className="size-4 text-muted-foreground" />
            Связанные записи
            <Badge
              variant="secondary"
              aria-label={recordCountLabel(records.length)}
            >
              {records.length}
            </Badge>
          </h2>
        </CardTitle>
        <div className="ml-auto flex items-center gap-1">
          {available.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Поля связанных записей"
                render={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-lg"
                  />
                }
              >
                <SlidersHorizontal className="size-3.5" />
                <span className="hidden sm:inline">Поля</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Показывать в списке</DropdownMenuLabel>
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
          ) : null}
          {createHref && (
            <Button
              aria-label="Добавить рейс по этому маршруту"
              title={
                canCreate
                  ? "Добавить рейс по этому маршруту"
                  : "Сначала включите маршрут для новых рейсов"
              }
              disabled={!canCreate}
              size="icon"
              variant="outline"
              className="size-8 rounded-lg"
              render={canCreate ? <Link href={createHref} /> : undefined}
            >
              <Plus className="size-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="@container/related min-w-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
        {!records.length && (
          <p className="py-3 text-sm text-muted-foreground">
            Связанных записей пока нет.
          </p>
        )}
        <div className="divide-y divide-border/70">
          {records.map((record, index) => {
            const meta = record.meta ?? {}
            const workflowType =
              ({ fleet: "vehicles" } as Record<string, string>)[
                record.entity
              ] ?? record.entity
            const status = (value: unknown) =>
              statusCatalog[workflowType]?.find((item) => item.key === value)
            return (
              <Link
                key={`${record.entity}:${record.id}:${index}`}
                href={entityDetailHref(record.entity, record.id)}
                className="group grid min-w-0 grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-3 gap-y-2 rounded-lg px-2 py-3.5 transition-colors hover:bg-accent/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @min-[32rem]/related:grid-cols-[minmax(7rem,1fr)_auto_1rem]"
              >
                <div className="col-start-1 row-start-1 min-w-0">
                  <span className="block text-sm font-medium [overflow-wrap:anywhere]">
                    {record.label}
                  </span>
                </div>
                {shown.some((key) => meta[key] !== undefined) ? (
                  <div className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground @min-[32rem]/related:col-start-2 @min-[32rem]/related:row-start-1 @min-[32rem]/related:justify-end">
                    {shown.map((key) => {
                      const value = meta[key]
                      if (value === null || value === undefined || value === "")
                        return null
                      if (key === "status" || key === "payment_status")
                        return (
                          <Badge
                            key={key}
                            variant="secondary"
                            className={statusToneClass(
                              status(value)?.tone ?? tone(value)
                            )}
                          >
                            {status(value)?.label ??
                              valueLabels[String(value)] ??
                              "Другой статус"}
                          </Badge>
                        )
                      if (key === "occupied_seats")
                        return (
                          <span
                            key={key}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <Users className="size-3.5" />
                            Занято {String(value)}
                            {shown.includes("capacity") &&
                            meta.capacity !== undefined
                              ? ` / ${String(meta.capacity)}`
                              : ""}
                          </span>
                        )
                      if (
                        key === "capacity" &&
                        shown.includes("occupied_seats")
                      )
                        return null
                      if (key === "seats" || key === "capacity")
                        return (
                          <span
                            key={key}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <Users className="size-3.5" />
                            {metricLabels[key]}: {String(value)}
                          </span>
                        )
                      if (key.endsWith("_at"))
                        return (
                          <span
                            key={key}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap"
                            title={formatEntityDate(String(value), timezone)}
                          >
                            <CalendarDays className="size-3.5" />
                            {new Intl.DateTimeFormat("ru-RU", {
                              timeZone: timezone,
                              dateStyle: "short",
                              timeStyle: "short",
                            }).format(new Date(String(value)))}
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
                <ArrowUpRight
                  aria-hidden
                  className="col-start-2 row-span-2 row-start-1 size-3.5 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 @min-[32rem]/related:col-start-3 @min-[32rem]/related:row-span-1"
                />
              </Link>
            )
          })}
        </div>
      </CardContent>
    </>
  )
}
