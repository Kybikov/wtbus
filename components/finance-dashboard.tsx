"use client"
import { FinanceOverview } from "@/components/finance-overview"
import * as React from "react"
import { AppShell } from "@/components/app-shell"
import { DatePicker } from "@/components/ui/date-picker"
import { AccountingWorkspace, money } from "@/components/accounting-workspace"
import { sessionFetch } from "@/lib/session-navigation"

type CurrencySummary = {
  currency: string
  confirmedRevenueMinor: number
  operationalExpensesMinor: number
  netProfitMinor: number
  driverCashBalanceMinor: number
}
type Summary = CurrencySummary & {
  currencies: CurrencySummary[]
  conversionComplete: boolean
  missingExchangeRates: string[]
}
export function FinanceDashboard() {
  const defaults = React.useMemo(() => {
    const now = new Date()
    const local = (d: Date) =>
      [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-")
    return {
      from: local(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: local(now),
    }
  }, [])
  const [from, setFrom] = React.useState(defaults.from),
    [to, setTo] = React.useState(defaults.to)
  const [summary, setSummary] = React.useState<Summary | null>(null),
    [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(false),
    [refresh, setRefresh] = React.useState(0)
  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await sessionFetch(
        "/api/finance?" + new URLSearchParams({ from, to }),
        { cache: "no-store" }
      )
      const data = await response.json()
      if (!response.ok) throw Error(data.error ?? "Не удалось загрузить отчёт.")
      setSummary(data)
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки.")
    } finally {
      setLoading(false)
    }
  }, [from, to])
  React.useEffect(() => {
    const initial = setTimeout(() => void load(), 0)
    const timer = setInterval(() => void load(), 30000)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [load])
  return (
    <AppShell
      pageTitle="Финансы"
      pageDescription="Поступления, касса, зарплата и расходы"
      onRefresh={() => {
        void load()
        setRefresh((v) => v + 1)
      }}
      refreshing={loading}
    >
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            С
            <DatePicker
              label="Начало отчёта"
              value={from}
              max={to}
              onValueChange={setFrom}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            По
            <DatePicker
              label="Конец отчёта"
              value={to}
              min={from}
              onValueChange={setTo}
            />
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            ["Полученная выручка", summary?.confirmedRevenueMinor],
            ["Расходы и начисления", summary?.operationalExpensesMinor],
            ["Результат за период", summary?.netProfitMinor],
            ["На руках у водителей · сейчас", summary?.driverCashBalanceMinor],
          ].map(([label, value]) => (
            <section className="workspace-panel p-4" key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-3 text-lg font-semibold break-words tabular-nums sm:text-2xl">
                {summary ? money(value as number, summary.currency) : "—"}
              </p>
            </section>
          ))}
        </div>
        {summary && !summary.conversionComplete ? (
          <p className="rounded-xl border border-amber-500/30 p-3 text-sm text-amber-600">
            Итог неполный: отсутствуют курсы{" "}
            {summary.missingExchangeRates.join(", ")}.
          </p>
        ) : null}
        {summary?.currencies.length ? (
          <div className="workspace-panel grid divide-y sm:grid-cols-2 sm:divide-y-0">
            {summary.currencies.map((item) => (
              <div
                key={item.currency}
                className="grid grid-cols-2 gap-2 p-4 text-sm"
              >
                <strong className="col-span-2 text-primary">
                  {item.currency}
                </strong>
                <span className="text-muted-foreground">Выручка</span>
                <span className="text-right tabular-nums">
                  {money(item.confirmedRevenueMinor, item.currency)}
                </span>
                <span className="text-muted-foreground">Расходы</span>
                <span className="text-right tabular-nums">
                  {money(item.operationalExpensesMinor, item.currency)}
                </span>
                <span className="text-muted-foreground">Результат</span>
                <strong className="text-right tabular-nums">
                  {money(item.netProfitMinor, item.currency)}
                </strong>
              </div>
            ))}
          </div>
        ) : null}
        <FinanceOverview from={from} to={to} detailsOnly />
        <AccountingWorkspace
          from={from}
          to={to}
          refreshKey={refresh}
          onChanged={() => void load()}
        />
      </div>
    </AppShell>
  )
}
