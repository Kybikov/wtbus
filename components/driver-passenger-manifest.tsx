"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { sessionFetch } from "@/lib/session-navigation"
import { realtimeEvent } from "@/lib/realtime"
import type { CheckoutPassenger } from "@/lib/booking-checkout"

type ManifestBooking = {
  id: string
  name: string
  phone: string
  seats: number
  passengers: CheckoutPassenger[]
  paymentMethod: string
  paymentStatus: string
  amountMinor: number
  currency: string
}

export function DriverPassengerManifest({ tripId }: { tripId: string }) {
  const [items, setItems] = useState<ManifestBooking[] | null>(null)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
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
              AbortSignal.timeout(10_000),
            ]),
          }
        )
        const data = await response.json()
        if (!response.ok || !Array.isArray(data.items))
          throw new Error("Не удалось загрузить список посадки.")
        if (!controller.signal.aborted) {
          setItems(data.items)
          setError("")
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Не удалось обновить список посадки. Проверьте связь.")
      } finally {
        fetching = false
      }
    }
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, 30_000)
    const refresh = () => {
      if (document.visibilityState === "visible") void load()
    }
    window.addEventListener(realtimeEvent, refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener(realtimeEvent, refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [tripId, retry])
  return (
    <section
      aria-label="Список посадки"
      className="mt-4 rounded-2xl border border-border p-4"
    >
      <h2 className="text-sm font-semibold">Список посадки</h2>
      {error && (
        <div role="alert" className="mt-3 text-sm text-destructive">
          <p>{error}</p>
          <Button
            variant="ghost"
            className="mt-2 h-11"
            onClick={() => setRetry((value) => value + 1)}
          >
            Повторить
          </Button>
        </div>
      )}
      {!items && !error ? (
        <Skeleton className="mt-3 h-20" />
      ) : items?.length ? (
        <ul className="mt-4 space-y-5">
          {items.map((booking) => (
            <li
              key={booking.id}
              className="border-b border-border pb-4 text-sm last:border-b-0 last:pb-0"
            >
              <p className="text-xs break-all text-muted-foreground">
                ID: {booking.id}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Мест: {booking.seats}</Badge>
                <Badge
                  variant="secondary"
                  className={
                    booking.paymentStatus === "paid"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : booking.paymentMethod === "bank_transfer"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        : ""
                  }
                >
                  {booking.paymentMethod === "bank_transfer"
                    ? booking.paymentStatus === "paid"
                      ? "Оплачено на ФОП"
                      : "Перевод ещё не получен"
                    : booking.paymentMethod === "cash_on_boarding"
                      ? booking.paymentStatus === "paid"
                        ? "Наличные получены"
                        : "Наличные при посадке"
                      : "Способ оплаты не выбран"}
                </Badge>
                <span className="font-semibold tabular-nums">
                  {new Intl.NumberFormat("ru-RU", {
                    style: "currency",
                    currency: booking.currency,
                  }).format(booking.amountMinor / 100)}
                </span>
              </div>
              {booking.passengers.length ? (
                <ul className="mt-2 space-y-2">
                  {booking.passengers.map((person, index) => (
                    <li key={index}>
                      <p className="font-medium break-words">
                        {person.firstName} {person.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {person.birthDate.split("-").reverse().join(".")}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 font-medium">
                  {booking.name} · {booking.seats} мест
                </p>
              )}
              <a
                className="mt-2 inline-block rounded-md py-2 underline underline-offset-4"
                href={`tel:${booking.phone}`}
              >
                {booking.phone}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        !error && (
          <p className="mt-3 text-sm text-muted-foreground">
            Бронирований пока нет.
          </p>
        )
      )}
    </section>
  )
}
