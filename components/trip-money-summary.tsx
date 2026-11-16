"use client"
import * as React from "react"
import Link from "next/link"
import { DatePicker } from "@/components/ui/date-picker"
import { sessionFetch } from "@/lib/session-navigation"
import { formatMoney, type TripProfit } from "@/lib/money-v2"
import { realtimeEvent } from "@/lib/realtime"

export function useTripProfits(tripId?: string, from?: string, to?: string) {
  const [items, setItems] = React.useState<TripProfit[]>([])
  const [error, setError] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    let fetching = false
    const load = async () => {
      if (fetching) return
      fetching = true
      try {
        const params = new URLSearchParams({ view: "profits" })
        if (tripId) params.set("tripId", tripId)
        if (from) params.set("from", from)
        if (to) params.set("to", to)
        const response = await sessionFetch("/api/money?" + params, {
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok)
          throw Error(data.error ?? "Не удалось рассчитать результат рейсов.")
        if (!controller.signal.aborted) {
          setItems(data.items)
          setError("")
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить результат."
          )
      } finally {
        fetching = false
      }
    }
    void load()
    window.addEventListener(realtimeEvent, load)
    const timer = setInterval(load, 30000)
    return () => {
      controller.abort()
      clearInterval(timer)
      window.removeEventListener(realtimeEvent, load)
    }
  }, [tripId, from, to])
  return { items, error }
}
export function ProfitAmount({ item }: { item?: TripProfit }) {
  return !item ? (
    <span className="text-muted-foreground">—</span>
  ) : item.rateMissing ? (
    <span className="text-amber-600">Не указан исторический курс</span>
  ) : (
    <span
      className={item.profitMinor < 0 ? "text-destructive" : "text-emerald-600"}
    >
      {formatMoney(item.profitMinor, item.currency)}
    </span>
  )
}
export function TripMoneySummary({
  tripId,
  compact = false,
}: {
  tripId?: string
  compact?: boolean
}) {
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const { items, error } = useTripProfits(tripId, from, to)
  if (compact)
    return (
      <span
        className="text-xs"
        title={error || "Полученная выручка минус расходы рейса"}
      >
        Результат: <ProfitAmount item={items[0]} />
      </span>
    )
  return (
    <section className="workspace-panel min-w-0 p-4">
      <h2 className="font-semibold">Результаты рейсов</h2>
      {!tripId ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <DatePicker
            label="Рейсы с"
            value={from}
            max={to || undefined}
            onValueChange={setFrom}
          />
          <DatePicker
            label="Рейсы по"
            value={to}
            min={from || undefined}
            onValueChange={setTo}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="mt-3 divide-y">
        {items.map((item) => (
          <li
            key={item.tripId}
            className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
          >
            <Link href={`/trips/${item.tripId}`} className="underline">
              {item.label || "Открыть рейс"}
            </Link>
            {item.startsAt ? (
              <span className="text-muted-foreground">
                {new Date(item.startsAt).toLocaleDateString("ru-RU")}
              </span>
            ) : null}
            <ProfitAmount item={item} />
            <span className="text-muted-foreground">
              Долг: {formatMoney(item.outstandingMinor, item.currency)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
