"use client"

import * as React from "react"
import { CircleDollarSign } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { sessionFetch } from "@/lib/session-navigation"

type ExchangeRates = { baseCurrency: string; rates: Record<string, number> }
const currencies = ["EUR", "USD", "PLN", "UAH"]

function isExchangeRates(value: unknown): value is ExchangeRates {
  return typeof value === "object" && value !== null && "baseCurrency" in value && typeof value.baseCurrency === "string" && "rates" in value && typeof value.rates === "object" && value.rates !== null
}

export function ExchangeRateSettings({ disabled }: { disabled: boolean }) {
  const [state, setState] = React.useState<ExchangeRates | null>(null)
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/exchange-rates", { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok || !isExchangeRates(payload)) throw new Error("Не удалось загрузить курсы валют.")
        setState(payload)
        setValues(Object.fromEntries(Object.entries(payload.rates).map(([currency, rate]) => [currency, String(rate)])))
      })
      .catch((reason) => {
        if (!controller.signal.aborted) toast.error("Не удалось загрузить курсы валют", { description: reason instanceof Error ? reason.message : undefined })
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!state) return
    const rates: Record<string, number> = { [state.baseCurrency]: 1 }
    for (const currency of currencies) {
      const raw = values[currency]?.trim().replace(",", ".")
      if (!raw) continue
      const rate = Number(raw)
      if (!Number.isFinite(rate) || rate <= 0) {
        toast.error(`Некорректный курс ${currency}`)
        return
      }
      rates[currency] = rate
    }
    setSaving(true)
    try {
      const response = await sessionFetch("/api/exchange-rates", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rates }) })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isExchangeRates(payload)) throw new Error(typeof payload === "object" && payload !== null && "error" in payload ? String(payload.error) : "Не удалось сохранить курсы.")
      setState(payload)
      setValues(Object.fromEntries(Object.entries(payload.rates).map(([currency, rate]) => [currency, String(rate)])))
      toast.success("Курсы валют сохранены")
    } catch (reason) {
      toast.error("Не удалось сохранить курсы", { description: reason instanceof Error ? reason.message : undefined })
    } finally { setSaving(false) }
  }

  return <form className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25 p-5" onSubmit={save}>
    <h2 className="flex items-center gap-2 font-bold"><CircleDollarSign className="size-4 text-primary" />Курсы для финансового отчёта</h2>
    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Задайте, сколько единиц базовой валюты равно одной единице исходной. Итоги по EUR, USD, PLN и UAH будут автоматически сведены в {state?.baseCurrency ?? "базовую валюту"}.</p>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {currencies.map((currency) => <label className="text-sm font-semibold" key={currency}>{currency} → {state?.baseCurrency ?? "—"}<Input className="mt-2" disabled={disabled || loading || saving || currency === state?.baseCurrency} inputMode="decimal" min="0.00000001" onChange={(event) => setValues((current) => ({ ...current, [currency]: event.target.value }))} step="0.00000001" type="number" value={currency === state?.baseCurrency ? "1" : (values[currency] ?? "")} /></label>)}
    </div>
    <div className="mt-5 flex justify-end border-t border-border pt-5"><Button disabled={disabled || loading || saving || !state} type="submit">{saving ? "Сохраняем…" : "Сохранить курсы"}</Button></div>
  </form>
}
