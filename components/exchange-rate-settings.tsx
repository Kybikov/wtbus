"use client"

import * as React from "react"
import {
  CircleDollarSign,
  Save,
  LoaderCircle,
  Download,
  ArrowRight,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { sessionFetch } from "@/lib/session-navigation"

type ExchangeRates = {
  updatedAt?: string
  baseCurrency: string
  rates: Record<string, number>
}
const currencies = ["EUR", "USD", "PLN", "UAH"]

function isExchangeRates(value: unknown): value is ExchangeRates {
  return (
    typeof value === "object" &&
    value !== null &&
    "baseCurrency" in value &&
    typeof value.baseCurrency === "string" &&
    "rates" in value &&
    typeof value.rates === "object" &&
    value.rates !== null
  )
}

export function ExchangeRateSettings({ disabled }: { disabled: boolean }) {
  const [state, setState] = React.useState<ExchangeRates | null>(null)
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [pulling, setPulling] = React.useState(false)
  const [source, setSource] = React.useState<{
    updatedAt: string
    currencies: string[]
  } | null>(null)

  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/exchange-rates", { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok || !isExchangeRates(payload))
          throw new Error("Не удалось загрузить курсы валют.")
        setState(payload)
        setValues(
          Object.fromEntries(
            Object.entries(payload.rates).map(([currency, rate]) => [
              currency,
              String(rate),
            ])
          )
        )
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          toast.error("Не удалось загрузить курсы валют", {
            description: reason instanceof Error ? reason.message : undefined,
          })
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
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
      const response = await sessionFetch("/api/exchange-rates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isExchangeRates(payload))
        throw new Error(
          typeof payload === "object" && payload !== null && "error" in payload
            ? String(payload.error)
            : "Не удалось сохранить курсы."
        )
      setState(payload)
      setValues(
        Object.fromEntries(
          Object.entries(payload.rates).map(([currency, rate]) => [
            currency,
            String(rate),
          ])
        )
      )
      toast.success("Курсы валют сохранены")
    } catch (reason) {
      toast.error("Не удалось сохранить курсы", {
        description: reason instanceof Error ? reason.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  async function pull() {
    setPulling(true)
    try {
      const r = await sessionFetch("/api/exchange-rates?source=monobank", {
        signal: AbortSignal.timeout(10_000),
      })
      const p = await r.json().catch(() => null)
      if (!r.ok || !isExchangeRates(p))
        throw Error(
          p?.error ?? "Не удалось получить курсы. Повторите попытку позже."
        )
      setValues((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.entries(p.rates).map(([code, rate]) => [code, String(rate)])
        ),
      }))
      setSource({
        updatedAt: p.updatedAt ?? new Date().toISOString(),
        currencies: Object.keys(p.rates),
      })
      toast.success("Курсы Monobank получены. Проверьте и сохраните их.")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось получить курсы"
      )
    } finally {
      setPulling(false)
    }
  }
  const labels: Record<string, string> = {
    EUR: "Евро",
    USD: "Доллар США",
    PLN: "Польский злотый",
    UAH: "Украинская гривна",
  }
  const dirty =
    !!state &&
    currencies.some(
      (code) =>
        code !== state.baseCurrency &&
        Number(values[code] ?? 0) !== (state.rates[code] ?? 0)
    )
  return (
    <form className="settings-panel" onSubmit={save}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <CircleDollarSign className="size-4 text-primary" />
            Курсы валют
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Пересчёт финансовых отчётов в{" "}
            {state?.baseCurrency ?? "базовую валюту"}.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || loading || saving || pulling}
          onClick={() => void pull()}
        >
          {pulling ? <LoaderCircle className="animate-spin" /> : <Download />}
          {pulling ? "Получаем…" : "Получить из Monobank"}
        </Button>
      </div>
      <div className="mt-5 overflow-hidden rounded-xl border border-border">
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(10rem,16rem)_7rem] gap-4 bg-accent/40 px-4 py-3 text-xs text-muted-foreground sm:grid">
          <span>Валюта</span>
          <span>Курс за 1 единицу</span>
          <span>Источник</span>
        </div>
        <ul className="divide-y divide-border">
          {currencies.map((currency) => (
            <li
              key={currency}
              className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,16rem)_7rem] sm:items-center sm:gap-4"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-control text-xs font-semibold">
                  {currency}
                </span>
                <div>
                  <p className="text-sm font-medium">{labels[currency]}</p>
                  <p className="text-xs text-muted-foreground">
                    1 {currency} <ArrowRight className="inline size-3" />{" "}
                    {state?.baseCurrency ?? "—"}
                  </p>
                </div>
              </div>
              <InputGroup>
                <InputGroupInput
                  aria-label={`Курс ${currency}`}
                  disabled={
                    disabled ||
                    loading ||
                    saving ||
                    pulling ||
                    currency === state?.baseCurrency
                  }
                  type="number"
                  step="0.00000001"
                  min="0.00000001"
                  inputMode="decimal"
                  value={
                    currency === state?.baseCurrency
                      ? "1"
                      : (values[currency] ?? "")
                  }
                  placeholder="Укажите курс"
                  onChange={(event) => {
                    setValues((v) => ({ ...v, [currency]: event.target.value }))
                    setSource((v) =>
                      v
                        ? {
                            ...v,
                            currencies: v.currencies.filter(
                              (c) => c !== currency
                            ),
                          }
                        : v
                    )
                  }}
                />
                <InputGroupAddon align="inline-end">
                  {state?.baseCurrency ?? "—"}
                </InputGroupAddon>
              </InputGroup>
              <div>
                <Badge variant="secondary">
                  {currency === state?.baseCurrency
                    ? "Базовая"
                    : source?.currencies.includes(currency)
                      ? "Monobank"
                      : state?.rates[currency]
                        ? "Сохранён"
                        : "Вручную"}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {source ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Средний курс Monobank на{" "}
          {new Date(source.updatedAt).toLocaleString("ru-RU")}. Для валют без
          опубликованного курса сохранены ваши значения.
        </p>
      ) : null}
      <div className="settings-footer">
        <p className="text-xs text-muted-foreground">
          {dirty ? "Есть несохранённые изменения" : "Курсы сохранены"}
        </p>
        <Button
          disabled={
            disabled || loading || saving || pulling || !state || !dirty
          }
          type="submit"
        >
          {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
          {saving ? "Сохраняем…" : "Сохранить курсы"}
        </Button>
      </div>
    </form>
  )
}
