"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  Calendar01Icon,
} from "@hugeicons/core-free-icons"

import { AppShell } from "@/components/app-shell"
import {
  EntityDataView,
  type EntityAction,
  type EntityColumn,
} from "@/components/entity-data-view"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import {
  CustomDataFields,
  serializeCustomData,
  type CustomDataField,
  type CustomDataValues,
} from "@/components/custom-data-fields"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"

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
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
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
      const response = await sessionFetch(
        `/api/bookings?${params.toString()}`,
        {
          cache: "no-store",
        }
      )
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
            sessionFetch(
              `/api/trips?date=${encodeURIComponent(bookingForm.date)}`,
              {
                signal: controller.signal,
              }
            ),
            sessionFetch("/api/customers?limit=100", {
              signal: controller.signal,
            }),
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

  async function cancelBooking(
    booking: Booking,
    confirm = true,
    reload = true
  ) {
    if (
      confirm &&
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
      if (reload) await load()
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

  async function cancelSelected() {
    const targets = items.filter(
      (booking) =>
        selected.has(booking.id) &&
        [
          "pending",
          "awaiting_payment",
          "cash_on_boarding",
          "confirmed",
        ].includes(booking.status) &&
        !["in_progress", "completed"].includes(booking.tripStatus)
    )
    if (
      !targets.length ||
      !window.confirm(`Отменить выбранные бронирования: ${targets.length}?`)
    )
      return
    for (const booking of targets) {
      await cancelBooking(booking, false, false)
    }
    setSelected(new Set())
    await load()
  }

  const columns: EntityColumn<Booking>[] = [
    {
      id: "passenger",
      label: "Пассажир",
      value: (booking) => (
        <div className="min-w-48">
          <p className="font-semibold">
            {customText(booking.customData?.passenger_name) ??
              customText(booking.customerName) ??
              "Без имени"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {customText(booking.customData?.passenger_phone) ??
              booking.customerPhone}
          </p>
        </div>
      ),
    },
    {
      id: "route",
      label: "Рейс",
      value: (booking) => (
        <div className="min-w-44">
          <p>
            {booking.origin} → {booking.destination}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(booking.startsAt, timezone)}
          </p>
        </div>
      ),
    },
    {
      id: "status",
      label: "Статус",
      value: (booking) => (
        <span
          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusClass(booking.status)}`}
        >
          {statusLabels[booking.status]}
        </span>
      ),
    },
    {
      id: "seats",
      label: "Места",
      value: (booking) => <span className="tabular-nums">{booking.seats}</span>,
    },
    {
      id: "price",
      label: "Сумма",
      value: (booking) => (
        <span className="tabular-nums">
          {formatMoney(booking.priceMinor, booking.currency)}
        </span>
      ),
    },
    {
      id: "source",
      label: "Источник",
      value: (booking) => sourceLabels[booking.source] ?? booking.source,
    },
    {
      id: "customerPhone",
      label: "Телефон контакта",
      value: (booking) => booking.customerPhone,
      defaultVisible: false,
    },
    {
      id: "capacity",
      label: "Вместимость",
      value: (booking) => booking.capacity,
      defaultVisible: false,
    },
    {
      id: "availableSeats",
      label: "Свободно",
      value: (booking) => booking.availableSeats,
      defaultVisible: false,
    },
    {
      id: "tripStatus",
      label: "Статус рейса",
      value: (booking) => booking.tripStatus,
      defaultVisible: false,
    },
    {
      id: "paymentStatus",
      label: "Статус оплаты",
      value: (booking) => booking.paymentStatus ?? "—",
      defaultVisible: false,
    },
    {
      id: "paymentMethod",
      label: "Способ оплаты",
      value: (booking) => booking.paymentMethod ?? "—",
      defaultVisible: false,
    },
    {
      id: "createdAt",
      label: "Создано",
      value: (booking) => formatDate(booking.createdAt, timezone),
      defaultVisible: false,
    },
    {
      id: "id",
      label: "ID брони",
      value: (booking) => booking.id,
      defaultVisible: false,
    },
    {
      id: "tripId",
      label: "ID рейса",
      value: (booking) => booking.tripId,
      defaultVisible: false,
    },
    {
      id: "paymentId",
      label: "ID оплаты",
      value: (booking) => booking.paymentID ?? "—",
      defaultVisible: false,
    },
  ]

  const actions: EntityAction<Booking>[] = [
    {
      label: "Подтвердить перевод",
      disabled: (booking) =>
        booking.status !== "awaiting_payment" || confirmingID === booking.id,
      onSelect: (booking) => void confirmTransfer(booking),
    },
    {
      label: "Отменить бронирование",
      destructive: true,
      disabled: (booking) =>
        ![
          "pending",
          "awaiting_payment",
          "cash_on_boarding",
          "confirmed",
        ].includes(booking.status) ||
        ["in_progress", "completed"].includes(booking.tripStatus) ||
        cancellingID === booking.id,
      onSelect: (booking) => void cancelBooking(booking),
    },
  ]

  return (
    <>
      <AppShell
        onRefresh={load}
        refreshing={loading}
        localSearch={{
          value: query,
          onChange: setQuery,
          placeholder: "Пассажир, телефон или маршрут",
        }}
        pageActions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={openCreateBooking}>
              <HugeiconsIcon icon={Add01Icon} size={17} />
              Новая бронь
            </Button>
          </div>
        }
        pageDescription="Пассажиры из Telegram и ручные брони"
        pageTitle="Журнал бронирований"
        utilities={<ThemeCustomizer />}
      >
        <div className="w-full min-w-0 space-y-5">
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
            <div className="grid gap-3 lg:grid-cols-[11rem_11rem]">
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
                  <Input
                    className="h-11 w-full pr-3 pl-10"
                    onChange={(event) => setDate(event.target.value)}
                    type="date"
                    value={date}
                  />
                </div>
              </label>
            </div>
          </section>
          <EntityDataView
            actions={actions}
            bulkActions={
              <Button
                onClick={() => void cancelSelected()}
                size="sm"
                variant="destructive"
              >
                Отменить выбранные
              </Button>
            }
            columns={columns}
            dateValue={(booking) => booking.startsAt.slice(0, 10)}
            emptyText="Бронирований не найдено."
            getId={(booking) => booking.id}
            getLabel={(booking) =>
              customText(booking.customData?.passenger_name) ??
              booking.customerName ??
              booking.customerPhone
            }
            groupBy={(booking) => booking.status}
            items={items}
            kanbanGroups={(Object.keys(statusLabels) as BookingStatus[]).map(
              (bookingStatus) => ({
                id: bookingStatus,
                label: statusLabels[bookingStatus],
              })
            )}
            loading={loading}
            loadingText="Загружаем бронирования…"
            modes={["table", "kanban", "calendar", "gallery"]}
            onSelectedChange={setSelected}
            renderCard={(booking) => (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {customText(booking.customData?.passenger_name) ??
                        booking.customerName ??
                        "Без имени"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {booking.origin} → {booking.destination}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(booking.status)}`}
                  >
                    {statusLabels[booking.status]}
                  </span>
                </div>
                <div className="flex items-end justify-between text-sm">
                  <span className="text-muted-foreground">
                    {formatDate(booking.startsAt, timezone)}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(booking.priceMinor, booking.currency)}
                  </span>
                </div>
              </div>
            )}
            selected={selected}
          />
        </div>
      </AppShell>
      <Dialog
        onOpenChange={(open) => {
          if (!isCreating) setIsCreateOpen(open)
        }}
        open={isCreateOpen}
      >
        <DialogContent
          className="max-h-[94svh] overflow-y-auto sm:max-w-xl"
          showCloseButton={!isCreating}
        >
          <form onSubmit={createBooking}>
            <DialogHeader>
              <DialogTitle>Новая бронь</DialogTitle>
              <DialogDescription>
                Цена и валюта рейса фиксируются в бронировании. Ручная бронь
                оплачивается наличными при посадке.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Дата рейса
                <Input
                  className="h-11"
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
                <Input
                  className="h-11"
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
                  <Input
                    autoComplete="name"
                    className="h-11"
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
                  <Input
                    autoComplete="tel"
                    className="h-11 tabular-nums"
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
                  <Input
                    className="h-11 tabular-nums"
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
        </DialogContent>
      </Dialog>
    </>
  )
}
