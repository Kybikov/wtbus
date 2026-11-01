"use client"
import { RouteNavigationEditor } from "@/components/route-navigation-editor"
import { useRecordDeletion } from "@/components/use-record-deletion"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { DisabledActionScope } from "@/components/disabled-action-scope"
import * as React from "react"
import Link from "next/link"
import { ArrowUpRight, Check, LoaderCircle, CircleAlert } from "lucide-react"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/app-shell"
import EntityDetailContent from "@/components/app-dialog-6"
import { realtimeEvent, type RealtimeMessage } from "@/lib/realtime"
import EntityActivityTimeline, {
  type EntityActivityEvent,
} from "@/components/billing-8"
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { AdminNotice } from "@/components/admin-notice"
import {
  RouteStatusField,
  WorkflowStatusField,
  type WorkflowEntity,
} from "@/components/route-status-field"
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
  editRestriction?: string
  item: Record<string, unknown>
  timezone: string
  related: EntityRelatedRecord[]
  activity: EntityActivityEvent[]
}
type EditableField = {
  key: string
  type?: "text" | "number" | "money" | "boolean" | "select" | "datetime"
  options?: { value: string; label: string }[]
}
const editableFields: Partial<Record<EntityCollection, EditableField[]>> = {
  routes: [
    { key: "name" },
    { key: "origin_name" },
    { key: "destination_name" },
    { key: "currency", type: "select" },
    { key: "default_price_minor", type: "money" },
    { key: "driver_pay_minor", type: "money" },
    { key: "distance_km", type: "number" },
    {
      key: "default_pricing_mode",
      type: "select",
      options: [
        { value: "per_passenger", label: "За пассажира" },
        { value: "per_booking", label: "За бронь" },
      ],
    },
    { key: "status", type: "select" },
  ],
  fleet: [
    { key: "name" },
    { key: "registration_number" },
    { key: "vehicle_class" },
    { key: "capacity", type: "number" },
    { key: "status", type: "select" },
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
  trips: [
    { key: "status", type: "select" },
    { key: "origin_name" },
    { key: "destination_name" },
    { key: "starts_at", type: "datetime" },
    { key: "ends_at", type: "datetime" },
    {
      key: "kind",
      type: "select",
      options: [
        { value: "regular", label: "Регулярный" },
        { value: "individual", label: "Индивидуальный" },
      ],
    },
    {
      key: "pricing_mode",
      type: "select",
      options: [
        { value: "per_passenger", label: "За пассажира" },
        { value: "per_booking", label: "За бронь" },
      ],
    },
    { key: "vehicle_id", type: "select" },
    { key: "driver_id", type: "select" },
    { key: "route_id", type: "select" },
    { key: "price_minor", type: "money" },
    { key: "notes" },
  ],
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
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
  )
    return value
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
        driverPayMinor: Number(item.driver_pay_minor ?? 0),
        tariffMode: item.tariff_mode ?? "fixed",
        distanceKm: Number(item.distance_km ?? 0),
        vehicleClassRates: item.vehicle_class_rates ?? {},
        status: item.status,
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
        status: item.status,
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
  const [resources, setResources] = React.useState<
    Record<string, { id: string; name: string }[]>
  >({})
  const [resourceError, setResourceError] = React.useState("")
  React.useEffect(() => {
    if (entity !== "trips") return
    const controller = new AbortController()
    sessionFetch("/api/trip-resources", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok)
          throw Error(payload.error ?? "Не удалось загрузить варианты.")
        setResources(payload)
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setResourceError(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить варианты."
          )
      })
    return () => controller.abort()
  }, [entity])
  const [error, setError] = React.useState<string | null>(null)
  const [saveState, setSaveState] = React.useState<
    "idle" | "saving" | "saved" | "error"
  >("idle")
  const persistedItem = React.useRef<Record<string, unknown> | null>(null)
  const router = useRouter()
  const deletion = useRecordDeletion(entity, () => router.replace(`/${entity}`))
  const autosave = useFieldAutosave<Record<string, unknown>>(async (next) => {
    if (!detail) throw Error("Запись ещё не загружена.")
    setSaveState("saving")
    setError(null)
    try {
      const send = async (url: string, method: string, body: unknown) => {
        const response = await sessionFetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok)
          throw Error(payload?.error ?? "Не удалось сохранить изменения.")
        return payload
      }
      const previous = persistedItem.current
      const statusChanged =
        entity === "trips" && previous?.status !== next.status
      if (statusChanged)
        await send(`/api/trips?id=${encodeURIComponent(id)}`, "PATCH", {
          status: next.status,
        })
      const otherChanges = Object.keys(next).some(
        (key) =>
          key !== "status" &&
          JSON.stringify(next[key]) !== JSON.stringify(previous?.[key])
      )
      let acknowledged = next
      if (!statusChanged || otherChanges) {
        const request = updateRequest(entity, id, next, detail.timezone)
        if (request) {
          const payload = await send(request.url, request.method, request.body)
          if (entity === "trips" && request.method === "PUT" && payload?.item) {
            acknowledged = { ...next }
            for (const [field, responseKey] of Object.entries({
              origin_name: "origin",
              destination_name: "destination",
              starts_at: "startsAt",
              ends_at: "endsAt",
              capacity: "capacity",
              currency: "currency",
              vehicle_name: "vehicle",
              driver_name: "driver",
            })) {
              if (payload.item[responseKey] !== undefined)
                acknowledged[field] = payload.item[responseKey]
            }
            setDetail((current) => {
              if (!current) return current
              const merged = { ...current.item }
              for (const [key, value] of Object.entries(acknowledged))
                if (
                  JSON.stringify(current.item[key]) ===
                  JSON.stringify(next[key])
                )
                  merged[key] = value
              return { ...current, item: merged }
            })
          }
        }
      }
      persistedItem.current = acknowledged
      setSaveState("saved")
      return acknowledged
    } catch (reason) {
      setSaveState("error")
      throw reason
    }
  })
  const load = React.useCallback(
    async (silent = false) => {
      requestController.current?.abort()
      const controller = new AbortController()
      requestController.current = controller
      if (!silent) setLoading(true)
      setError(null)
      try {
        const response = await sessionFetch(
          `/api/entity-details?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(id)}`,
          { cache: "no-store", signal: controller.signal }
        )
        const payload = await response.json().catch(() => null)
        if (!response.ok || !isDetail(payload))
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : response.status === 404
                ? "Запись не найдена."
                : "Не удалось загрузить запись. Повторите попытку."
          )
        if (!controller.signal.aborted) {
          setDetail(payload)
          persistedItem.current = payload.item
          autosave.initialize(payload.item)
        }
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
    [entity, id, autosave]
  )
  React.useEffect(() => {
    const timer = setTimeout(() => void load(), 0)
    return () => {
      clearTimeout(timer)
      requestController.current?.abort()
    }
  }, [load])
  React.useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        if (busy || document.visibilityState !== "visible") return
        busy = true
        try {
          const response = await sessionFetch(
            `/api/entity-details?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(id)}`,
            { cache: "no-store", signal: controller.signal }
          )
          const payload = await response.json()
          if (response.ok && isDetail(payload) && !controller.signal.aborted)
            setDetail((current) =>
              current ? { ...current, activity: payload.activity } : current
            )
        } catch {
          /* Keep the current form and history during a reconnect. */
        } finally {
          busy = false
        }
      }, 400)
    }
    const realtime = (event: Event) => {
      const message = (event as CustomEvent<RealtimeMessage>).detail
      if (message?.type === "ready" || message?.entity === "activity_events")
        refresh()
    }
    window.addEventListener(realtimeEvent, realtime)
    window.addEventListener("focus", refresh)
    return () => {
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener(realtimeEvent, realtime)
      window.removeEventListener("focus", refresh)
    }
  }, [entity, id])
  const changeField = (key: string, value: unknown, commit = true) => {
    if (!detail) return
    const patch: Record<string, unknown> = { [key]: value }
    if (entity === "trips" && key === "kind" && value === "individual")
      patch.route_id = null
    setDetail((current) =>
      current ? { ...current, item: { ...current.item, ...patch } } : current
    )
    if (commit) autosave.commit(patch)
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
    const editor = rawFieldEditor(key, value)
    if (!editor) return null
    const reason =
      (entity === "trips" && key === "status"
        ? undefined
        : detail?.editRestriction) ||
      (entity === "trips" &&
      ["origin_name", "destination_name"].includes(key) &&
      item?.route_id
        ? "Города заданы маршрутом. Выберите «Без маршрута», чтобы изменить их только в этом рейсе."
        : undefined) ||
      (entity === "trips" && key === "route_id" && item?.kind === "individual"
        ? "Маршрут выбирается для регулярного рейса."
        : undefined) ||
      (entity === "trips" &&
      ["vehicle_id", "driver_id", "route_id"].includes(key) &&
      resourceError
        ? resourceError
        : undefined)
    return (
      <DisabledActionScope reason={reason}>
        <fieldset
          disabled={!!reason}
          data-disabled-scope={reason}
          className="min-w-0 flex-1"
          title={reason}
        >
          {editor}
        </fieldset>
      </DisabledActionScope>
    )
  }
  function rawFieldEditor(key: string, value: unknown) {
    const field = editableFields[entity]?.find(
      (candidate) => candidate.key === key
    )
    if (!field) return null
    if (entity === "routes" && key === "status")
      return (
        <RouteStatusField
          value={String(value ?? "active")}
          onValueChange={(next) => changeField(key, next)}
        />
      )
    const workflowEntity = (
      {
        fleet: "vehicles",
        trips: "trips",
        requests: "requests",
        bookings: "bookings",
      } as Partial<Record<EntityCollection, WorkflowEntity>>
    )[entity]
    if (key === "status" && workflowEntity)
      return (
        <WorkflowStatusField
          entity={workflowEntity}
          value={String(value ?? "")}
          onValueChange={(next) => changeField(key, next)}
        />
      )
    if (field.type === "boolean")
      return (
        <label className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-control px-3 text-sm">
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
          triggerClassName="w-full"
          options={
            key === "currency"
              ? [
                  { value: "EUR", label: "EUR" },
                  { value: "UAH", label: "UAH" },
                ]
              : ["vehicle_id", "driver_id", "route_id"].includes(key)
                ? [
                    ...(key === "route_id"
                      ? [{ value: "", label: "Без маршрута" }]
                      : []),
                    ...(
                      resources[
                        (
                          {
                            vehicle_id: "vehicles",
                            driver_id: "drivers",
                            route_id: "routes",
                          } as Record<string, string>
                        )[key]
                      ] ?? []
                    ).map((entry) => ({ value: entry.id, label: entry.name })),
                    ...(value &&
                    !(
                      resources[
                        (
                          {
                            vehicle_id: "vehicles",
                            driver_id: "drivers",
                            route_id: "routes",
                          } as Record<string, string>
                        )[key]
                      ] ?? []
                    ).some((entry) => entry.id === value)
                      ? [
                          {
                            value: String(value),
                            label: String(
                              item?.[key.replace("_id", "_name")] ??
                                "Текущее значение"
                            ),
                          },
                        ]
                      : []),
                  ]
                : (field.options ?? [])
          }
          value={String(value ?? "")}
          onValueChange={(next) => changeField(key, next)}
        />
      )
    if (key === "notes" || key === "operator_note")
      return (
        <Textarea
          aria-label={entityFieldLabels[key] ?? key}
          className="min-h-20 max-w-2xl resize-y"
          value={String(value ?? "")}
          onChange={(event) => changeField(key, event.target.value, false)}
          onBlur={() => autosave.commit({ [key]: value })}
        />
      )
    const displayValue =
      key === "distance_km" && value === 0
        ? ""
        : field.type === "money"
          ? Number(value ?? 0) / 100
          : (value ?? "")
    return (
      <Input
        aria-label={entityFieldLabels[key] ?? key}
        className="h-9 w-full border-transparent bg-transparent px-2 shadow-none hover:bg-control focus-visible:border-input focus-visible:bg-control"
        placeholder={key === "distance_km" ? "Не указана" : undefined}
        min={
          key === "distance_km"
            ? item?.tariff_mode === "per_km"
              ? 0.01
              : 0
            : undefined
        }
        inputMode={
          field.type === "number" || field.type === "money"
            ? "decimal"
            : undefined
        }
        type={
          field.type === "datetime"
            ? "datetime-local"
            : field.type === "number" || field.type === "money"
              ? "number"
              : "text"
        }
        step={
          field.type === "money" || key === "distance_km"
            ? "0.01"
            : field.type === "number"
              ? "1"
              : undefined
        }
        onBlur={() => autosave.commit({ [key]: value })}
        value={
          field.type === "datetime"
            ? localDateTime(value, detail?.timezone ?? "UTC")
            : String(displayValue)
        }
        onChange={(event) =>
          changeField(
            key,
            field.type === "money"
              ? Math.round(Number(event.target.value) * 100)
              : field.type === "number"
                ? key === "distance_km"
                  ? event.target.value
                  : Number(event.target.value)
                : event.target.value,
            false
          )
        }
      />
    )
  }
  function routePriceEditor() {
    if (!detail || entity !== "routes") return null
    const price = Number(detail.item.default_price_minor ?? 0) / 100
    return (
      <InputGroup className="w-full">
        <InputGroupInput
          aria-label="Базовая цена"
          className="tabular-nums"
          inputMode="decimal"
          min="0"
          onChange={(event) =>
            changeField(
              "default_price_minor",
              Math.round(Number(event.target.value) * 100),
              false
            )
          }
          onBlur={() =>
            autosave.commit({
              default_price_minor: detail.item.default_price_minor,
            })
          }
          step="0.01"
          type="number"
          value={String(price)}
        />
        <InputGroupAddon
          align="inline-end"
          className="border-l border-border p-0"
        >
          <FieldSelect
            aria-label="Валюта"
            onValueChange={(next) => changeField("currency", next)}
            options={[
              { value: "EUR", label: "EUR" },
              { value: "UAH", label: "UAH" },
            ]}
            triggerClassName="h-10 w-24 rounded-l-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
            value={String(detail.item.currency ?? "EUR")}
          />
        </InputGroupAddon>
      </InputGroup>
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
          {String(
            item?.[key.replace("_id", "_name")] ??
              entityNames[relationFields[key]]
          )}
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
    if (
      key === "vehicle_class_rates" &&
      typeof value === "object" &&
      value !== null
    ) {
      const rates = Object.entries(value).filter(([, rate]) => Number(rate) > 0)
      if (!rates.length)
        return <span className="text-muted-foreground">Не заданы</span>
      return (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {rates.map(([vehicleClass, rate]) => (
            <span key={vehicleClass} className="text-sm">
              <span className="text-muted-foreground">
                {valueLabels[vehicleClass] ?? vehicleClass} ·{" "}
              </span>
              {new Intl.NumberFormat("ru-RU", {
                style: "currency",
                currency: String(item?.currency ?? "EUR"),
              }).format(Number(rate) / 100)}{" "}
              / км
            </span>
          ))}
        </div>
      )
    }
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
      "tariff_mode",
      "vehicle_class",
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
      pageActions={
        detail && deletion.available ? (
          <Button
            aria-label="Удалить запись"
            title="Удалить запись"
            size="icon-sm"
            variant="ghost"
            className="text-destructive"
            disabled={saveState === "saving"}
            disabledReason="Дождитесь сохранения изменений перед удалением."
            onClick={() => deletion.open(id, title)}
          >
            <Trash2 />
          </Button>
        ) : undefined
      }
    >
      {deletion.dialog}
      <AdminNotice message={resourceError} variant="error" />
      <AdminNotice
        message={detail ? error : null}
        variant="error"
        title="Не удалось выполнить действие"
      />
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
      ) : !detail && error ? (
        <div role="alert" className="surface-card space-y-3 p-5">
          <h2 className="font-semibold">Не удалось открыть запись</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void load()}>Повторить</Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/${entity}`} />}
            >
              К списку
            </Button>
          </div>
        </div>
      ) : detail ? (
        <EntityDetailContent
          overviewMeta={
            <div className="flex shrink-0 items-center gap-2">
              {updateRequest(entity, id, detail.item, detail.timezone) ? (
                <span
                  className="inline-flex w-5 shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:w-28"
                  aria-live="polite"
                >
                  {saveState === "saving" ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : saveState === "saved" ? (
                    <Check className="size-3.5 text-emerald-500" />
                  ) : saveState === "error" ? (
                    <CircleAlert className="size-3.5 text-destructive" />
                  ) : (
                    <span className="size-3.5" />
                  )}
                  <span className="sr-only sm:not-sr-only">
                    {saveState === "saving"
                      ? "Сохраняем…"
                      : saveState === "saved"
                        ? "Сохранено"
                        : saveState === "error"
                          ? "Ошибка сохранения"
                          : null}
                  </span>
                </span>
              ) : null}
            </div>
          }
          overview={
            <dl className="min-w-0 divide-y divide-border/50">
              {entity === "routes" || entity === "trips" ? (
                <div className="py-3">
                  <dt className="mb-3 text-sm font-semibold">Дорога и GPS</dt>
                  <dd>
                    <RouteNavigationEditor routeID={id} entity={entity} />
                  </dd>
                </div>
              ) : null}
              {Object.entries(detail.item)
                .sort(([left], [right]) => {
                  const order = [
                    "record_number",
                    "id",
                    "name",
                    "full_name",
                    "display_name",
                    "status",
                    "origin_name",
                    "destination_name",
                    "distance_km",
                    "tariff_mode",
                    "default_pricing_mode",
                    "default_price_minor",
                    "vehicle_class_rates",
                    "driver_pay_minor",
                    "created_at",
                    "updated_at",
                  ]
                  const rank = (key: string) =>
                    order.includes(key) ? order.indexOf(key) : 12
                  return rank(left) - rank(right)
                })
                .filter(
                  ([key]) =>
                    !(entity === "team" && key === "driver_id") &&
                    ![
                      "id",
                      "user_id",
                      "driver_membership_id",
                      "vehicle_name",
                      "driver_name",
                      "route_name",
                      "customer_name",
                      "record_sequence",
                      "navigation",
                    ].includes(key) &&
                    key !== "custom_data" &&
                    key !== "last_location" &&
                    !(
                      entity === "routes" &&
                      (key === "currency" ||
                        key === "is_active" ||
                        (key === "vehicle_class_rates" &&
                          detail.item.tariff_mode !== "per_km"))
                    )
                )
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="grid min-w-0 grid-cols-[minmax(5rem,.36fr)_minmax(0,1fr)] items-center gap-2 py-1 first:pt-0 last:pb-0 sm:gap-4"
                  >
                    <dt className="flex items-center text-xs leading-5 text-muted-foreground">
                      {entityFieldLabels[key] ??
                        (relationFields[key]
                          ? entityNames[relationFields[key]]
                          : key.replaceAll("_", " "))}
                    </dt>
                    <dd className="flex min-h-10 min-w-0 items-center gap-1 text-sm leading-5 [overflow-wrap:anywhere] break-words [&>div]:w-full">
                      {entity === "routes" && key === "default_price_minor"
                        ? routePriceEditor()
                        : (fieldEditor(key, value) ?? fieldValue(key, value))}
                      {relationFields[key] &&
                      typeof value === "string" &&
                      value &&
                      fieldEditor(key, value) ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          nativeButton={false}
                          aria-label={`Перейти: ${entityFieldLabels[key] ?? entityNames[relationFields[key]]}`}
                          render={
                            <Link
                              href={entityDetailHref(
                                relationFields[key],
                                value
                              )}
                            />
                          }
                        >
                          <ArrowUpRight className="size-4" />
                        </Button>
                      ) : null}
                      {key === "record_number" && value ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Скопировать номер"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(String(value))
                              toast.success("Номер скопирован")
                            } catch {
                              toast.error("Не удалось скопировать номер")
                            }
                          }}
                        >
                          <Copy className="size-4" />
                        </Button>
                      ) : null}
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
              createHref={
                entity === "routes"
                  ? `/trips?createForRoute=${encodeURIComponent(id)}`
                  : undefined
              }
              createStatus={String(detail.item.status ?? "")}
              createAvailable={detail.item.is_active === true}
              createBusy={saveState === "saving"}
              timezone={detail.timezone}
            />
          }
          activity={
            <EntityActivityTimeline
              events={detail.activity}
              entity={entity}
              timezone={detail.timezone}
            />
          }
        />
      ) : null}
    </AppShell>
  )
}
