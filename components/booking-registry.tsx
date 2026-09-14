"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  Calendar01Icon,
  RefreshIcon,
  Search01Icon,
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
import { FieldSelect } from "@/components/ui/field-select"

type BookingStatus =
  | "pending"
  | "awaiting_payment"
  | "cash_on_boarding"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "expired"

type Booking = {
  id: string
  status: BookingStatus
  seats: number
  priceMinor: number
  currency: string
  source: "telegram" | "dispatcher" | "import"
  createdAt: string
  customerName: string
  customerPhone: string
  tripId: string
  tripStatus: string
  origin: string
  destination: string
  startsAt: string
  capacity: number
  availableSeats: number
  paymentID?: string
  paymentStatus?: string
  paymentMethod?: string
  paymentHoldExpiresAt?: string
  customData?: Record<string, unknown>
}

type BookingCollection = { items: Booking[]; timezone: string }

type BookingTrip = {
  id: string
  status: string
  origin: string
  destination: string
  startsAt: string
  capacity: number
  priceMinor: number
  currency: string
}

type CustomerOption = { id: string; fullName: string; phone: string }

type BookingForm = {
  date: string
  tripId: string
  customerId: string
  seats: string
  passengerName: string
  passengerPhone: string
  passengerBirthDate: string
  customData: CustomDataValues
}

const statusLabels: Record<BookingStatus, string> = {
  pending: "Ожидает",
  awaiting_payment: "Ожидает оплату",
  cash_on_boarding: "Наличными при посадке",
  confirmed: "Подтверждено",
  cancelled: "Отменено",
  completed: "Завершено",
  expired: "Срок оплаты истёк",
}
const sourceLabels: Record<Booking["source"], string> = {
  telegram: "Telegram",
  dispatcher: "Диспетчер",
  import: "Импорт",
}

function isCollection(value: unknown): value is BookingCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items) &&
    "timezone" in value &&
    typeof value.timezone === "string"
  )
}

function isTripCollection(value: unknown): value is { items: BookingTrip[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
}

function isCustomerCollection(
  value: unknown
): value is { items: CustomerOption[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
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

function todayISODate() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function emptyBookingForm(): BookingForm {
  return {
    date: todayISODate(),
    tripId: "",
    customerId: "",
    seats: "1",
    passengerName: "",
    passengerPhone: "",
    passengerBirthDate: "",
    customData: {},
  }
}

function errorFrom(value: unknown, fallback: string) {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback
}

function formatDate(value: string, timeZone: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "Нет даты"
    : new Intl.DateTimeFormat("ru-RU", {
        timeZone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
}

function formatBirthDate(value: unknown) {
  if (typeof value !== "string") return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : null
}

function customText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount / 100)
}

function statusClass(status: BookingStatus) {
  return {
    pending: "status-gold",
    awaiting_payment: "status-gold",
    cash_on_boarding: "status-sky",
    confirmed: "status-sky",
    cancelled: "status-slate",
    completed: "status-violet",
    expired: "status-slate",
  }[status]
}

export function BookingRegistry() {
  const [items, setItems] = React.useState<Booking[]>([])
  const [timezone, setTimezone] = React.useState("Europe/Berlin")
  const [loading, setLoading] = React.useState(true)
  const [cancellingID, setCancellingID] = React.useState<string | null>(null)
  const [confirmingID, setConfirmingID] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<"" | BookingStatus>("")
  const [query, setQuery] = React.useState("")
  const [date, setDate] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [isCreateLoading, setIsCreateLoading] = React.useState(false)
  const [isCreating, setIsCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [bookableTrips, setBookableTrips] = React.useState<BookingTrip[]>([])
  const [customers, setCustomers] = React.useState<CustomerOption[]>([])
  const [bookingCustomFields, setBookingCustomFields] = React.useState<
    CustomDataField[]
  >([])
  const [bookingForm, setBookingForm] =
    React.useState<BookingForm>(emptyBookingForm)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: "200" })
    if (status) params.set("status", status)
    if (query.trim()) params.set("q", query.trim())
    if (date) params.set("date", date)
    try {
      const response = await sessionFetch(`/api/bookings?${params.toString()}`, {
        cache: "no-store",
      })
      const payload: unknown = await response.json()
      if (!response.ok || !isCollection(payload))
        throw new Error(
          errorFrom(payload, "Не удалось загрузить бронирования.")
        )
      setItems(payload.items)
      setTimezone(payload.timezone)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить бронирования."
      )
    } finally {
      setLoading(false)
    }
  }, [date, query, status])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  React.useEffect(() => {
    if (!isCreateOpen) return
    const controller = new AbortController()
    async function loadCreateData() {
      setIsCreateLoading(true)
      setCreateError(null)
      try {
        const [tripsResponse, customersResponse, fieldsResponse] =
          await Promise.all([
            sessionFetch(`/api/trips?date=${encodeURIComponent(bookingForm.date)}`, {
              signal: controller.signal,
            }),
            sessionFetch("/api/customers?limit=100", { signal: controller.signal }),
            sessionFetch("/api/custom-fields?entity=booking", {
              signal: controller.signal,
            }),
          ])
        const [tripsPayload, customersPayload, fieldsPayload]: [
          unknown,
          unknown,
          unknown,
        ] = await Promise.all([
          tripsResponse.json(),
          customersResponse.json(),
          fieldsResponse.json(),
        ])
        if (
          !tripsResponse.ok ||
          !isTripCollection(tripsPayload) ||
          !customersResponse.ok ||
          !isCustomerCollection(customersPayload) ||
          !fieldsResponse.ok ||
          !isCustomFieldCollection(fieldsPayload)
        ) {
          throw new Error("Не удалось загрузить данные для бронирования.")
        }
        setBookableTrips(
          tripsPayload.items.filter(
            (trip) => !["cancelled", "completed"].includes(trip.status)
          )
        )
        setCustomers(customersPayload.items)
        setBookingCustomFields(
          fieldsPayload.items.filter((field) => field.isActive)
        )
      } catch (reason) {
        if (controller.signal.aborted) return
        setBookableTrips([])
        setCustomers([])
        setBookingCustomFields([])
        setCreateError(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить данные для бронирования."
        )
      } finally {
        if (!controller.signal.aborted) setIsCreateLoading(false)
      }
    }
    void loadCreateData()
    return () => controller.abort()
  }, [bookingForm.date, isCreateOpen])

  function openCreateBooking() {
    setBookingForm(emptyBookingForm())
    setCreateError(null)
    setIsCreateOpen(true)
  }

  async function createBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreateError(null)
    const seats = Number.parseInt(bookingForm.seats, 10)
    if (
      !bookingForm.tripId ||
      !bookingForm.customerId ||
      !Number.isInteger(seats) ||
      seats < 1 ||
      seats > 20 ||
      !bookingForm.passengerName.trim() ||
      !bookingForm.passengerPhone.trim() ||
      !bookingForm.passengerBirthDate
    ) {
      setCreateError(
        "Выберите рейс и клиента, укажите от 1 до 20 мест и заполните данные пассажира."
      )
      return
    }
    setIsCreating(true)
    try {
      const response = await sessionFetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId: bookingForm.tripId,
          customerId: bookingForm.customerId,
          seats,
          passengerName: bookingForm.passengerName,
          passengerPhone: bookingForm.passengerPhone,
          passengerBirthDate: bookingForm.passengerBirthDate,
          customData: serializeCustomData(
            bookingCustomFields,
            bookingForm.customData
          ),
        }),
      })
      const payload: unknown = await response.json()
      if (!response.ok)
        throw new Error(errorFrom(payload, "Не удалось создать бронирование."))
      setIsCreateOpen(false)
      setNotice(
        "Бронирование создано. Стоимость рейса зафиксирована в журнале и финансах."
      )
      await load()
    } catch (reason) {
      setCreateError(
        reason instanceof Error
          ? reason.message
          : "Не удалось создать бронирование."
      )
    } finally {
      setIsCreating(false)
    }
  }

  async function cancelBooking(booking: Booking) {
    if (
      !window.confirm(
        `Отменить бронирование ${booking.customerName || booking.customerPhone}? Места снова станут доступны.`
      )
    )
      return
    setCancellingID(booking.id)
    setError(null)
    setNotice(null)
    try {
      const response = await sessionFetch(
        `/api/bookings?id=${encodeURIComponent(booking.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cancelled" }),
        }
      )
      const payload: unknown = await response.json()
      if (!response.ok)
        throw new Error(errorFrom(payload, "Не удалось отменить бронирование."))
      setNotice("Бронирование отменено, места возвращены в доступные.")
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось отменить бронирование."
      )
    } finally {
      setCancellingID(null)
    }
  }

  async function confirmTransfer(booking: Booking) {
    setConfirmingID(booking.id)
    setError(null)
    setNotice(null)
    try {
      const response = await sessionFetch(
        `/api/bookings?id=${encodeURIComponent(booking.id)}&action=confirm-payment`,
        { method: "POST" }
      )
      const payload: unknown = await response.json()
      if (!response.ok)
        throw new Error(errorFrom(payload, "Не удалось подтвердить перевод."))
      setNotice(
        "Перевод подтверждён: бронь и оплата переведены в статус «Подтверждено»."
      )
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось подтвердить перевод."
      )
    } finally {
      setConfirmingID(null)
    }
  }

  return (
    <>
      <AppShell pageTitle="Бронирования" utilities={<ThemeCustomizer />}>
        <div className="mx-auto max-w-[1600px] space-y-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-bold tracking-[-.035em] sm:text-3xl">
                Журнал бронирований
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Пассажиры из Telegram и ручные брони. При отмене место сразу
                возвращается в рейс.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={openCreateBooking}>
                <HugeiconsIcon icon={Add01Icon} size={17} />
                Новая бронь
              </Button>
              <Button
                disabled={loading}
                onClick={() => void load()}
                variant="outline"
              >
                <HugeiconsIcon icon={RefreshIcon} size={17} />
                Обновить
              </Button>
            </div>
          </div>
          {error ? (
            <div
              className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
              {notice}
            </div>
          ) : null}
          <section className="surface-card p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_11rem_11rem]">
              <label className="relative block">
                <span className="sr-only">Поиск бронирований</span>
                <HugeiconsIcon
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                  icon={Search01Icon}
                  size={17}
                />
                <input
                  className="h-11 w-full rounded-xl border border-border bg-background pr-3 pl-10 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Пассажир, телефон или маршрут"
                  value={query}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                Статус
                <FieldSelect
                  onValueChange={(value) =>
                    setStatus(value as "" | BookingStatus)
                  }
                  options={[
                    { value: "", label: "Все статусы" },
                    ...(Object.keys(statusLabels) as BookingStatus[]).map(
                      (item) => ({ value: item, label: statusLabels[item] })
                    ),
                  ]}
                  value={status}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                Дата рейса
                <div className="relative">
                  <HugeiconsIcon
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                    icon={Calendar01Icon}
                    size={16}
                  />
                  <input
                    className="h-11 w-full rounded-xl border border-border bg-background pr-3 pl-10 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    onChange={(event) => setDate(event.target.value)}
                    type="date"
                    value={date}
                  />
                </div>
              </label>
            </div>
          </section>
          <section className="surface-card overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_9rem] gap-3 border-b border-border px-5 py-3 text-xs font-semibold text-muted-foreground md:grid-cols-[minmax(14rem,1.2fr)_minmax(12rem,1fr)_5rem_8rem_8rem]">
              <span>Пассажир и рейс</span>
              <span>Места</span>
              <span className="text-right">Действие</span>
              <span className="hidden md:block">Статус</span>
              <span className="hidden md:block">Источник</span>
            </div>
            {loading ? (
              <p className="p-5 text-sm text-muted-foreground">
                Загружаем бронирования…
              </p>
            ) : null}
            {!loading && items.length === 0 ? (
              <div className="p-8 text-center">
                <p className="font-semibold">Бронирований не найдено</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Измените фильтры или дождитесь новых заявок из Telegram.
                </p>
              </div>
            ) : null}
            <div className="divide-y divide-border">
              {items.map((booking) => {
                const passengerName =
                  customText(booking.customData?.passenger_name) ??
                  customText(booking.customerName) ??
                  "Без имени"
                const passengerPhone =
                  customText(booking.customData?.passenger_phone) ??
                  booking.customerPhone
                const bookingContact = [
                  booking.customerName,
                  booking.customerPhone,
                ]
                  .filter(Boolean)
                  .join(" · ")
                const passengerDiffers =
                  passengerName !== booking.customerName ||
                  passengerPhone !== booking.customerPhone
                return (
                  <article
                    className="grid grid-cols-[minmax(0,1fr)_7rem_9rem] gap-3 px-5 py-4 md:grid-cols-[minmax(14rem,1.2fr)_minmax(12rem,1fr)_5rem_8rem_8rem] md:items-center"
                    key={booking.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{passengerName}</p>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {passengerPhone}
                      </p>
                      {passengerDiffers && bookingContact ? (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          Контакт брони: {bookingContact}
                        </p>
                      ) : null}
                      <p className="mt-2 truncate text-sm font-medium">
                        {booking.origin} → {booking.destination}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(booking.startsAt, timezone)}
                      </p>
                      {formatBirthDate(
                        booking.customData?.passenger_birth_date
                      ) ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Дата рождения:{" "}
                          {formatBirthDate(
                            booking.customData?.passenger_birth_date
                          )}
                        </p>
                      ) : null}
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <p className="text-sm font-semibold tabular-nums">
                        {booking.availableSeats} / {booking.capacity} свободно
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        После этой брони
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold tabular-nums">
                        {booking.seats}
                      </p>
                      <p className="text-xs text-muted-foreground">мест.</p>
                    </div>
                    <div className="hidden md:block">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusClass(booking.status)}`}
                      >
                        {statusLabels[booking.status]}
                      </span>
                    </div>
                    <div className="hidden text-sm text-muted-foreground md:block">
                      <p>{sourceLabels[booking.source] ?? booking.source}</p>
                      {booking.paymentMethod ? (
                        <p className="mt-1 text-xs">
                          {booking.paymentMethod === "cash"
                            ? "Наличными"
                            : `Банк: ${booking.paymentMethod}`}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2 text-right">
                      {booking.status === "awaiting_payment" ? (
                        <Button
                          disabled={confirmingID === booking.id}
                          onClick={() => void confirmTransfer(booking)}
                          size="sm"
                        >
                          {confirmingID === booking.id
                            ? "Подтверждаем…"
                            : "Подтвердить перевод"}
                        </Button>
                      ) : null}
                      {booking.status === "pending" ||
                      booking.status === "awaiting_payment" ||
                      booking.status === "cash_on_boarding" ||
                      booking.status === "confirmed" ? (
                        <Button
                          disabled={
                            cancellingID === booking.id ||
                            booking.tripStatus === "in_progress" ||
                            booking.tripStatus === "completed"
                          }
                          onClick={() => void cancelBooking(booking)}
                          size="sm"
                          variant="outline"
                        >
                          {cancellingID === booking.id ? "…" : "Отменить"}
                        </Button>
                      ) : null}
                      {booking.status !== "awaiting_payment" &&
                      booking.status !== "pending" &&
                      booking.status !== "cash_on_boarding" &&
                      booking.status !== "confirmed" ? (
                        <span className="text-xs text-muted-foreground">
                          {formatMoney(booking.priceMinor, booking.currency)}
                        </span>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </div>
      </AppShell>
      {isCreateOpen ? (
        <div
          aria-labelledby="create-booking-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isCreating)
              setIsCreateOpen(false)
          }}
          role="dialog"
        >
          <form
            className="max-h-[94svh] w-full overflow-y-auto rounded-t-[var(--app-radius)] border border-border bg-card p-5 shadow-2xl sm:max-w-xl sm:rounded-[var(--app-radius)] sm:p-6"
            onSubmit={createBooking}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-xl font-bold tracking-[-0.03em]"
                  id="create-booking-title"
                >
                  Новая бронь
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Цена и валюта выбранного рейса будут зафиксированы в
                  бронировании.
                </p>
              </div>
              <Button
                aria-label="Закрыть форму бронирования"
                disabled={isCreating}
                onClick={() => setIsCreateOpen(false)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Закрыть
              </Button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Дата рейса
                <input
                  className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  disabled={isCreating}
                  onChange={(event) =>
                    setBookingForm((current) => ({
                      ...current,
                      date: event.target.value,
                      tripId: "",
                    }))
                  }
                  required
                  type="date"
                  value={bookingForm.date}
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Количество мест
                <input
                  className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  disabled={isCreating}
                  max="20"
                  min="1"
                  onChange={(event) =>
                    setBookingForm((current) => ({
                      ...current,
                      seats: event.target.value,
                    }))
                  }
                  required
                  type="number"
                  value={bookingForm.seats}
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
                Рейс
                <FieldSelect
                  disabled={
                    isCreating || isCreateLoading || bookableTrips.length === 0
                  }
                  onValueChange={(value) =>
                    setBookingForm((current) => ({
                      ...current,
                      tripId: value,
                    }))
                  }
                  options={[
                    {
                      value: "",
                      label: isCreateLoading
                        ? "Загружаем рейсы…"
                        : bookableTrips.length === 0
                          ? "На эту дату нет доступных рейсов"
                          : "Выберите рейс",
                    },
                    ...bookableTrips.map((trip) => ({
                      value: trip.id,
                      label: `${trip.origin} → ${trip.destination} · ${formatDate(trip.startsAt, timezone)} · ${formatMoney(trip.priceMinor, trip.currency)}`,
                    })),
                  ]}
                  value={bookingForm.tripId}
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
                Клиент
                <FieldSelect
                  disabled={
                    isCreating || isCreateLoading || customers.length === 0
                  }
                  onValueChange={(value) =>
                    setBookingForm((current) => {
                      const customer = customers.find(
                        (item) => item.id === value
                      )
                      return {
                        ...current,
                        customerId: value,
                        passengerName: customer?.fullName ?? "",
                        passengerPhone: customer?.phone ?? "",
                      }
                    })
                  }
                  options={[
                    {
                      value: "",
                      label: isCreateLoading
                        ? "Загружаем клиентов…"
                        : customers.length === 0
                          ? "Сначала добавьте клиента"
                          : "Выберите клиента",
                    },
                    ...customers.map((customer) => ({
                      value: customer.id,
                      label: `${customer.fullName || "Без имени"} · ${customer.phone}`,
                    })),
                  ]}
                  value={bookingForm.customerId}
                />
              </label>
            </div>
            <fieldset className="mt-5 border-t border-border pt-5">
              <legend className="text-sm font-bold">Данные пассажира</legend>
              <p className="mt-1 text-sm text-muted-foreground">
                Можно указать другого человека. Эти данные сохранятся в брони, а
                не заменят контакт клиента.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
                  Имя и фамилия пассажира
                  <input
                    autoComplete="name"
                    className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    disabled={isCreating || isCreateLoading}
                    maxLength={160}
                    onChange={(event) =>
                      setBookingForm((current) => ({
                        ...current,
                        passengerName: event.target.value,
                      }))
                    }
                    required
                    value={bookingForm.passengerName}
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  Телефон пассажира
                  <input
                    autoComplete="tel"
                    className="h-11 rounded-xl border border-border bg-background px-3 font-normal tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    disabled={isCreating || isCreateLoading}
                    inputMode="tel"
                    onChange={(event) =>
                      setBookingForm((current) => ({
                        ...current,
                        passengerPhone: event.target.value,
                      }))
                    }
                    placeholder="+380…"
                    required
                    type="tel"
                    value={bookingForm.passengerPhone}
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  Дата рождения
                  <input
                    className="h-11 rounded-xl border border-border bg-background px-3 font-normal tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    disabled={isCreating || isCreateLoading}
                    max={todayISODate()}
                    onChange={(event) =>
                      setBookingForm((current) => ({
                        ...current,
                        passengerBirthDate: event.target.value,
                      }))
                    }
                    required
                    type="date"
                    value={bookingForm.passengerBirthDate}
                  />
                </label>
              </div>
            </fieldset>
            <CustomDataFields
              disabled={isCreating || isCreateLoading}
              fields={bookingCustomFields}
              onChange={(customData) =>
                setBookingForm((current) => ({ ...current, customData }))
              }
              values={bookingForm.customData}
            />
            {createError ? (
              <p
                className="mt-4 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm"
                role="alert"
              >
                {createError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                disabled={isCreating}
                onClick={() => setIsCreateOpen(false)}
                type="button"
                variant="outline"
              >
                Отмена
              </Button>
              <Button disabled={isCreating || isCreateLoading} type="submit">
                {isCreating ? "Создаем бронь…" : "Создать бронь"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
