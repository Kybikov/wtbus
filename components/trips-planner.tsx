"use client"

import * as React from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Car01Icon,
  FilterIcon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons"

import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import {
  CustomDataFields,
  serializeCustomData,
  type CustomDataField,
  type CustomDataValues,
} from "@/components/custom-data-fields"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type APITrip = {
  id: string
  kind: "regular" | "individual"
  status: string
  origin: string
  destination: string
  startsAt: string
  endsAt: string
  capacity: number
  priceMinor: number
  pricingMode: "per_passenger" | "per_booking"
  routeId?: string
  vehicleId?: string
  driverId?: string
  notes?: string
  vehicle: string
  driver: string
  customData?: Record<string, unknown>
}

type CalendarTrip = APITrip & {
  title: string
  time: string
  left: string
  width: string
  tone: "sky" | "gold" | "slate" | "violet"
  kindLabel: "Регулярный" | "Индивидуальный"
}

type Lane = {
  vehicleId: string
  driverId: string
  vehicle: string
  driver: string
  capacity: string
  trips: CalendarTrip[]
}

type TripResource = {
  id: string
  name: string
  capacity?: number
}

type RouteResource = {
  id: string
  name: string
  origin: string
  destination: string
  currency: string
  defaultPriceMinor: number
  defaultPricingMode: "per_passenger" | "per_booking"
}

type TripForm = {
  kind: "regular" | "individual"
  routeId: string
  origin: string
  destination: string
  startsAt: string
  endsAt: string
  vehicleId: string
  driverId: string
  notes: string
  price: string
  pricingMode: "per_passenger" | "per_booking"
  repeatUntil: string
  weekdays: number[]
  customData: CustomDataValues
}

const weekdayOptions = [
  { value: 1, label: "Пн" },
  { value: 2, label: "Вт" },
  { value: 3, label: "Ср" },
  { value: 4, label: "Чт" },
  { value: 5, label: "Пт" },
  { value: 6, label: "Сб" },
  { value: 0, label: "Вс" },
]

const DAY_START_MINUTES = 6 * 60
const DAY_END_MINUTES = 24 * 60
const DAY_DURATION_MINUTES = DAY_END_MINUTES - DAY_START_MINUTES
const russianShortWeekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]

function startOfWeek(date: Date) {
  const result = new Date(date)
  const weekday = result.getDay() || 7
  result.setDate(result.getDate() - weekday + 1)
  result.setHours(0, 0, 0, 0)
  return result
}

function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function formatISODate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso))
}

function toLocalDateTimeInput(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(new Date(iso))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`
}

function minutesInOperationalTimeZone(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(new Date(iso))
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0)
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0
  )

  return hour * 60 + minute
}

function toCalendarTrip(trip: APITrip, timeZone: string): CalendarTrip {
  const startMinutes = minutesInOperationalTimeZone(trip.startsAt, timeZone)
  const endMinutes = minutesInOperationalTimeZone(trip.endsAt, timeZone)
  const left = Math.max(
    0,
    Math.min(DAY_DURATION_MINUTES, startMinutes - DAY_START_MINUTES)
  )
  const right = Math.max(
    left + 15,
    Math.min(DAY_DURATION_MINUTES, endMinutes - DAY_START_MINUTES)
  )
  const kindLabel = trip.kind === "regular" ? "Регулярный" : "Индивидуальный"

  return {
    ...trip,
    title: `${trip.origin} → ${trip.destination}`,
    time: `${formatTime(trip.startsAt, timeZone)}–${formatTime(trip.endsAt, timeZone)}`,
    left: `${(left / DAY_DURATION_MINUTES) * 100}%`,
    width: `${((right - left) / DAY_DURATION_MINUTES) * 100}%`,
    tone:
      trip.kind === "individual"
        ? "violet"
        : trip.status === "in_progress"
          ? "sky"
          : trip.status === "new"
            ? "slate"
            : "gold",
    kindLabel,
  }
}

function toLanes(
  trips: APITrip[],
  vehicles: TripResource[],
  timeZone: string
): Lane[] {
  const byVehicle = new Map<string, Lane>(
    vehicles.map((vehicle) => [
      vehicle.id,
      {
        vehicleId: vehicle.id,
        driverId: "",
        vehicle: vehicle.name,
        driver: "Свободен",
        capacity:
          vehicle.capacity && vehicle.capacity > 0
            ? `${vehicle.capacity} мест`
            : "Вместимость не указана",
        trips: [],
      },
    ])
  )

  for (const trip of trips) {
    const vehicle = trip.vehicle || "Транспорт не назначен"
    const driver = trip.driver || "Водитель не назначен"
    const key = trip.vehicleId ?? `${vehicle}:${driver}`
    const lane = byVehicle.get(key) ?? {
      vehicleId: trip.vehicleId ?? "",
      driverId: trip.driverId ?? "",
      vehicle,
      driver,
      capacity:
        trip.capacity > 0 ? `${trip.capacity} мест` : "Вместимость не указана",
      trips: [],
    }
    if (lane.trips.length === 0) {
      lane.driver = driver
      lane.driverId = trip.driverId ?? ""
    } else if (lane.driverId !== trip.driverId) {
      lane.driver = "Несколько водителей"
      lane.driverId = ""
    }
    lane.trips.push(toCalendarTrip(trip, timeZone))
    byVehicle.set(key, lane)
  }

  return [...byVehicle.values()]
}

function isTripCollection(
  value: unknown
): value is { items: APITrip[]; timezone: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items) &&
    "timezone" in value &&
    typeof value.timezone === "string"
  )
}

function isTripResourceCollection(value: unknown): value is {
  vehicles: TripResource[]
  drivers: TripResource[]
  routes: RouteResource[]
  currency: string
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "vehicles" in value &&
    "drivers" in value &&
    "routes" in value &&
    "currency" in value &&
    Array.isArray(value.vehicles) &&
    Array.isArray(value.drivers) &&
    Array.isArray(value.routes) &&
    typeof value.currency === "string"
  )
}

function isCustomFieldCollection(
  value: unknown
): value is { items: CustomDataField[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
}

function createEmptyTripForm(day: string): TripForm {
  return {
    kind: "regular",
    routeId: "",
    origin: "",
    destination: "",
    startsAt: `${day}T09:00`,
    endsAt: `${day}T18:00`,
    vehicleId: "",
    driverId: "",
    notes: "",
    price: "79",
    pricingMode: "per_passenger",
    repeatUntil: "",
    weekdays: [new Date(`${day}T12:00:00`).getDay()],
    customData: {},
  }
}

function parsePriceMinor(value: string) {
  const normalized = value.trim().replace(",", ".")
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const minor = Math.round(Number(normalized) * 100)
  return Number.isSafeInteger(minor) && minor >= 0 && minor <= 10_000_000_000
    ? minor
    : null
}

function localDateTimeForMinutes(day: string, minutes: number) {
  const normalized = Math.max(0, minutes)
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + Math.floor(normalized / (24 * 60)))
  const hour = String(Math.floor(normalized / 60) % 24).padStart(2, "0")
  const minute = String(normalized % 60).padStart(2, "0")
  return `${formatISODate(date)}T${hour}:${minute}`
}

const tripStatusLabels: Record<string, string> = {
  draft: "Черновик",
  new: "Новый",
  assigned: "Назначен",
  in_progress: "В рейсе",
  completed: "Завершен",
  cancelled: "Отменен",
}

function FilterPill({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

export function TripsPlanner() {
  const [weekStart, setWeekStart] = React.useState(() =>
    startOfWeek(new Date())
  )
  const [selectedDay, setSelectedDay] = React.useState(() => {
    const weekday = new Date().getDay()
    return weekday === 0 ? 6 : weekday - 1
  })
  const [filter, setFilter] = React.useState<"all" | "regular" | "custom">(
    "all"
  )
  const [notice, setNotice] = React.useState<string | null>(null)
  const [trips, setTrips] = React.useState<APITrip[]>([])
  const [scheduleTimeZone, setScheduleTimeZone] =
    React.useState("Europe/Warsaw")
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [requestVersion, setRequestVersion] = React.useState(0)
  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [editingTripID, setEditingTripID] = React.useState<string | null>(null)
  const [selectedTrip, setSelectedTrip] = React.useState<CalendarTrip | null>(
    null
  )
  const [isStatusSubmitting, setIsStatusSubmitting] = React.useState(false)
  const [selectedTripError, setSelectedTripError] = React.useState<
    string | null
  >(null)
  const [isCancelConfirmation, setIsCancelConfirmation] = React.useState(false)
  const [resources, setResources] = React.useState<{
    vehicles: TripResource[]
    drivers: TripResource[]
    routes: RouteResource[]
    currency: string
  }>({ vehicles: [], drivers: [], routes: [], currency: "EUR" })
  const [isResourcesLoading, setIsResourcesLoading] = React.useState(false)
  const [resourceError, setResourceError] = React.useState<string | null>(null)
  const [tripCustomFields, setTripCustomFields] = React.useState<
    CustomDataField[]
  >([])
  const [formError, setFormError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [draggingTripID, setDraggingTripID] = React.useState<string | null>(
    null
  )
  const [isRescheduling, setIsRescheduling] = React.useState(false)
  const days = React.useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(weekStart, index)
        return {
          short: russianShortWeekdays[date.getDay()],
          date: String(date.getDate()),
          full: new Intl.DateTimeFormat("ru-RU", {
            day: "numeric",
            month: "long",
          }).format(date),
          iso: formatISODate(date),
        }
      }),
    [weekStart]
  )
  const day = days[selectedDay]
  const [tripForm, setTripForm] = React.useState<TripForm>(() =>
    createEmptyTripForm(days[selectedDay].iso)
  )
  const weekLabel = `${days[0].date}–${new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(addDays(weekStart, 6))}`

  React.useEffect(() => {
    const controller = new AbortController()

    async function loadTrips() {
      setIsLoading(true)
      setLoadError(null)

      try {
        const response = await fetch(
          `/api/trips?date=${encodeURIComponent(day.iso)}`,
          {
            signal: controller.signal,
          }
        )
        const payload: unknown = await response.json()

        if (!response.ok || !isTripCollection(payload)) {
          throw new Error("Не удалось загрузить рейсы.")
        }

        setTrips(payload.items)
        setScheduleTimeZone(payload.timezone)
      } catch (error) {
        if (controller.signal.aborted) return
        setTrips([])
        setLoadError(
          error instanceof Error && error.message
            ? error.message
            : "Не удалось загрузить рейсы."
        )
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    void loadTrips()
    return () => controller.abort()
  }, [day.iso, requestVersion])

  React.useEffect(() => {
    const controller = new AbortController()
    async function loadResources() {
      setIsResourcesLoading(true)
      setResourceError(null)
      try {
        const [response, fieldsResponse] = await Promise.all([
          fetch("/api/trip-resources", { signal: controller.signal }),
          fetch("/api/custom-fields?entity=trip", {
            signal: controller.signal,
          }),
        ])
        const [payload, fieldsPayload]: [unknown, unknown] = await Promise.all([
          response.json(),
          fieldsResponse.json(),
        ])
        if (
          !response.ok ||
          !isTripResourceCollection(payload) ||
          !fieldsResponse.ok ||
          !isCustomFieldCollection(fieldsPayload)
        ) {
          throw new Error("Не удалось загрузить транспорт и водителей.")
        }
        setResources(payload)
        setTripCustomFields(
          fieldsPayload.items.filter((field) => field.isActive)
        )
      } catch (error) {
        if (controller.signal.aborted) return
        setTripCustomFields([])
        setResourceError(
          error instanceof Error && error.message
            ? error.message
            : "Не удалось загрузить транспорт и водителей."
        )
      } finally {
        if (!controller.signal.aborted) setIsResourcesLoading(false)
      }
    }

    void loadResources()
    return () => controller.abort()
  }, [])

  React.useEffect(() => {
    if (!isCreateOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) setIsCreateOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [isCreateOpen, isSubmitting])

  const lanes = React.useMemo(
    () => toLanes(trips, resources.vehicles, scheduleTimeZone),
    [resources.vehicles, scheduleTimeZone, trips]
  )
  const mobileTrips = React.useMemo(
    () =>
      lanes.flatMap((lane) =>
        lane.trips.map((trip) => ({
          ...trip,
          vehicle: lane.vehicle,
          driver: lane.driver,
        }))
      ),
    [lanes]
  )

  const showTrip = (kind: CalendarTrip["kind"]) =>
    filter === "all" ||
    (filter === "regular" ? kind === "regular" : kind === "individual")
  const filteredTrips = mobileTrips.filter((trip) => showTrip(trip.kind))
  const filterContext =
    filter === "all"
      ? `${lanes.length} ${lanes.length === 1 ? "машина в плане" : "машин в плане"}`
      : `${new Set(filteredTrips.map((trip) => trip.vehicle)).size} машин в фильтре`

  function openCreateTrip() {
    setEditingTripID(null)
    setTripForm(createEmptyTripForm(day.iso))
    setFormError(null)
    setIsCreateOpen(true)
  }

  async function submitTrip(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const priceMinor = parsePriceMinor(tripForm.price)
    if (priceMinor === null) {
      setFormError(
        `Укажите ${tripForm.pricingMode === "per_booking" ? "цену за всю бронь" : "цену за пассажира"} числом с точностью до двух знаков.`
      )
      return
    }
    const { repeatUntil, weekdays } = tripForm
    const tripPayload = {
      kind: tripForm.kind,
      routeId: tripForm.routeId,
      origin: tripForm.origin,
      destination: tripForm.destination,
      startsAt: tripForm.startsAt,
      endsAt: tripForm.endsAt,
      vehicleId: tripForm.vehicleId,
      driverId: tripForm.driverId,
      notes: tripForm.notes,
      pricingMode: tripForm.pricingMode,
    }
    const isEditing = editingTripID !== null
    const isSchedule =
      !isEditing && tripForm.kind === "regular" && repeatUntil !== ""
    if (isSchedule && weekdays.length === 0) {
      setFormError("Выберите хотя бы один день недели для регулярного графика.")
      return
    }
    setIsSubmitting(true)

    try {
      const response = await fetch(
        isSchedule
          ? "/api/trips/schedule"
          : isEditing
            ? `/api/trips?id=${encodeURIComponent(editingTripID)}`
            : "/api/trips",
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...tripPayload,
            priceMinor,
            ...(isSchedule ? { repeatUntil, weekdays } : {}),
            customData: serializeCustomData(
              tripCustomFields,
              tripForm.customData
            ),
          }),
        }
      )
      const payload: unknown = await response.json()
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : isEditing
              ? "Не удалось изменить рейс."
              : "Не удалось создать рейс."
        throw new Error(message)
      }

      const createdCount =
        isSchedule &&
        typeof payload === "object" &&
        payload !== null &&
        "createdCount" in payload &&
        typeof payload.createdCount === "number"
          ? payload.createdCount
          : 0
      setIsCreateOpen(false)
      setNotice(
        isSchedule
          ? `${tripForm.origin} → ${tripForm.destination}: создано рейсов по графику — ${createdCount}.`
          : `${tripForm.origin} → ${tripForm.destination}: ${isEditing ? "рейс изменен." : "рейс создан."}`
      )
      setEditingTripID(null)
      setRequestVersion((version) => version + 1)
    } catch (error) {
      setFormError(
        error instanceof Error && error.message
          ? error.message
          : editingTripID
            ? "Не удалось изменить рейс."
            : "Не удалось создать рейс."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function changeSelectedTripStatus(status: string) {
    if (!selectedTrip) return

    setSelectedTripError(null)
    setIsStatusSubmitting(true)
    try {
      const response = await fetch(
        `/api/trips?id=${encodeURIComponent(selectedTrip.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      )
      const payload: unknown = await response.json()
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Не удалось обновить статус рейса."
        throw new Error(message)
      }

      const action =
        status === "in_progress"
          ? "Рейс начат."
          : status === "completed"
            ? "Рейс завершен."
            : status === "cancelled"
              ? "Рейс отменен."
              : "Статус рейса обновлен."
      setNotice(`${selectedTrip.title}: ${action}`)
      setSelectedTrip(null)
      setRequestVersion((version) => version + 1)
    } catch (error) {
      setSelectedTripError(
        error instanceof Error && error.message
          ? error.message
          : "Не удалось обновить статус рейса."
      )
    } finally {
      setIsStatusSubmitting(false)
    }
  }

  async function rescheduleTrip(
    event: React.DragEvent<HTMLDivElement>,
    lane: Lane
  ) {
    event.preventDefault()
    const trip = trips.find((item) => item.id === draggingTripID)
    setDraggingTripID(null)
    if (
      !trip ||
      !lane.vehicleId ||
      !["draft", "new", "assigned"].includes(trip.status)
    )
      return

    const durationMinutes = Math.max(
      15,
      Math.round(
        (new Date(trip.endsAt).getTime() - new Date(trip.startsAt).getTime()) /
          60_000
      )
    )
    if (durationMinutes >= DAY_DURATION_MINUTES) {
      setLoadError("Рейс длиннее доступной шкалы и не может быть перенесён перетаскиванием.")
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    const offset = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))
    const rawMinutes = DAY_START_MINUTES +
      (offset / Math.max(bounds.width, 1)) * DAY_DURATION_MINUTES
    const snappedMinutes = Math.round(rawMinutes / 15) * 15
    const startMinutes = Math.max(
      DAY_START_MINUTES,
      Math.min(DAY_END_MINUTES - durationMinutes, snappedMinutes)
    )
    const startsAt = localDateTimeForMinutes(day.iso, startMinutes)
    const endsAt = localDateTimeForMinutes(day.iso, startMinutes + durationMinutes)
    const driverId = lane.driverId || trip.driverId || ""
    const unchanged =
      lane.vehicleId === trip.vehicleId &&
      driverId === trip.driverId &&
      startsAt === toLocalDateTimeInput(trip.startsAt, scheduleTimeZone)
    if (unchanged) return

    setIsRescheduling(true)
    setLoadError(null)
    try {
      const response = await fetch(`/api/trips?id=${encodeURIComponent(trip.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: trip.kind,
          routeId: trip.routeId ?? "",
          origin: trip.origin,
          destination: trip.destination,
          startsAt,
          endsAt,
          vehicleId: lane.vehicleId,
          driverId,
          notes: trip.notes ?? "",
          priceMinor: trip.priceMinor,
          pricingMode: trip.pricingMode,
          customData: trip.customData ?? {},
        }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Не удалось перенести рейс."
        throw new Error(message)
      }
      setNotice(`${trip.origin} → ${trip.destination}: рейс перенесён.`)
      setRequestVersion((version) => version + 1)
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Не удалось перенести рейс."
      )
    } finally {
      setIsRescheduling(false)
    }
  }

  return (
    <>
      <AppShell pageTitle="Рейсы" utilities={<ThemeCustomizer />}>
        <div className="mx-auto max-w-[1800px] space-y-5">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Link className="hover:text-foreground" href="/">
                  Обзор
                </Link>
                <span>/</span>
                <span>Рейсы</span>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-[-0.035em] sm:text-3xl">
                Планирование рейсов
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Назначайте транспорт без накладок и держите день под контролем.
              </p>
            </div>
            <Button onClick={openCreateTrip} size="lg">
              <HugeiconsIcon icon={Add01Icon} size={18} />
              Создать рейс
            </Button>
          </div>
          {notice ? (
            <div className="flex items-center justify-between rounded-2xl border border-primary/35 bg-primary/10 px-4 py-3 text-sm">
              <span>{notice}</span>
              <button
                aria-label="Закрыть уведомление"
                className="text-primary"
                onClick={() => setNotice(null)}
                type="button"
              >
                ×
              </button>
            </div>
          ) : null}
          <section className="surface-card overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-border p-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-2">
                <Button
                  aria-label="Предыдущая неделя"
                  onClick={() =>
                    setWeekStart((current) => addDays(current, -7))
                  }
                  size="icon"
                  variant="outline"
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={18} />
                </Button>
                <div className="min-w-36 text-center">
                  <p className="font-bold">{weekLabel}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {weekStart.getFullYear()} · локальная база
                  </p>
                </div>
                <Button
                  aria-label="Следующая неделя"
                  onClick={() => setWeekStart((current) => addDays(current, 7))}
                  size="icon"
                  variant="outline"
                >
                  <HugeiconsIcon icon={ArrowRight01Icon} size={18} />
                </Button>
              </div>
              <div className="flex flex-1 items-center gap-1 rounded-2xl border border-border bg-background/60 p-1">
                {days.map((item, index) => (
                  <button
                    className={cn(
                      "min-w-0 flex-1 rounded-xl px-1 py-2 text-center transition-colors",
                      selectedDay === index
                        ? "bg-secondary text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    key={item.iso}
                    onClick={() => setSelectedDay(index)}
                    type="button"
                  >
                    <span className="block text-xs font-bold uppercase">
                      {item.short}
                    </span>
                    <span className="mt-1 block text-sm font-bold">
                      {item.date}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1">
                <HugeiconsIcon
                  className="text-muted-foreground"
                  icon={FilterIcon}
                  size={17}
                />
                <FilterPill
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                >
                  Все
                </FilterPill>
                <FilterPill
                  active={filter === "regular"}
                  onClick={() => setFilter("regular")}
                >
                  Регулярные
                </FilterPill>
                <FilterPill
                  active={filter === "custom"}
                  onClick={() => setFilter("custom")}
                >
                  Индивидуальные
                </FilterPill>
              </div>
              <p aria-live="polite" className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {day.full}
                </span>{" "}
                · {filterContext}
              </p>
            </div>
            {loadError ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-destructive/35 bg-destructive/10 px-4 py-3 text-sm">
                <span role="alert">{loadError}</span>
                <Button
                  onClick={() => setRequestVersion((version) => version + 1)}
                  size="sm"
                  variant="outline"
                >
                  Повторить
                </Button>
              </div>
            ) : null}
            <div className="hidden overflow-x-auto md:block" id="calendar">
              <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                Перетяните черновик, новый или назначенный рейс на нужную машину и время. Водитель сохраняется; шаг — 15 минут.
              </p>
              <div className="min-w-[960px]">
                <div className="grid grid-cols-[15rem_repeat(9,minmax(5rem,1fr))] border-b border-border text-xs text-muted-foreground">
                  <div className="p-4 font-semibold">Транспорт и водитель</div>
                  {[
                    "06:00",
                    "08:00",
                    "10:00",
                    "12:00",
                    "14:00",
                    "16:00",
                    "18:00",
                    "20:00",
                    "22:00",
                  ].map((time) => (
                    <div
                      className="border-l border-border px-3 py-4 tabular-nums"
                      key={time}
                    >
                      {time}
                    </div>
                  ))}
                </div>
                {isLoading ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Загружаем рейсы на выбранную дату…
                  </div>
                ) : null}
                {!isLoading && lanes.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    На {day.full} доступных автобусов пока нет. Добавьте транспорт
                    в автопарк, чтобы планировать рейсы.
                  </div>
                ) : null}
                {!isLoading
                  ? lanes.map((lane) => (
                      <div
                        className="grid grid-cols-[15rem_minmax(40rem,1fr)] border-b border-border last:border-0"
                        key={lane.vehicle}
                      >
                        <div className="p-4">
                          <p className="text-sm font-bold">{lane.vehicle}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {lane.driver} · {lane.capacity}
                          </p>
                        </div>
                        <div
                          className={cn(
                            "calendar-lane relative min-h-20 border-l border-border",
                            draggingTripID && "bg-primary/5"
                          )}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => void rescheduleTrip(event, lane)}
                        >
                          {lane.trips
                            .filter((trip) => showTrip(trip.kind))
                            .map((trip) => (
                              <button
                                className={cn(
                                  "calendar-trip absolute top-3 flex h-14 flex-col justify-center overflow-hidden rounded-xl px-3 text-left text-xs font-semibold transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-75",
                                  `calendar-${trip.tone}`
                                )}
                                disabled={isRescheduling}
                                draggable={["draft", "new", "assigned"].includes(trip.status)}
                                key={`${lane.vehicle}-${trip.title}`}
                                onDragEnd={() => setDraggingTripID(null)}
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move"
                                  event.dataTransfer.setData("text/plain", trip.id)
                                  setDraggingTripID(trip.id)
                                }}
                                onClick={() => {
                                  setSelectedTripError(null)
                                  setIsCancelConfirmation(false)
                                  setSelectedTrip(trip)
                                }}
                                style={{ left: trip.left, width: trip.width }}
                                type="button"
                              >
                                <span className="truncate">{trip.title}</span>
                                <span className="mt-1 text-xs font-medium opacity-75">
                                  {trip.time} · {trip.kindLabel}
                                </span>
                              </button>
                            ))}
                        </div>
                      </div>
                    ))
                  : null}
              </div>
            </div>
            <div className="divide-y divide-border md:hidden">
              {isLoading ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Загружаем рейсы…
                </p>
              ) : null}
              {!isLoading
                ? filteredTrips.map((trip) => (
                    <button
                      className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-muted/50"
                      key={`${trip.vehicle}-${trip.title}`}
                      onClick={() => {
                        setSelectedTripError(null)
                        setIsCancelConfirmation(false)
                        setSelectedTrip(trip)
                      }}
                      type="button"
                    >
                      <span
                        className={cn(
                          "grid size-10 shrink-0 place-items-center rounded-xl",
                          `calendar-${trip.tone}`
                        )}
                      >
                        <HugeiconsIcon icon={Car01Icon} size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">
                          {trip.title}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {trip.time} · {trip.vehicle}
                        </span>
                      </span>
                      <span className="text-xs font-bold text-muted-foreground">
                        {trip.kind === "regular" ? "Рейс" : "Трансфер"}
                      </span>
                    </button>
                  ))
                : null}
              {!isLoading && filteredTrips.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Для выбранного фильтра нет рейсов.
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary" />
                Регулярный рейс
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-violet-400" />
                Индивидуальный трансфер
              </span>
              <Button size="icon" variant="ghost">
                <HugeiconsIcon icon={MoreHorizontalIcon} />
                <span className="sr-only">Дополнительные действия</span>
              </Button>
            </div>
          </section>
        </div>
      </AppShell>
      {isCreateOpen ? (
        <div
          aria-labelledby="create-trip-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSubmitting)
              setIsCreateOpen(false)
          }}
          role="dialog"
        >
          <form
            className="max-h-[94svh] w-full overflow-y-auto rounded-t-[var(--app-radius)] border border-border bg-card p-5 shadow-2xl sm:max-w-2xl sm:rounded-[var(--app-radius)] sm:p-6"
            onSubmit={submitTrip}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-xl font-bold tracking-[-0.03em]"
                  id="create-trip-title"
                >
                  {editingTripID ? "Изменить рейс" : "Новый рейс"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Время указывается по часовому поясу компании.
                </p>
              </div>
              <Button
                disabled={isSubmitting}
                onClick={() => {
                  setIsCreateOpen(false)
                  setEditingTripID(null)
                }}
                type="button"
                variant="ghost"
              >
                Отмена
              </Button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Тип рейса
                <select
                  className="h-11 rounded-xl border border-border bg-background px-3 text-sm font-medium transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  onChange={(event) =>
                    setTripForm((current) => ({
                      ...current,
                      kind: event.target.value as TripForm["kind"],
                      routeId:
                        event.target.value === "regular" ? current.routeId : "",
                      repeatUntil:
                        event.target.value === "regular" ? current.repeatUntil : "",
                    }))
                  }
                  value={tripForm.kind}
                >
                  <option value="regular">Регулярный</option>
                  <option value="individual">Индивидуальный</option>
                </select>
              </label>
              {tripForm.kind === "regular" ? (
                <label className="grid gap-2 text-sm font-semibold">
                  Шаблон маршрута
                  <select
                    className="h-11 rounded-xl border border-border bg-background px-3 text-sm transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isResourcesLoading}
                    onChange={(event) => {
                      const route = resources.routes.find(
                        (item) => item.id === event.target.value
                      )
                      setTripForm((current) => ({
                        ...current,
                        routeId: event.target.value,
                        origin: route?.origin ?? current.origin,
                        destination: route?.destination ?? current.destination,
                        price: route
                          ? (route.defaultPriceMinor / 100).toFixed(2)
                          : current.price,
                        pricingMode:
                          route?.defaultPricingMode ?? current.pricingMode,
                      }))
                    }}
                    value={tripForm.routeId}
                  >
                    <option value="">Ввести маршрут вручную</option>
                    {resources.routes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.name} ·{" "}
                        {(route.defaultPriceMinor / 100).toFixed(2)}{" "}
                        {route.currency}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="grid gap-2 text-sm font-semibold">
                Транспорт
                <select
                  className="h-11 rounded-xl border border-border bg-background px-3 text-sm transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={
                    isResourcesLoading || resources.vehicles.length === 0
                  }
                  onChange={(event) =>
                    setTripForm((current) => ({
                      ...current,
                      vehicleId: event.target.value,
                    }))
                  }
                  required
                  value={tripForm.vehicleId}
                >
                  <option value="">
                    {isResourcesLoading
                      ? "Загружаем транспорт…"
                      : "Выберите транспорт"}
                  </option>
                  {resources.vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.name}
                      {vehicle.capacity ? ` · ${vehicle.capacity} мест` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Откуда
                <input
                  className="h-11 rounded-xl border border-border bg-background px-3 text-sm transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
                  disabled={
                    tripForm.kind === "regular" && tripForm.routeId !== ""
                  }
                  maxLength={120}
                  onChange={(event) =>
                    setTripForm((current) => ({
                      ...current,
                      origin: event.target.value,
                    }))
                  }
                  placeholder="Например, Варшава"
                  required
                  value={tripForm.origin}
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Куда
                <input
                  className="h-11 rounded-xl border border-border bg-background px-3 text-sm transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
                  disabled={
                    tripForm.kind === "regular" && tripForm.routeId !== ""
                  }
                  maxLength={120}
                  onChange={(event) =>
                    setTripForm((current) => ({
                      ...current,
                      destination: event.target.value,
                    }))
                  }
                  placeholder="Например, Киев"
                  required
                  value={tripForm.destination}
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Отправление
                <input
                  className="h-11 rounded-xl border border-border bg-background px-3 text-sm transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  onChange={(event) =>
                    setTripForm((current) => ({
                      ...current,
                      startsAt: event.target.value,
                    }))
                  }
                  required
                  type="datetime-local"
                  value={tripForm.startsAt}
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Прибытие
                <input
                  className="h-11 rounded-xl border border-border bg-background px-3 text-sm transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  onChange={(event) =>
                    setTripForm((current) => ({
                      ...current,
                      endsAt: event.target.value,
                    }))
                  }
                  required
                  type="datetime-local"
                  value={tripForm.endsAt}
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Модель цены
                <select
                  className="h-11 rounded-xl border border-border bg-background px-3 text-sm transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  onChange={(event) =>
                    setTripForm((current) => ({
                      ...current,
                      pricingMode: event.target.value as TripForm["pricingMode"],
                    }))
                  }
                  value={tripForm.pricingMode}
                >
                  <option value="per_passenger">За пассажира</option>
                  <option value="per_booking">За всю бронь</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                {tripForm.pricingMode === "per_booking"
                  ? "Цена за всю бронь"
                  : "Цена за пассажира"} · {resources.currency}
                <input
                  className="h-11 rounded-xl border border-border bg-background px-3 text-sm tabular-nums transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
                  disabled={isResourcesLoading}
                  inputMode="decimal"
                  max="100000000"
                  min="0"
                  onChange={(event) =>
                    setTripForm((current) => ({
                      ...current,
                      price: event.target.value,
                    }))
                  }
                  placeholder="Например, 79"
                  required
                  step="0.01"
                  type="number"
                  value={tripForm.price}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  {tripForm.pricingMode === "per_booking"
                    ? "Сумма не меняется от количества пассажиров."
                    : "Сумма брони рассчитывается по количеству пассажиров."}
                </span>
              </label>
              {tripForm.kind === "regular" && !editingTripID ? (
                <div className="grid gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:col-span-2">
                  <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
                    <p className="text-sm font-semibold">Регулярный график</p>
                    <p className="text-xs text-muted-foreground">
                      Необязательно: создаёт рейсы одной серией, максимум 90.
                    </p>
                  </div>
                  <label className="grid gap-2 text-sm font-semibold sm:max-w-xs">
                    Повторять еженедельно до
                    <input
                      className="h-11 rounded-xl border border-border bg-background px-3 text-sm transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                      min={tripForm.startsAt.slice(0, 10)}
                      onChange={(event) =>
                        setTripForm((current) => ({
                          ...current,
                          repeatUntil: event.target.value,
                        }))
                      }
                      type="date"
                      value={tripForm.repeatUntil}
                    />
                  </label>
                  {tripForm.repeatUntil ? (
                    <div className="grid gap-2">
                      <span className="text-sm font-semibold">Дни отправления</span>
                      <div className="flex flex-wrap gap-2">
                        {weekdayOptions.map((weekday) => {
                          const selected = tripForm.weekdays.includes(weekday.value)
                          return (
                            <button
                              aria-pressed={selected}
                              className={cn(
                                "h-9 min-w-10 rounded-xl border px-3 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background text-muted-foreground hover:text-foreground"
                              )}
                              key={weekday.value}
                              onClick={() =>
                                setTripForm((current) => ({
                                  ...current,
                                  weekdays: current.weekdays.includes(weekday.value)
                                    ? current.weekdays.filter((value) => value !== weekday.value)
                                    : [...current.weekdays, weekday.value],
                                }))
                              }
                              type="button"
                            >
                              {weekday.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
                Водитель
                <select
                  className="h-11 rounded-xl border border-border bg-background px-3 text-sm transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={
                    isResourcesLoading || resources.drivers.length === 0
                  }
                  onChange={(event) =>
                    setTripForm((current) => ({
                      ...current,
                      driverId: event.target.value,
                    }))
                  }
                  required
                  value={tripForm.driverId}
                >
                  <option value="">
                    {isResourcesLoading
                      ? "Загружаем водителей…"
                      : "Выберите водителя"}
                  </option>
                  {resources.drivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
                Комментарий{" "}
                <span className="font-normal text-muted-foreground">
                  (необязательно)
                </span>
                <textarea
                  className="min-h-24 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
                  maxLength={2000}
                  onChange={(event) =>
                    setTripForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Особые условия или детали рейса"
                  value={tripForm.notes}
                />
              </label>
            </div>
            <CustomDataFields
              disabled={isSubmitting || isResourcesLoading}
              fields={tripCustomFields}
              onChange={(customData) =>
                setTripForm((current) => ({ ...current, customData }))
              }
              values={tripForm.customData}
            />
            {resourceError || formError ? (
              <p
                className="mt-4 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-foreground"
                role="alert"
              >
                {formError ?? resourceError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button
                className="order-2 sm:order-1"
                disabled={isSubmitting}
                onClick={() => setIsCreateOpen(false)}
                type="button"
                variant="outline"
              >
                Отмена
              </Button>
              <Button
                disabled={isSubmitting || isResourcesLoading || !!resourceError}
                type="submit"
              >
                {isSubmitting
                  ? "Сохраняем рейс…"
                  : editingTripID
                    ? "Сохранить изменения"
                    : "Создать рейс"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
      {selectedTrip ? (
        <div
          aria-labelledby="trip-card-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isStatusSubmitting) {
              setSelectedTrip(null)
              setIsCancelConfirmation(false)
            }
          }}
          role="dialog"
        >
          <section className="w-full rounded-t-[var(--app-radius)] border border-border bg-card p-5 shadow-2xl sm:max-w-lg sm:rounded-[var(--app-radius)] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold text-primary">
                  {selectedTrip.kindLabel}
                </p>
                <h2
                  className="mt-1 truncate text-xl font-bold tracking-[-0.03em]"
                  id="trip-card-title"
                >
                  {selectedTrip.title}
                </h2>
              </div>
              <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-bold">
                {tripStatusLabels[selectedTrip.status] ?? selectedTrip.status}
              </span>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 border-y border-border py-5 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Время</dt>
                <dd className="mt-1 font-bold tabular-nums">
                  {selectedTrip.time}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Места</dt>
                <dd className="mt-1 font-bold">{selectedTrip.capacity}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Транспорт</dt>
                <dd className="mt-1 truncate font-bold">
                  {selectedTrip.vehicle}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Водитель</dt>
                <dd className="mt-1 truncate font-bold">
                  {selectedTrip.driver}
                </dd>
              </div>
            </dl>
            {selectedTripError ? (
              <p
                className="mt-4 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm"
                role="alert"
              >
                {selectedTripError}
              </p>
            ) : null}
            {isCancelConfirmation ? (
              <div className="mt-5 rounded-2xl border border-destructive/35 bg-destructive/10 p-4">
                <p className="text-sm font-bold">Отменить этот рейс?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Рейс исчезнет из активного расписания. Вернуть его обратно
                  нельзя.
                </p>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    disabled={isStatusSubmitting}
                    onClick={() => setIsCancelConfirmation(false)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Не отменять
                  </Button>
                  <Button
                    disabled={isStatusSubmitting}
                    onClick={() => void changeSelectedTripStatus("cancelled")}
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    {isStatusSubmitting ? "Отменяем…" : "Подтвердить отмену"}
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button
                className="order-2 sm:order-1"
                disabled={isStatusSubmitting}
                onClick={() => {
                  setSelectedTrip(null)
                  setIsCancelConfirmation(false)
                }}
                type="button"
                variant="outline"
              >
                Закрыть
              </Button>
              {["new", "assigned"].includes(selectedTrip.status) ? (
                <Button
                  className="order-1 sm:order-2"
                  disabled={isStatusSubmitting}
                  onClick={() => {
                    setTripForm({
                      kind: selectedTrip.kind,
                      routeId: selectedTrip.routeId ?? "",
                      origin: selectedTrip.origin,
                      destination: selectedTrip.destination,
                      startsAt: toLocalDateTimeInput(
                        selectedTrip.startsAt,
                        scheduleTimeZone
                      ),
                      endsAt: toLocalDateTimeInput(
                        selectedTrip.endsAt,
                        scheduleTimeZone
                      ),
                      vehicleId: selectedTrip.vehicleId ?? "",
                      driverId: selectedTrip.driverId ?? "",
                      notes: selectedTrip.notes ?? "",
                      price: (selectedTrip.priceMinor / 100).toFixed(2),
                      pricingMode: selectedTrip.pricingMode,
                      repeatUntil: "",
                      weekdays: [],
                      customData: Object.fromEntries(
                        Object.entries(selectedTrip.customData ?? {}).map(
                          ([key, value]) => [
                            key,
                            typeof value === "number" ? String(value) : value,
                          ]
                        )
                      ) as CustomDataValues,
                    })
                    setEditingTripID(selectedTrip.id)
                    setSelectedTrip(null)
                    setIsCancelConfirmation(false)
                    setFormError(null)
                    setIsCreateOpen(true)
                  }}
                  type="button"
                  variant="outline"
                >
                  Изменить
                </Button>
              ) : null}
              {selectedTrip.status === "new" ? (
                <Button
                  className="order-1 sm:order-2"
                  disabled={isStatusSubmitting}
                  onClick={() => void changeSelectedTripStatus("assigned")}
                  type="button"
                >
                  {isStatusSubmitting ? "Сохраняем…" : "Подтвердить назначение"}
                </Button>
              ) : null}
              {selectedTrip.status === "assigned" ? (
                <Button
                  className="order-1 sm:order-2"
                  disabled={isStatusSubmitting}
                  onClick={() => void changeSelectedTripStatus("in_progress")}
                  type="button"
                >
                  {isStatusSubmitting ? "Запускаем…" : "Начать рейс"}
                </Button>
              ) : null}
              {selectedTrip.status === "in_progress" ? (
                <Button
                  className="order-1 sm:order-2"
                  disabled={isStatusSubmitting}
                  onClick={() => void changeSelectedTripStatus("completed")}
                  type="button"
                >
                  {isStatusSubmitting ? "Завершаем…" : "Завершить рейс"}
                </Button>
              ) : null}
              {!["completed", "cancelled"].includes(selectedTrip.status) &&
              !isCancelConfirmation ? (
                <Button
                  className="order-3"
                  disabled={isStatusSubmitting}
                  onClick={() => setIsCancelConfirmation(true)}
                  type="button"
                  variant="destructive"
                >
                  Отменить рейс
                </Button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
