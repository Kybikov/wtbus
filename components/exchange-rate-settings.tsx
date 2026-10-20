"use client"

import * as React from "react"
import Image from "next/image"
import { realtimeEvent, type RealtimeMessage } from "@/lib/realtime"
import { CircleDollarSign } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { sessionFetch } from "@/lib/session-navigation"

type Quote = {
  currency: string
  buy?: number
  sell?: number
  cross?: number
  updatedAt: string
}
type ExchangeRates = { baseCurrency: string; quotes: Quote[]; stale: boolean }
const labels: Record<string, string> = {
  EUR: "Евро",
  USD: "Доллар США",
  PLN: "Польский злотый",
}
const format = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})
const money = (value?: number) => (value ? `${format.format(value)} ₴` : "—")
export function ExchangeRateSettings() {
  const [data, setData] = React.useState<ExchangeRates | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    let busy = false
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const response = await sessionFetch("/api/exchange-rates", {
          signal: controller.signal,
          cache: "no-store",
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !Array.isArray(payload?.quotes))
          throw Error(payload?.error ?? "Не удалось загрузить курсы валют.")
        setData(payload)
        setFailed(false)
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailed(true)
          toast.error(
            error instanceof Error
              ? error.message
              : "Не удалось загрузить курсы валют."
          )
        }
      } finally {
        busy = false
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    const realtime = (event: Event) => {
      const message = (event as CustomEvent<RealtimeMessage>).detail
      if (
        document.visibilityState === "visible" &&
        (message?.type === "ready" ||
          message?.entity === "tenant_exchange_rates")
      )
        void load()
    }
    const focus = () => {
      if (document.visibilityState === "visible") void load()
    }
    window.addEventListener(realtimeEvent, realtime)
    window.addEventListener("focus", focus)
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, 5 * 60_000)
    return () => {
      controller.abort()
      clearInterval(timer)
      window.removeEventListener(realtimeEvent, realtime)
      window.removeEventListener("focus", focus)
    }
  }, [])
  return (
    <section className="settings-panel @container" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <CircleDollarSign className="size-4 text-primary" />
            Курсы валют
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Стоимость 1 единицы валюты в гривнях. Обновляется автоматически.
          </p>
        </div>
        <Badge variant="secondary">
          {failed || data?.stale
            ? "Последние доступные курсы"
            : loading
              ? "Обновляем…"
              : "Monobank"}
        </Badge>
      </div>
      <div
        className="mt-5 overflow-hidden rounded-xl border border-border"
        role="table"
        aria-label="Курсы к гривне"
      >
        <div
          role="row"
          className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-2 bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground @xl:grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)_7rem_7rem] @xl:gap-4 @xl:px-4"
        >
          <span role="columnheader">Валюта</span>
          <span role="columnheader" className="hidden @xl:block">
            Обновлено
          </span>
          <span role="columnheader" className="text-right">
            Покупка
          </span>
          <span role="columnheader" className="text-right">
            Продажа
          </span>
        </div>
        <div role="rowgroup" className="divide-y divide-border">
          {["EUR", "USD", "PLN"].map((code) => {
            const quote = data?.quotes.find((q) => q.currency === code)
            const country = { EUR: "EU", USD: "US", PLN: "PL" }[code]!
            const updated = quote
              ? new Date(quote.updatedAt).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"
            return (
              <div
                key={code}
                role="row"
                className="grid min-h-16 grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-2 px-3 py-3 @xl:grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)_7rem_7rem] @xl:gap-4 @xl:px-4"
              >
                <div role="cell" className="flex min-w-0 items-center gap-2.5">
                  <Image
                    src={`/flags/${country}.svg`}
                    width={30}
                    height={20}
                    alt={
                      { EU: "Европейский союз", US: "США", PL: "Польша" }[
                        country
                      ] ?? ""
                    }
                    className="h-5 w-[30px] shrink-0 rounded-[3px] object-cover"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      <span className="hidden @sm:inline">{labels[code]}</span>
                      <span className="@sm:hidden">{code}</span>
                    </p>
                    <p className="hidden text-xs text-muted-foreground @sm:block">
                      {code} / UAH
                    </p>
                    {quote && (
                      <time
                        dateTime={quote.updatedAt}
                        title={new Date(quote.updatedAt).toLocaleString(
                          "ru-RU"
                        )}
                        className="block text-[10px] text-muted-foreground tabular-nums @xl:hidden"
                      >
                        {updated.split(", ").at(-1)}
                      </time>
                    )}
                  </div>
                </div>
                <div
                  role="cell"
                  className="hidden text-xs text-muted-foreground tabular-nums @xl:block"
                >
                  {quote ? (
                    <time dateTime={quote.updatedAt}>{updated}</time>
                  ) : (
                    "—"
                  )}
                </div>
                {quote?.cross ? (
                  <div
                    role="cell"
                    aria-colspan={2}
                    className="col-span-2 flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-right text-sm"
                  >
                    <span className="text-[11px] text-muted-foreground">
                      Расчётный
                    </span>
                    <span className="font-medium tabular-nums">
                      {money(quote.cross)}
                    </span>
                  </div>
                ) : (
                  ["buy", "sell"].map((side) => (
                    <div
                      key={side}
                      role="cell"
                      className="text-right text-sm font-medium tabular-nums"
                    >
                      {loading
                        ? "…"
                        : money(side === "buy" ? quote?.buy : quote?.sell)}
                    </div>
                  ))
                )}
              </div>
            )
          })}
        </div>
      </div>
      {!loading && !data?.quotes.length && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Курсы временно недоступны.
        </p>
      )}
    </section>
  )
}
