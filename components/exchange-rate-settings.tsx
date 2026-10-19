"use client"

import * as React from "react"
import { CircleDollarSign, Clock3 } from "lucide-react"
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
    const load = async () => {
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
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, 5 * 60_000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])
  return (
    <section className="settings-panel" aria-busy={loading}>
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
      <div className="mt-5 overflow-hidden rounded-xl border border-border">
        <div className="hidden grid-cols-[minmax(0,1fr)_9rem_9rem] gap-4 bg-muted/60 px-4 py-3 text-xs text-muted-foreground sm:grid">
          <span>Валюта</span>
          <span className="text-right">Купівля</span>
          <span className="text-right">Продаж</span>
        </div>
        <ul className="divide-y divide-border">
          {["EUR", "USD", "PLN"].map((code) => {
            const quote = data?.quotes.find((q) => q.currency === code)
            return (
              <li
                key={code}
                className="grid items-center gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:gap-4"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-xs font-semibold">
                    {code}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{labels[code]}</p>
                    <p className="text-xs text-muted-foreground">
                      1 {code} → UAH
                    </p>
                  </div>
                </div>
                {quote?.cross ? (
                  <div className="flex justify-between gap-2 text-sm sm:col-span-2 sm:justify-end">
                    <span className="text-muted-foreground">
                      Расчётный курс
                    </span>
                    <span className="font-medium tabular-nums">
                      {money(quote.cross)}
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 sm:contents">
                    {["buy", "sell"].map((side) => (
                      <div key={side} className="text-sm sm:text-right">
                        <p className="mb-1 text-xs text-muted-foreground sm:hidden">
                          {side === "buy" ? "Купівля" : "Продаж"}
                        </p>
                        <span className="font-medium tabular-nums">
                          {loading
                            ? "…"
                            : money(side === "buy" ? quote?.buy : quote?.sell)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {quote && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:col-span-3">
                    <Clock3 className="size-3" />
                    {new Date(quote.updatedAt).toLocaleString("ru-RU")}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Купівля — банк покупает валюту, продаж — продаёт. Для отчётов
        используется средний курс
        {data?.baseCurrency ? ` с пересчётом в ${data.baseCurrency}` : ""}. Если
        банк публикует только расчётный курс, он показан отдельно.
      </p>
      {!loading && !data?.quotes.length && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Курсы временно недоступны. Сохранённые курсы отчётов остаются без
          изменений.
        </p>
      )}
    </section>
  )
}
