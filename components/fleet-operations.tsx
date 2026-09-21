"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"

import { AppShell } from "@/components/app-shell"
import { FleetLocationMap } from "@/components/fleet-location-map"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EntityDataView } from "@/components/entity-data-view"
import {
  textColumn,
  numberColumn,
  dateColumn,
  statusColumn,
  activeOptions,
  activeFilter,
} from "@/lib/entity-columns"
import { usePageSearch } from "@/hooks/use-page-search"
import { useEntitySelection } from "@/hooks/use-entity-selection"

type FleetTrip = {
  id: string
  status: "assigned" | "in_progress"
  origin: string
  destination: string
  startsAt: string
  endsAt: string
}

type FleetLocation = {
  latitude: number
  longitude: number
  accuracyMeters?: number
  recordedAt: string
}

type Vehicle = {
  id: string
  name: string
  registrationNumber: string
  vehicleClass: string
  capacity: number
  isActive: boolean
  driver?: string
  activeTrip?: FleetTrip
  lastLocation?: FleetLocation
}

type FleetResponse = { items: Vehicle[]; timezone: string }

type VehicleForm = Pick<
  Vehicle,
  "name" | "registrationNumber" | "vehicleClass" | "capacity" | "isActive"
>

type Me = { role: "developer" | "owner" | "admin" | "dispatcher" | "driver" }

const emptyVehicleForm: VehicleForm = {
  name: "",
  registrationNumber: "",
  vehicleClass: "Микроавтобус",
  capacity: 18,
  isActive: true,
}

function isFleetResponse(value: unknown): value is FleetResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items) &&
    "timezone" in value &&
    typeof value.timezone === "string"
  )
}

function isMe(value: unknown): value is Me {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    (value.role === "developer" ||
      value.role === "owner" ||
      value.role === "admin" ||
      value.role === "dispatcher" ||
      value.role === "driver")
  )
}

function errorFrom(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

function relativeTime(value: string, now: number) {
  const minutes = Math.round((now - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return `${Math.floor(hours / 24)} дн назад`
}

export function FleetOperations() {
  const [query, setQuery] = usePageSearch()
  const selection = useEntitySelection<Vehicle>((item) => item.id)
  const requestInFlight = React.useRef(false)
  const [now, setNow] = React.useState(0)
  const [fleet, setFleet] = React.useState<Vehicle[]>([])
  const [timezone, setTimezone] = React.useState("Europe/Warsaw")
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [canManage, setCanManage] = React.useState(false)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editingID, setEditingID] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<VehicleForm>(emptyVehicleForm)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async (manual = false) => {
    if (requestInFlight.current) return
    requestInFlight.current = true
    if (manual) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const response = await sessionFetch("/api/fleet", {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      })
      const payload: unknown = await response.json()
      if (!response.ok || !isFleetResponse(payload)) {
        throw new Error("Не удалось загрузить автопарк.")
      }
      setFleet(payload.items)
      setTimezone(payload.timezone)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить автопарк."
      )
    } finally {
      requestInFlight.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    const bootstrap = window.setTimeout(() => {
      setNow(Date.now())
      void load()
    }, 0)
    const clock = window.setInterval(() => setNow(Date.now()), 15_000)
    const refresh = () => {
      setNow(Date.now())
      if (document.visibilityState === "visible") void load(true)
    }
    const timer = window.setInterval(refresh, 30_000)
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("online", refresh)
    return () => {
      window.clearTimeout(bootstrap)
      window.clearInterval(timer)
      window.clearInterval(clock)
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener("online", refresh)
    }
  }, [load])

  React.useEffect(() => {
    void sessionFetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => ({
        response,
        payload: await response.json().catch(() => null),
      }))
      .then(({ response, payload }) => {
        if (response.ok && isMe(payload))
          setCanManage(
            payload.role === "developer" ||
              payload.role === "owner" ||
              payload.role === "admin"
          )
      })
      .catch(() => {})
  }, [])

  function closeEditor() {
    setEditorOpen(false)
    setEditingID(null)
    setForm(emptyVehicleForm)
  }

  function startCreate() {
    setError(null)
    setEditingID(null)
    setForm(emptyVehicleForm)
    setEditorOpen(true)
  }

  function updateForm<Key extends keyof VehicleForm>(
    key: Key,
    value: VehicleForm[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function saveVehicle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const editing = editingID !== null
    const endpoint = editing
      ? `/api/fleet?id=${encodeURIComponent(editingID)}`
      : "/api/fleet"
    const fallback = editing
      ? "Не удалось обновить автомобиль."
      : "Не удалось добавить автомобиль."
    try {
      const response = await sessionFetch(endpoint, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload: unknown = await response.json()
      if (!response.ok) throw new Error(errorFrom(payload, fallback))
      closeEditor()
      await load(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallback)
    } finally {
      setSaving(false)
    }
  }

  async function toggleVehicle(vehicle: Vehicle) {
    setSaving(true)
    setError(null)
    try {
      const response = await sessionFetch(
        `/api/fleet?id=${encodeURIComponent(vehicle.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: vehicle.name,
            registrationNumber: vehicle.registrationNumber,
            vehicleClass: vehicle.vehicleClass,
            capacity: vehicle.capacity,
            isActive: !vehicle.isActive,
          }),
        }
      )
      const payload: unknown = await response.json()
      if (!response.ok)
        throw new Error(
          errorFrom(payload, "Не удалось изменить статус автомобиля.")
        )
      await load(true)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось изменить статус автомобиля."
      )
    } finally {
      setSaving(false)
    }
  }

  const moving = fleet.filter(
    (vehicle) => vehicle.activeTrip?.status === "in_progress"
  ).length
  const reporting = fleet.filter(
    (vehicle) =>
      vehicle.lastLocation &&
      now - Date.parse(vehicle.lastLocation.recordedAt) <= 120_000
  ).length
  const mapPoints = fleet.flatMap((vehicle) =>
    vehicle.lastLocation
      ? [
          {
            id: vehicle.id,
            name: vehicle.name,
            latitude: vehicle.lastLocation.latitude,
            longitude: vehicle.lastLocation.longitude,
            recordedAt: vehicle.lastLocation.recordedAt,
            stale: now - Date.parse(vehicle.lastLocation.recordedAt) > 120_000,
          },
        ]
      : []
  )

  const filteredFleet = fleet.filter((item) =>
    [item.name, item.registrationNumber, item.driver, item.id]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  const columns = [
    textColumn<Vehicle>("name", "Автомобиль", (item) => item.name),
    textColumn<Vehicle>(
      "registration",
      "Госномер",
      (item) => item.registrationNumber
    ),
    numberColumn<Vehicle>("capacity", "Мест", (item) => item.capacity),
    textColumn<Vehicle>("driver", "Водитель", (item) => item.driver),
    statusColumn<Vehicle>(
      "active",
      "Активность",
      (item) => (item.isActive ? "active" : "inactive"),
      activeOptions
    ),
    textColumn<Vehicle>("trip", "Текущий рейс", (item) =>
      item.activeTrip
        ? `${item.activeTrip.origin} → ${item.activeTrip.destination}`
        : ""
    ),
    textColumn<Vehicle>("gps", "GPS", (item) =>
      item.lastLocation
        ? `${relativeTime(item.lastLocation.recordedAt, now)} · ${item.lastLocation.latitude.toFixed(5)}, ${item.lastLocation.longitude.toFixed(5)}`
        : "Нет сигнала"
    ),
    textColumn<Vehicle>("class", "Класс", (item) => item.vehicleClass, false),
    dateColumn<Vehicle>(
      "recordedAt",
      "GPS получен",
      (item) => item.lastLocation?.recordedAt,
      timezone,
      false
    ),
    numberColumn<Vehicle>(
      "latitude",
      "Широта",
      (item) => item.lastLocation?.latitude,
      false
    ),
    numberColumn<Vehicle>(
      "longitude",
      "Долгота",
      (item) => item.lastLocation?.longitude,
      false
    ),
    numberColumn<Vehicle>(
      "accuracy",
      "Точность GPS, м",
      (item) => item.lastLocation?.accuracyMeters,
      false
    ),
    textColumn<Vehicle>("id", "ID", (item) => item.id, false),
  ]
  async function bulkActive(active: boolean) {
    await selection.run(
      fleet,
      async (item) => {
        const response = await sessionFetch(
          `/api/fleet?id=${encodeURIComponent(item.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: item.name,
              registrationNumber: item.registrationNumber,
              vehicleClass: item.vehicleClass,
              capacity: item.capacity,
              isActive: active,
            }),
          }
        )
        const payload = await response.json()
        if (!response.ok)
          throw new Error(payload.error ?? "Не удалось изменить автомобиль.")
      },
      () => load(true)
    )
  }
  return (
    <AppShell
      collectionFooter
      localSearch={{
        value: query,
        onChange: setQuery,
        placeholder: "Автомобиль, госномер или водитель",
        label: "Поиск автопарка",
      }}
      onRefresh={() => load(true)}
      refreshing={loading || refreshing}
      onCreate={startCreate}
      createDisabled={saving || !canManage}
      pageDescription="Последняя GPS-точка каждого автомобиля · обновление раз в 30 секунд"
      pageTitle="Транспорт и геолокация"
      utilities={<ThemeCustomizer />}
    >
      <div className="w-full min-w-0 space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-background/35 p-4">
            <p className="text-xs font-semibold tracking-[.08em] text-muted-foreground uppercase">
              На линии
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{moving}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              рейс выполняется сейчас
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-background/35 p-4">
            <p className="text-xs font-semibold tracking-[.08em] text-muted-foreground uppercase">
              С GPS
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {reporting} / {fleet.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              авто передали точку за последние 2 минуты
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-background/35 p-4">
            <p className="text-xs font-semibold tracking-[.08em] text-muted-foreground uppercase">
              Часовой пояс
            </p>
            <p className="mt-2 text-lg font-bold">{timezone}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              время рейсов отображается локально
            </p>
          </div>
        </div>

        <FleetLocationMap points={mapPoints} />

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <span>{error}</span>
            <Button onClick={() => void load(true)} size="sm" variant="outline">
              Повторить
            </Button>
          </div>
        ) : null}

        {editorOpen ? (
          <form
            className="grid gap-4 rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25 p-4 sm:grid-cols-2 sm:p-5"
            onSubmit={saveVehicle}
          >
            <div className="sm:col-span-2">
              <h2 className="text-lg font-bold">
                {editingID ? "Изменить автомобиль" : "Новый автомобиль"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Неактивный автомобиль останется в истории, но его нельзя будет
                назначить на новый рейс.
              </p>
            </div>
            <label className="grid gap-2 text-sm font-semibold">
              Название автомобиля
              <Input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                maxLength={160}
                onChange={(event) => updateForm("name", event.target.value)}
                placeholder="Mercedes Sprinter 519"
                required
                value={form.name}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Госномер
              <Input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal uppercase outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                maxLength={64}
                onChange={(event) =>
                  updateForm("registrationNumber", event.target.value)
                }
                placeholder="VIVAT-005"
                required
                value={form.registrationNumber}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Класс транспорта
              <Input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                maxLength={80}
                onChange={(event) =>
                  updateForm("vehicleClass", event.target.value)
                }
                placeholder="Микроавтобус"
                required
                value={form.vehicleClass}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Количество мест
              <Input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                max={150}
                min={1}
                onChange={(event) =>
                  updateForm("capacity", Number(event.target.value))
                }
                required
                type="number"
                value={form.capacity}
              />
            </label>
            <label className="flex items-center gap-3 text-sm font-semibold sm:col-span-2">
              <Input
                checked={form.isActive}
                className="size-4 accent-primary"
                disabled={saving}
                onChange={(event) =>
                  updateForm("isActive", event.target.checked)
                }
                type="checkbox"
              />
              Автомобиль активен и доступен для планирования
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button
                disabled={saving}
                onClick={closeEditor}
                type="button"
                variant="ghost"
              >
                Отмена
              </Button>
              <Button disabled={saving} type="submit">
                {saving
                  ? "Сохраняем…"
                  : editingID
                    ? "Сохранить изменения"
                    : "Добавить автомобиль"}
              </Button>
            </div>
          </form>
        ) : null}

        {selection.error ? (
          <p role="alert" className="text-sm text-destructive">
            {selection.error}
          </p>
        ) : null}
        <EntityDataView
          collection="fleet"
          columns={columns}
          items={filteredFleet}
          getId={(item) => item.id}
          getLabel={(item) => item.name}
          loading={loading}
          selected={selection.selected}
          onSelectedChange={selection.setSelected}
          modes={["table", "list", "kanban", "gallery"]}
          filters={[activeFilter<Vehicle>((item) => item.isActive)]}
          groupBy={(item) => item.activeTrip?.status || "idle"}
          kanbanGroups={[
            { id: "idle", label: "Свободны" },
            { id: "assigned", label: "Назначены" },
            { id: "in_progress", label: "В пути" },
          ]}
          actions={
            canManage
              ? [
                  {
                    label: "Включить / выключить",
                    onSelect: (item) => void toggleVehicle(item),
                    disabled: () => saving || selection.pending,
                  },
                ]
              : []
          }
          bulkActions={
            canManage ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving || selection.pending}
                  onClick={() => void bulkActive(true)}
                >
                  Включить
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving || selection.pending}
                  onClick={() => void bulkActive(false)}
                >
                  Отключить
                </Button>
              </>
            ) : null
          }
          emptyText="Автомобилей не найдено."
        />
      </div>
    </AppShell>
  )
}
