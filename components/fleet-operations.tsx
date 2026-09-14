"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  Car01Icon,
  Clock01Icon,
  Edit02Icon,
} from "@hugeicons/core-free-icons"

import { AppShell } from "@/components/app-shell"
import { FleetLocationMap } from "@/components/fleet-location-map"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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

type Me = { role: "owner" | "admin" | "dispatcher" | "driver" }

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
    (value.role === "owner" ||
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

function dateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value))
}

function relativeTime(value: string, now: number) {
  const minutes = Math.round((now - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return `${Math.floor(hours / 24)} дн назад`
}

function statusLabel(status?: FleetTrip["status"]) {
  return status === "in_progress"
    ? "В пути"
    : status === "assigned"
      ? "Назначен"
      : "Нет активного рейса"
}

export function FleetOperations() {
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
          setCanManage(payload.role === "owner" || payload.role === "admin")
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

  function startEdit(vehicle: Vehicle) {
    setError(null)
    setEditingID(vehicle.id)
    setForm({
      name: vehicle.name,
      registrationNumber: vehicle.registrationNumber,
      vehicleClass: vehicle.vehicleClass,
      capacity: vehicle.capacity,
      isActive: vehicle.isActive,
    })
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

  return (
    <AppShell pageTitle="Автопарк" utilities={<ThemeCustomizer />}>
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-[-.035em] sm:text-3xl">
              Транспорт и геолокация
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Последняя переданная точка каждого автомобиля. Экран обновляется
              каждые 30 секунд.
            </p>
          </div>
          <div className="flex gap-2">
            {canManage ? (
              <Button disabled={saving} onClick={startCreate} size="lg">
                <HugeiconsIcon icon={Add01Icon} size={18} />
                Добавить автомобиль
              </Button>
            ) : null}
            <Button
              disabled={refreshing || saving}
              onClick={() => void load(true)}
              size="lg"
              variant="outline"
            >
              {refreshing ? "Обновляем…" : "Обновить"}
            </Button>
          </div>
        </div>

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
              <input
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
              <input
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
              <input
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
              <input
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
              <input
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

        <div className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25">
          <div className="hidden grid-cols-[minmax(13rem,1.35fr)_minmax(12rem,1.1fr)_minmax(12rem,1fr)_minmax(10rem,.75fr)] gap-4 border-b border-border px-5 py-3 text-xs font-semibold tracking-[.08em] text-muted-foreground uppercase md:grid">
            <span>Автомобиль</span>
            <span>Текущий рейс</span>
            <span>Последняя точка</span>
            <span>Статус GPS</span>
          </div>
          {loading ? (
            <div className="p-8 text-sm text-muted-foreground">
              Загружаем транспорт…
            </div>
          ) : fleet.length === 0 ? (
            <div className="p-8 text-sm text-muted-foreground">
              Активный транспорт ещё не добавлен.
            </div>
          ) : (
            fleet.map((vehicle) => (
              <article
                className={cn(
                  "grid gap-4 border-b border-border px-4 py-4 last:border-b-0 md:grid-cols-[minmax(13rem,1.35fr)_minmax(12rem,1.1fr)_minmax(12rem,1fr)_minmax(12rem,.9fr)] md:items-center md:px-5",
                  !vehicle.isActive && "opacity-65"
                )}
                key={vehicle.id}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                    <HugeiconsIcon icon={Car01Icon} size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{vehicle.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {vehicle.registrationNumber} · {vehicle.capacity} мест
                    </p>
                    {vehicle.driver ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Водитель: {vehicle.driver}
                      </p>
                    ) : null}
                    {!vehicle.isActive ? (
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">
                        Неактивен
                      </p>
                    ) : null}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold tracking-[.08em] text-muted-foreground uppercase md:hidden">
                    Текущий рейс
                  </p>
                  {vehicle.activeTrip ? (
                    <>
                      <p className="mt-1 font-semibold md:mt-0">
                        {vehicle.activeTrip.origin} →{" "}
                        {vehicle.activeTrip.destination}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {dateTime(vehicle.activeTrip.startsAt, timezone)} —{" "}
                        {dateTime(vehicle.activeTrip.endsAt, timezone)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground md:mt-0">
                      Нет активного рейса
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold tracking-[.08em] text-muted-foreground uppercase md:hidden">
                    Последняя точка
                  </p>
                  {vehicle.lastLocation ? (
                    <>
                      <p className="mt-1 font-semibold tabular-nums md:mt-0">
                        {vehicle.lastLocation.latitude.toFixed(5)},{" "}
                        {vehicle.lastLocation.longitude.toFixed(5)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Точность{" "}
                        {vehicle.lastLocation.accuracyMeters == null
                          ? "неизвестна"
                          : `±${Math.round(vehicle.lastLocation.accuracyMeters)} м`}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground md:mt-0">
                      Ожидаем GPS-точку
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      vehicle.lastLocation &&
                        now - Date.parse(vehicle.lastLocation.recordedAt) <=
                          120_000
                        ? "bg-emerald-500"
                        : "bg-amber-600"
                    )}
                  />
                  <div>
                    <p className="font-semibold">
                      {statusLabel(vehicle.activeTrip?.status)}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <HugeiconsIcon icon={Clock01Icon} size={13} />
                      {vehicle.lastLocation
                        ? `${now - Date.parse(vehicle.lastLocation.recordedAt) > 120_000 ? "GPS устарел · " : ""}${relativeTime(vehicle.lastLocation.recordedAt, now)}`
                        : "нет сигнала"}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="ml-auto flex gap-2">
                      <Button
                        disabled={saving}
                        onClick={() => startEdit(vehicle)}
                        size="sm"
                        variant="outline"
                      >
                        <HugeiconsIcon icon={Edit02Icon} size={15} />
                        Изменить
                      </Button>
                      <Button
                        disabled={saving}
                        onClick={() => void toggleVehicle(vehicle)}
                        size="sm"
                        variant={vehicle.isActive ? "outline" : "secondary"}
                      >
                        {vehicle.isActive ? "Выключить" : "Включить"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </AppShell>
  )
}
