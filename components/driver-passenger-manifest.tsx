"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { sessionFetch } from "@/lib/session-navigation"
import { realtimeEvent } from "@/lib/realtime"
import type { CheckoutPassenger } from "@/lib/booking-checkout"

type ManifestBooking = {
  id: string
  recordNumber: string
  name: string
  phone: string
  seats: number
  passengers: CheckoutPassenger[]
  paymentMethod: string
  paymentStatus: string
  amountMinor: number
  currency: string
  boarding: Record<string, string>
  cashMinor: number
}
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(
    amount / 100
  )
async function checkin(body: object) {
  const response = await sessionFetch("/api/driver-passengers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      data?.error ?? "Не удалось сохранить отметку. Повторите попытку."
    )
  return data as { boarding: Record<string, string>; cashMinor: number }
}
function BoardingSelect({
  tripId,
  booking,
  index,
  name,
  onChange,
}: {
  tripId: string
  booking: ManifestBooking
  index: number
  name: string
  onChange: () => void
}) {
  const initial = booking.boarding?.[String(index)] ?? "waiting"
  const [value, setValue] = React.useState(initial)
  const [failure, setFailure] = React.useState("")
  const draft = React.useRef(initial)
  const dirty = React.useRef(false)
  const autosave = useFieldAutosave<{ boarding: string }>(async (input) => {
    try {
      await checkin({
        tripId,
        bookingId: booking.id,
        passengerIndex: index,
        boarding: input.boarding,
      })
      if (draft.current === input.boarding) {
        dirty.current = false
        setFailure("")
      }
      onChange()
      return input
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Не удалось сохранить посадку."
      )
      throw error
    }
  })
  React.useEffect(() => {
    if (!dirty.current) {
      autosave.initialize({ boarding: initial })
      draft.current = initial
      setValue(initial)
    }
  }, [autosave, initial])
  const commit = (next: string) => {
    draft.current = next
    dirty.current = true
    setValue(next)
    void autosave.commit({ boarding: next })
  }
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-2">
      <span className="min-w-0 text-sm font-medium break-words">{name}</span>
      <FieldSelect
        aria-label={`Посадка: ${name}`}
        value={value}
        onValueChange={commit}
        options={[
          { value: "waiting", label: "Ожидаем" },
          { value: "boarded", label: "Пришёл" },
          { value: "absent", label: "Не пришёл" },
        ]}
      />
      {failure ? (
        <div className="col-span-2 text-xs text-destructive" role="alert">
          {failure}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => commit(draft.current)}
          >
            Повторить
          </Button>
        </div>
      ) : null}
    </div>
  )
}
export function DriverPassengerManifest({
  tripId,
  onChange,
}: {
  tripId: string
  onChange?: () => void
}) {
  const [items, setItems] = React.useState<ManifestBooking[] | null>(null)
  const [error, setError] = React.useState("")
  const [retry, setRetry] = React.useState(0)
  const [payment, setPayment] = React.useState<ManifestBooking | null>(null)
  const [amount, setAmount] = React.useState("")
  const [paying, setPaying] = React.useState(false)
  const [paymentError, setPaymentError] = React.useState("")
  const refresh = React.useCallback(() => {
    setRetry((v) => v + 1)
    onChange?.()
  }, [onChange])
  React.useEffect(() => {
    const controller = new AbortController()
    let fetching = false
    async function load() {
      if (fetching) return
      fetching = true
      try {
        const response = await sessionFetch(
          `/api/driver-passengers?${new URLSearchParams({ tripId })}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10000),
            ]),
          }
        )
        const data = await response.json()
        if (!response.ok || !Array.isArray(data.items))
          throw Error(data.error ?? "Не удалось загрузить список посадки.")
        if (!controller.signal.aborted) {
          setItems(data.items)
          setError("")
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Не удалось обновить список посадки."
          )
      } finally {
        fetching = false
      }
    }
    void load()
    const listener = () => {
      if (document.visibilityState === "visible") void load()
    }
    const timer = window.setInterval(listener, 30000)
    window.addEventListener(realtimeEvent, listener)
    document.addEventListener("visibilitychange", listener)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener(realtimeEvent, listener)
      document.removeEventListener("visibilitychange", listener)
    }
  }, [tripId, retry])
  const parsed = amount.trim().replace(",", ".")
  const total = /^\d+(\.\d{1,2})?$/.test(parsed)
    ? Math.round(Number(parsed) * 100)
    : NaN
  const valid =
    payment &&
    Number.isSafeInteger(total) &&
    total > payment.cashMinor &&
    total <= payment.amountMinor
  async function receive() {
    if (!payment || !valid || paying) return
    setPaying(true)
    setPaymentError("")
    try {
      await checkin({ tripId, bookingId: payment.id, cashMinor: total })
      setPayment(null)
      refresh()
      window.dispatchEvent(new Event(realtimeEvent))
    } catch (error) {
      setPaymentError(
        error instanceof Error ? error.message : "Не удалось принять оплату."
      )
    } finally {
      setPaying(false)
    }
  }
  const boarded =
    items?.reduce(
      (sum, b) =>
        sum +
        Object.values(b.boarding ?? {}).filter((s) => s === "boarded").length,
      0
    ) ?? 0
  const seats = items?.reduce((sum, b) => sum + b.seats, 0) ?? 0
  return (
    <section aria-label="Список посадки" className="mt-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Пассажиры</h2>
        <span className="text-xs text-muted-foreground">
          Пришли {boarded} из {seats}
        </span>
      </div>
      {error ? (
        <div role="alert" className="mt-3 text-sm text-destructive">
          {error}
          <Button variant="ghost" onClick={() => setRetry((v) => v + 1)}>
            Повторить
          </Button>
        </div>
      ) : null}
      {!items && !error ? (
        <Skeleton className="mt-3 h-20" />
      ) : items?.length ? (
        <ul className="mt-3 divide-y divide-border">
          {items.map((booking) => {
            const received =
              booking.paymentStatus === "paid"
                ? booking.amountMinor
                : (booking.cashMinor ?? 0)
            const canReceive =
              booking.paymentMethod === "cash_on_boarding" &&
              received < booking.amountMinor
            const hasBoarded = Object.values(booking.boarding ?? {}).includes(
              "boarded"
            )
            return (
              <li key={booking.id} className="min-w-0 py-4 first:pt-0">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{booking.recordNumber || `${booking.seats} мест`}</span>
                  <a
                    href={`tel:${booking.phone}`}
                    className="py-1 underline underline-offset-4"
                  >
                    {booking.phone}
                  </a>
                </div>
                <div className="space-y-2">
                  {Array.from({ length: booking.seats }, (_, index) => {
                    const person = booking.passengers[index]
                    const name = person
                      ? `${person.firstName} ${person.lastName}`
                      : booking.seats === 1
                        ? booking.name
                        : `${booking.name} · пассажир ${index + 1}`
                    return (
                      <BoardingSelect
                        key={index}
                        tripId={tripId}
                        booking={booking}
                        index={index}
                        name={name}
                        onChange={refresh}
                      />
                    )
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Badge variant="secondary">
                    {booking.paymentMethod === "bank_transfer"
                      ? booking.paymentStatus === "paid"
                        ? "Оплачено переводом"
                        : "Ожидаем перевод"
                      : received >= booking.amountMinor
                        ? "Оплачено наличными"
                        : received > 0
                          ? "Частичная оплата"
                          : "Наличные"}
                  </Badge>
                  <span className="font-semibold tabular-nums">
                    {received > 0 && received < booking.amountMinor
                      ? `${money(received, booking.currency)} / `
                      : ""}
                    {money(booking.amountMinor, booking.currency)}
                  </span>
                </div>
                {canReceive ? (
                  <Button
                    className="mt-3 w-full"
                    variant="outline"
                    disabled={!hasBoarded}
                    disabledReason="Сначала отметьте пришедшего пассажира."
                    onClick={() => {
                      setPayment(booking)
                      setAmount(String(booking.amountMinor / 100))
                      setPaymentError("")
                    }}
                  >
                    Принять наличные
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : !error ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Бронирований пока нет.
        </p>
      ) : null}
      <Dialog
        open={!!payment}
        onOpenChange={(open) => {
          if (!open && !paying) setPayment(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Получение наличных</DialogTitle>
            <DialogDescription>{payment?.name}</DialogDescription>
          </DialogHeader>
          {payment ? (
            <>
              <p className="text-sm">
                Стоимость: {money(payment.amountMinor, payment.currency)} ·
                Получено: {money(payment.cashMinor, payment.currency)}
              </p>
              <label className="grid gap-2 text-sm">
                Всего получено, {payment.currency}
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            </>
          ) : null}
          {paymentError ? (
            <p role="alert" className="text-sm text-destructive">
              {paymentError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={paying}
              disabledReason="Записываем оплату. Дождитесь результата."
              onClick={() => setPayment(null)}
            >
              Отмена
            </Button>
            <Button
              disabled={paying || !valid}
              disabledReason={
                paying
                  ? "Записываем оплату. Дождитесь результата."
                  : "Укажите общую полученную сумму: больше уже принятой и не больше стоимости брони."
              }
              onClick={() => void receive()}
            >
              {paying ? "Принимаем…" : "Подтвердить получение"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
