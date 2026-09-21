"use client"
import * as React from "react"
import Link from "next/link"
import { ArrowUpRight, Check, LoaderCircle } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import EntityDetailContent from "@/components/app-dialog-6"
import EntityActivityTimeline from "@/components/billing-8"
import {
  EntityRelatedRecords,
  type EntityRelatedRecord,
} from "@/components/entity-related-records"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { sessionFetch } from "@/lib/session-navigation"
import {
  entityDetailHref,
  entityNames,
  entityFieldLabels,
  relationFields,
  valueLabels,
} from "@/lib/entity-details"
import { formatEntityDate, statusToneClass } from "@/lib/entity-columns"
import type { EntityCollection } from "@/lib/entity-views"

type Detail = {
  item: Record<string, unknown>
  timezone: string
  related: EntityRelatedRecord[]
  activity: { action: string; actor: string; kind: string; createdAt: string }[]
}
type EditableField = {
  key: string
  type?: "text" | "number" | "money" | "boolean" | "select"
  options?: { value: string; label: string }[]
}
const editableFields: Partial<Record<EntityCollection, EditableField[]>> = {
  routes: [
    { key: "name" },
    { key: "origin_name" },
    { key: "destination_name" },
    {
      key: "currency",
      type: "select",
      options: [
        { value: "EUR", label: "EUR" },
        { value: "UAH", label: "UAH" },
      ],
    },
    { key: "default_price_minor", type: "money" },
    {
      key: "default_pricing_mode",
      type: "select",
      options: [
        { value: "per_passenger", label: "За пассажира" },
        { value: "per_booking", label: "За бронь" },
      ],
    },
    { key: "is_active", type: "boolean" },
  ],
  fleet: [
    { key: "name" },
    { key: "registration_number" },
    { key: "vehicle_class" },
    { key: "capacity", type: "number" },
    { key: "is_active", type: "boolean" },
  ],
  customers: [
    { key: "full_name" },
    { key: "phone_e164" },
    { key: "email" },
    { key: "notes" },
  ],
  requests: [
    {
      key: "status",
      type: "select",
      options: [
        { value: "new", label: "Новая" },
        { value: "in_progress", label: "В работе" },
        { value: "closed", label: "Закрыта" },
        { value: "cancelled", label: "Отменена" },
      ],
    },
    { key: "operator_note" },
  ],
  bookings: [
    {
      key: "status",
      type: "select",
      options: [
        { value: "pending", label: "Ожидание" },
        { value: "awaiting_payment", label: "Ожидает оплаты" },
        { value: "cash_on_boarding", label: "Наличными при посадке" },
        { value: "confirmed", label: "Подтверждено" },
        { value: "cancelled", label: "Отменено" },
        { value: "completed", label: "Завершено" },
      ],
    },
  ],
  trips: [{ key: "price_minor", type: "money" }, { key: "notes" }],
}
function isDetail(value: unknown): value is Detail {
  if (typeof value !== "object" || value === null) return false
  const d = value as Partial<Detail>
  return (
    typeof d.item === "object" &&
    d.item !== null &&
    !Array.isArray(d.item) &&
    typeof d.timezone === "string" &&
    Array.isArray(d.related) &&
    d.related.every(
      (ref) =>
        typeof ref.id === "string" &&
        typeof ref.label === "string" &&
        ref.entity in entityNames &&
        (!("meta" in ref) ||
          (typeof ref.meta === "object" &&
            ref.meta !== null &&
            !Array.isArray(ref.meta)))
    ) &&
    Array.isArray(d.activity) &&
    d.activity.every(
      (event) =>
        typeof event.action === "string" &&
        typeof event.actor === "string" &&
        typeof event.kind === "string" &&
        typeof event.createdAt === "string"
    )
  )
}
function localDateTime(value: unknown, timeZone: string) {
  const date = new Date(String(value ?? ""))
  if (!Number.isFinite(date.getTime())) return ""
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
function updateRequest(
  entity: EntityCollection,
  id: string,
  item: Record<string, unknown>,
  timezone: string
) {
  const path = (name: string) => `${name}?id=${encodeURIComponent(id)}`
  if (entity === "routes")
    return {
      url: path("/api/routes"),
      method: "PATCH",
      body: {
        name: item.name,
        origin: item.origin_name,
        destination: item.destination_name,
        currency: item.currency,
        defaultPriceMinor: Number(item.default_price_minor),
        defaultPricingMode: item.default_pricing_mode,
        isActive: Boolean(item.is_active),
      },
    }
  if (entity === "fleet")
    return {
      url: path("/api/fleet"),
      method: "PATCH",
      body: {
        name: item.name,
        registrationNumber: item.registration_number,
        vehicleClass: item.vehicle_class,
        capacity: Number(item.capacity),
        isActive: Boolean(item.is_active),
      },
    }
  if (entity === "customers")
    return {
      url: path("/api/customers"),
      method: "PATCH",
      body: {
        fullName: item.full_name ?? "",
        phone: item.phone_e164,
        email: item.email ?? "",
        telegramId: item.telegram_id ?? null,
        notes: item.notes ?? "",
        customData: item.custom_data ?? {},
      },
    }
  if (entity === "requests")
    return {
      url: path("/api/individual-transfer-requests"),
      method: "PATCH",
      body: { status: item.status, operatorNote: item.operator_note ?? "" },
    }
  if (entity === "bookings")
    return {
      url: path("/api/bookings"),
      method: "PATCH",
      body: { status: item.status },
    }
  if (entity === "trips")
    return {
      url: path("/api/trips"),
      method: "PUT",
      body: {
        routeId: item.route_id ?? "",
        vehicleId: item.vehicle_id,
        driverId: item.driver_id,
        kind: item.kind,
        origin: item.origin_name,
        destination: item.destination_name,
        startsAt: localDateTime(item.starts_at, timezone),
        endsAt: localDateTime(item.ends_at, timezone),
        priceMinor: Number(item.price_minor),
        pricingMode: item.pricing_mode,
        notes: item.notes ?? "",
        customData: item.custom_data ?? {},
      },
    }
  return null
}
export function EntityDetailPage({
  entity,
  id,
}: {
  entity: EntityCollection
  id: string
}) {
  const requestController = React.useRef<AbortController | null>(null)
  const [detail, setDetail] = React.useState<Detail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [saveState, setSaveState] = React.useState<
    "idle" | "saving" | "saved" | "error"
  >("idle")
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveController = React.useRef<AbortController | null>(null)
  const load = React.useCallback(
    async (silent = false) => {
      requestController.current?.abort()
      const controller = new AbortController()
      requestController.current = controller
      if (!silent) setLoading(true)
      setError(null)
      try {
        const response = await sessionFetch(
          `/api/entity-details/${entity}/${encodeURIComponent(id)}`,
          { cache: "no-store", signal: controller.signal }
        )
        const payload = await response.json()
        if (!response.ok || !isDetail(payload))
          throw new Error(payload.error ?? "Не удалось загрузить запись.")
        if (!controller.signal.aborted) setDetail(payload)
      } catch (reason) {
        if (controller.signal.aborted) return
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить запись."
        )
      } finally {
        if (!controller.signal.aborted && !silent) setLoading(false)
      }
    },
    [entity, id]
  )
  React.useEffect(() => {
    const timer = setTimeout(() => void load(), 0)
    return () => {
      clearTimeout(timer)
      requestController.current?.abort()
      saveController.current?.abort()
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [load])
  const save = React.useCallback(
    async (next: Record<string, unknown>) => {
      if (!detail) return
      const request = updateRequest(entity, id, next, detail.timezone)
      if (!request) return
      saveController.current?.abort()
      const controller = new AbortController()
      saveController.current = controller
      setSaveState("saving")
      setError(null)
      try {
        const response = await sessionFetch(request.url, {
          method: request.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok)
          throw new Error(payload?.error ?? "Не удалось сохранить изменения.")
        if (controller.signal.aborted) return
        setSaveState("saved")
      } catch (reason) {
        if (controller.signal.aborted) return
        setSaveState("error")
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось сохранить изменения."
        )
      }
    },
    [detail, entity, id]
  )
  const changeField = (key: string, value: unknown) => {
    if (!detail) return
    const next = { ...detail.item, [key]: value }
    setDetail({ ...detail, item: next })
    setSaveState("idle")
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void save(next), 650)
  }
  const item = detail?.item
  const title = item
    ? String(
        item.name ??
          item.full_name ??
          item.display_name ??
          item.passenger_name ??
          item.customer_name ??
          (item.origin_name
            ? `${item.origin_name} → ${item.destination_name}`
            : entityNames[entity])
      )
    : entityNames[entity]
  function fieldEditor(key: string, value: unknown) {
    const field = editableFields[entity]?.find(
      (candidate) => candidate.key === key
    )
    if (!field) return null
    if (field.type === "boolean")
      return (
        <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm">
          <Checkbox
            checked={Boolean(value)}
            onCheckedChange={(checked) => changeField(key, checked)}
          />
          {value ? "Да" : "Нет"}
        </label>
      )
    if (field.type === "select")
      return (
        <FieldSelect
          aria-label={entityFieldLabels[key] ?? key}
          triggerClassName="h-9 w-full max-w-md bg-background"
          options={field.options ?? []}
          value={String(value ?? "")}
          onValueChange={(next) => changeField(key, next)}
        />
      )
    if (key === "notes" || key === "operator_note")
      return (
        <Textarea
          aria-label={entityFieldLabels[key] ?? key}
          className="min-h-20 max-w-2xl resize-y bg-background"
          value={String(value ?? "")}
          onChange={(event) => changeField(key, event.target.value)}
        />
      )
    const displayValue =
      field.type === "money" ? Number(value ?? 0) / 100 : (value ?? "")
    return (
      <Input
        aria-label={entityFieldLabels[key] ?? key}
        className="h-9 max-w-2xl bg-background"
        inputMode={
          field.type === "number" || field.type === "money"
            ? "decimal"
            : undefined
        }
        type={
          field.type === "number" || field.type === "money" ? "number" : "text"
        }
        step={
          field.type === "money"
            ? "0.01"
            : field.type === "number"
              ? "1"
              : undefined
        }
        value={String(displayValue)}
        onChange={(event) =>
          changeField(
            key,
            field.type === "money"
              ? Math.round(Number(event.target.value) * 100)
              : field.type === "number"
                ? Number(event.target.value)
                : event.target.value
          )
        }
      />
    )
  }
  function fieldValue(key: string, value: unknown): React.ReactNode {
    if (value === null || value === undefined || value === "")
      return <span className="text-muted-foreground">—</span>
    if (relationFields[key] && typeof value === "string")
      return (
        <Link
          className="inline-flex items-center gap-1 text-primary hover:underline"
          href={entityDetailHref(relationFields[key], value)}
        >
          {entityNames[relationFields[key]]}
          <ArrowUpRight className="size-3" />
        </Link>
      )
    if (typeof value === "boolean")
      return (
        <Badge
          variant="secondary"
          className={statusToneClass(value ? "success" : "neutral")}
        >
          {value ? "Да" : "Нет"}
        </Badge>
      )
    if (key.endsWith("_minor") && typeof value === "number")
      return new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: String(item?.currency ?? "EUR"),
      }).format(value / 100)
    if (key.endsWith("_at") || key.endsWith("_date"))
      return formatEntityDate(String(value), detail?.timezone)
    if (Array.isArray(value))
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {value.map((entry, index) => (
            <div key={index} className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-semibold">Пассажир {index + 1}</p>
              {fieldValue("passenger", entry)}
            </div>
          ))}
        </div>
      )
    if (typeof value === "object")
      return (
        <dl className="grid gap-3">
          {Object.entries(value).map(([field, entry]) => (
            <div key={field} className="min-w-0">
              <dt className="mb-1 text-xs text-muted-foreground">
                {entityFieldLabels[field] ?? field.replaceAll("_", " ")}
              </dt>
              <dd className="text-sm break-words">
                {fieldValue(field, entry)}
              </dd>
            </div>
          ))}
        </dl>
      )
    if (key === "status" || key === "payment_status" || key === "role")
      return (
        <Badge
          variant="secondary"
          className={statusToneClass(
            ["confirmed", "completed", "paid", "closed"].includes(String(value))
              ? "success"
              : ["cancelled", "failed", "expired"].includes(String(value))
                ? "danger"
                : "info"
          )}
        >
          {valueLabels[String(value)] ?? String(value)}
        </Badge>
      )
    return [
      "kind",
      "source",
      "payment_method",
      "pricing_mode",
      "default_pricing_mode",
    ].includes(key)
      ? (valueLabels[String(value)] ?? String(value))
      : String(value)
  }
  const relations = detail
    ? Array.from(
        new Map(
          [
            ...Object.entries(relationFields).flatMap(([key, collection]) =>
              typeof item?.[key] === "string"
                ? [
                    {
                      id: String(item[key]),
                      entity: collection,
                      label: entityNames[collection],
                    },
                  ]
                : []
            ),
            ...detail.related,
          ].map((relation) => [`${relation.entity}:${relation.id}`, relation])
        ).values()
      )
    : []
  return (
    <AppShell
      pageTitle={title}
      pageDescription={`${entityNames[entity]} · данные, связанные записи и история`}
      onRefresh={load}
      refreshing={loading}
    >
      {error ? (
        <div role="alert" className="workspace-panel mb-3 p-4 text-destructive">
          {error}
          <Button
            variant="outline"
            className="ml-3"
            onClick={() => void load()}
          >
            Повторить
          </Button>
        </div>
      ) : null}
      {loading && !detail ? (
        <div
          className="grid gap-3 lg:grid-cols-2"
          aria-label="Загрузка деталей"
          aria-busy="true"
        >
          <Skeleton className="h-72 w-full lg:col-span-2" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : detail ? (
        <EntityDetailContent
          overviewMeta={
            updateRequest(entity, id, detail.item, detail.timezone) ? (
              <span
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                aria-live="polite"
              >
                {saveState === "saving" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : saveState === "saved" ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : null}
                {saveState === "saving"
                  ? "Сохраняем…"
                  : saveState === "saved"
                    ? "Сохранено"
                    : saveState === "error"
                      ? "Ошибка сохранения"
                      : "Автосохранение"}
              </span>
            ) : null
          }
          overview={
            <dl className="min-w-0 divide-y divide-border/70">
              {Object.entries(detail.item)
                .filter(
                  ([key]) => key !== "custom_data" && key !== "last_location"
                )
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="grid min-w-0 gap-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(8rem,0.38fr)_minmax(0,1fr)] sm:gap-5"
                  >
                    <dt className="text-xs leading-5 text-muted-foreground">
                      {entityFieldLabels[key] ??
                        (relationFields[key]
                          ? entityNames[relationFields[key]]
                          : key.replaceAll("_", " "))}
                    </dt>
                    <dd className="text-sm leading-5 font-medium [overflow-wrap:anywhere] break-words">
                      {fieldEditor(key, value) ?? fieldValue(key, value)}
                    </dd>
                  </div>
                ))}
              {detail.item.custom_data &&
              Object.keys(detail.item.custom_data as object).length ? (
                <div className="grid min-w-0 gap-2 py-3 first:pt-0 last:pb-0">
                  <dt className="text-xs text-muted-foreground">
                    Дополнительные данные и пассажиры
                  </dt>
                  <dd>{fieldValue("custom_data", detail.item.custom_data)}</dd>
                </div>
              ) : null}
              {detail.item.last_location ? (
                <div className="grid min-w-0 gap-2 py-3 first:pt-0 last:pb-0">
                  <dt className="text-xs text-muted-foreground">
                    Последняя GPS-точка
                  </dt>
                  <dd>
                    {fieldValue("last_location", detail.item.last_location)}
                    <Button
                      variant="link"
                      render={
                        <a
                          target="_blank"
                          rel="noopener noreferrer"
                          href={`https://www.google.com/maps/search/?api=1&query=${(detail.item.last_location as Record<string, unknown>).latitude},${(detail.item.last_location as Record<string, unknown>).longitude}`}
                        />
                      }
                    >
                      Открыть Google Maps
                      <ArrowUpRight />
                    </Button>
                  </dd>
                </div>
              ) : null}
            </dl>
          }
          related={
            <EntityRelatedRecords
              ownerEntity={entity}
              records={relations}
              timezone={detail.timezone}
            />
          }
          activity={
            <EntityActivityTimeline
              events={detail.activity}
              timezone={detail.timezone}
            />
          }
        />
      ) : null}
    </AppShell>
  )
}
