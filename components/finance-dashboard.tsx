"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Calendar01Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons"

import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"

type CurrencySummary = {
  currency: string
  confirmedRevenueMinor: number
  pendingRevenueMinor: number
  confirmedBookings: number
  cashCollectedMinor: number
  cashHandedInMinor: number
  driverCashBalanceMinor: number
  operationalExpensesMinor: number
  netProfitMinor: number
}

type Summary = CurrencySummary & {
  from: string
  to: string
  timezone: string
  currencies: CurrencySummary[]
  driverCashBalances: DriverCashBalance[]
}

type Driver = { id: string; name: string }

type DriverCashBalance = {
  driverId: string
  driverName: string
  currency: string
  balanceMinor: number
}

function monthRange() {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: toDateValue(first), to: toDateValue(last) }
}

function toDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function isSummary(value: unknown): value is Summary {
  return (
    typeof value === "object" &&
    value !== null &&
    "currency" in value &&
    "confirmedRevenueMinor" in value &&
    "currencies" in value &&
    Array.isArray(value.currencies) &&
    "driverCashBalances" in value &&
    Array.isArray(value.driverCashBalances)
  )
}

function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100)
}

export function FinanceDashboard() {
  const defaults = React.useMemo(() => monthRange(), [])
  const [from, setFrom] = React.useState(defaults.from)
  const [to, setTo] = React.useState(defaults.to)
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [drivers, setDrivers] = React.useState<Driver[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [driverID, setDriverID] = React.useState("")
  const [kind, setKind] = React.useState<"cash_collected" | "collection">(
    "collection"
  )
  const [amount, setAmount] = React.useState("")
  const [cashCurrency, setCashCurrency] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [expenseCategory, setExpenseCategory] = React.useState("fuel")
  const [expenseAmount, setExpenseAmount] = React.useState("")
  const [expenseCurrency, setExpenseCurrency] = React.useState("")
  const [expenseDescription, setExpenseDescription] = React.useState("")
  const [expenseSaving, setExpenseSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [summaryResponse, resourcesResponse] = await Promise.all([
        fetch(
          `/api/finance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { cache: "no-store" }
        ),
        fetch("/api/trip-resources", { cache: "no-store" }),
      ])
      const summaryPayload: unknown = await summaryResponse.json()
      const resourcesPayload: unknown = await resourcesResponse.json()
      if (!summaryResponse.ok || !isSummary(summaryPayload))
        throw new Error("Не удалось загрузить финансовое сведение.")
      setSummary(summaryPayload)
      setCashCurrency((current) => current || summaryPayload.currency)
      setExpenseCurrency((current) => current || summaryPayload.currency)
      if (
        resourcesResponse.ok &&
        typeof resourcesPayload === "object" &&
        resourcesPayload !== null &&
        "drivers" in resourcesPayload &&
        Array.isArray(resourcesPayload.drivers)
      ) {
        const loadedDrivers = resourcesPayload.drivers as Driver[]
        setDrivers(loadedDrivers)
        setDriverID((current) => current || loadedDrivers[0]?.id || "")
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить финансы."
      )
    } finally {
      setLoading(false)
    }
  }, [from, to])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function saveCash(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = amount.trim().replace(",", ".")
    const amountMinor = Math.round(Number(normalized) * 100)
    if (!driverID || !Number.isFinite(amountMinor) || amountMinor < 1) {
      setError("Выберите водителя и укажите сумму больше нуля.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: driverID,
          kind,
          amountMinor,
          currency: cashCurrency || summary?.currency || "EUR",
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
            : "Не удалось сохранить кассовую операцию."
        throw new Error(message)
      }
      setAmount("")
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить кассовую операцию."
      )
    } finally {
      setSaving(false)
    }
  }

  async function saveExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amountMinor = Math.round(
      Number(expenseAmount.trim().replace(",", ".")) * 100
    )
    if (!Number.isFinite(amountMinor) || amountMinor < 1) {
      setError("Укажите сумму расхода больше нуля.")
      return
    }
    setExpenseSaving(true)
    setError(null)
    try {
      const response = await fetch("/api/finance?action=expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: expenseCategory,
          amountMinor,
          description: expenseDescription,
          currency: expenseCurrency || summary?.currency || "EUR",
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
            : "Не удалось сохранить расход."
        throw new Error(message)
      }
      setExpenseAmount("")
      setExpenseDescription("")
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось сохранить расход."
      )
    } finally {
      setExpenseSaving(false)
    }
  }

  const currency = summary?.currency ?? "EUR"
  const availableCurrencies = Array.from(
    new Set([currency, "EUR", "UAH", ...(summary?.currencies.map((item) => item.currency) ?? [])])
  )
  return (
    <AppShell pageTitle="Финансы" utilities={<ThemeCustomizer />}>
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-[-.035em] sm:text-3xl">
              Деньги в работе
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Подтверждённые бронирования, касса водителей и сдача за выбранный
              период.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-muted-foreground">
              С
              <input
                className="mt-1 block h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                max={to}
                onChange={(event) => setFrom(event.target.value)}
                type="date"
                value={from}
              />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">
              По
              <input
                className="mt-1 block h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                min={from}
                onChange={(event) => setTo(event.target.value)}
                type="date"
                value={to}
              />
            </label>
            <Button
              disabled={loading}
              onClick={() => void load()}
              size="lg"
              variant="outline"
            >
              Обновить
            </Button>
          </div>
        </div>
        {error ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <section className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/30 p-5">
            <p className="text-sm font-semibold text-muted-foreground">
              Подтверждённая выручка
            </p>
            <p className="mt-3 text-3xl font-bold tracking-[-.035em] tabular-nums">
              {loading
                ? "—"
                : formatMoney(summary?.confirmedRevenueMinor ?? 0, currency)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {summary?.confirmedBookings ?? 0} подтверждённых бронирований
            </p>
          </section>
          <section className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/30 p-5">
            <p className="text-sm font-semibold text-muted-foreground">
              Чистый результат
            </p>
            <p className="mt-3 text-3xl font-bold tracking-[-.035em] tabular-nums">
              {loading ? "—" : formatMoney(summary?.netProfitMinor ?? 0, currency)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Расходы: {formatMoney(summary?.operationalExpensesMinor ?? 0, currency)}
            </p>
          </section>
          <section className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/30 p-5">
            <p className="text-sm font-semibold text-muted-foreground">
              Наличные у водителей
            </p>
            <p className="mt-3 text-3xl font-bold tracking-[-.035em] tabular-nums">
              {loading
                ? "—"
                : formatMoney(summary?.driverCashBalanceMinor ?? 0, currency)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Собрано {formatMoney(summary?.cashCollectedMinor ?? 0, currency)}{" "}
              · сдано {formatMoney(summary?.cashHandedInMinor ?? 0, currency)}
            </p>
          </section>
          <section className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/30 p-5">
            <p className="text-sm font-semibold text-muted-foreground">
              Ожидают подтверждения
            </p>
            <p className="mt-3 text-3xl font-bold tracking-[-.035em] tabular-nums">
              {loading
                ? "—"
                : formatMoney(summary?.pendingRevenueMinor ?? 0, currency)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Онлайн-платежи появятся после подключения эквайринга
            </p>
          </section>
        </div>
        <section className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-bold">По валютам</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Суммы не конвертируются и не складываются между валютами.
            </p>
          </div>
          <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
            {(summary?.currencies ?? [{
              currency,
              confirmedRevenueMinor: 0,
              pendingRevenueMinor: 0,
              confirmedBookings: 0,
              cashCollectedMinor: 0,
              cashHandedInMinor: 0,
              driverCashBalanceMinor: 0,
              operationalExpensesMinor: 0,
              netProfitMinor: 0,
            }]).map((item) => (
              <div className="grid grid-cols-[4.5rem_1fr] gap-x-4 gap-y-2 px-5 py-4 text-sm" key={item.currency}>
                <span className="font-bold text-primary">{item.currency}</span>
                <span className="font-semibold tabular-nums">Выручка {formatMoney(item.confirmedRevenueMinor, item.currency)}</span>
                <span className="text-xs text-muted-foreground">{item.confirmedBookings} броней</span>
                <span className="text-xs text-muted-foreground tabular-nums">У водителей {formatMoney(item.driverCashBalanceMinor, item.currency)} · расходы {formatMoney(item.operationalExpensesMinor, item.currency)} · итог {formatMoney(item.netProfitMinor, item.currency)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-bold">Наличные по водителям</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Текущий остаток рассчитывается по всей кассовой истории и не
              зависит от выбранного периода.
            </p>
          </div>
          {loading ? (
            <div className="h-20 animate-pulse bg-muted/30" />
          ) : summary?.driverCashBalances.length ? (
            <div className="divide-y divide-border">
              {summary.driverCashBalances.map((item) => (
                <div
                  className="grid gap-1 px-5 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_7rem_10rem] sm:items-center sm:gap-4"
                  key={`${item.driverId}:${item.currency}`}
                >
                  <p className="font-semibold">{item.driverName}</p>
                  <p className="text-xs font-semibold text-primary">
                    {item.currency}
                  </p>
                  <p className="font-bold tabular-nums sm:text-right">
                    {formatMoney(item.balanceMinor, item.currency)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-5 py-5 text-sm text-muted-foreground">
              У водителей нет несданных наличных.
            </p>
          )}
        </section>
        <section className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25 p-5">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              className="text-primary"
              icon={Calendar01Icon}
              size={20}
            />
            <div>
              <h2 className="font-bold">Кассовая операция</h2>
              <p className="text-sm text-muted-foreground">
                Водительские поступления фиксируются автоматически. Здесь
                обычно отмечается сдача наличных в кассу.
              </p>
            </div>
          </div>
          <form
            className="mt-5 grid gap-3 md:grid-cols-[minmax(12rem,1fr)_minmax(10rem,1fr)_7rem_10rem_auto] md:items-end"
            onSubmit={saveCash}
          >
            <label className="text-sm font-semibold">
              Водитель
              <select
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"
                onChange={(event) => setDriverID(event.target.value)}
                value={driverID}
              >
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Операция
              <select
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"
                onChange={(event) =>
                  setKind(event.target.value as "cash_collected" | "collection")
                }
                value={kind}
              >
                <option value="collection">Сдал в кассу</option>
                <option value="cash_collected">
                  Получил наличные вручную
                </option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Валюта
              <select
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"
                onChange={(event) => setCashCurrency(event.target.value)}
                value={cashCurrency || currency}
              >
                {availableCurrencies.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Сумма
              <input
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                placeholder={`0,00 ${cashCurrency || currency}`}
                value={amount}
              />
            </label>
            <Button
              disabled={saving || !drivers.length}
              size="lg"
              type="submit"
            >
              {saving ? "Сохраняем…" : "Записать"}
            </Button>
          </form>
        </section>
        <section className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25 p-5">
          <div className="flex items-center gap-2">
            <HugeiconsIcon className="text-primary" icon={Wallet01Icon} size={20} />
            <div>
              <h2 className="font-bold">Операционный расход</h2>
              <p className="text-sm text-muted-foreground">
                Фиксируйте реальные расходы в валюте платежа — итог всегда остаётся отдельным по каждой валюте.
              </p>
            </div>
          </div>
          <form
            className="mt-5 grid gap-3 md:grid-cols-[minmax(11rem,1fr)_7rem_10rem_minmax(12rem,1.5fr)_auto] md:items-end"
            onSubmit={saveExpense}
          >
            <label className="text-sm font-semibold">
              Категория
              <select
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"
                onChange={(event) => setExpenseCategory(event.target.value)}
                value={expenseCategory}
              >
                <option value="fuel">Топливо</option>
                <option value="driver_pay">Оплата водителю</option>
                <option value="amortization">Амортизация</option>
                <option value="marketing">Маркетинг</option>
                <option value="other">Другое</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Валюта
              <select
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"
                onChange={(event) => setExpenseCurrency(event.target.value)}
                value={expenseCurrency || currency}
              >
                {availableCurrencies.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Сумма
              <input
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"
                inputMode="decimal"
                onChange={(event) => setExpenseAmount(event.target.value)}
                placeholder={`0,00 ${expenseCurrency || currency}`}
                value={expenseAmount}
              />
            </label>
            <label className="text-sm font-semibold">
              Комментарий
              <input
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"
                maxLength={500}
                onChange={(event) => setExpenseDescription(event.target.value)}
                placeholder="Например, заправка перед рейсом"
                value={expenseDescription}
              />
            </label>
            <Button disabled={expenseSaving} size="lg" type="submit">
              {expenseSaving ? "Сохраняем…" : "Добавить расход"}
            </Button>
          </form>
        </section>
      </div>
    </AppShell>
  )
}
