"use client"

import * as React from "react"
import Link from "next/link"
import { sessionFetch } from "@/lib/session-navigation"
import { money } from "@/components/accounting-workspace"

const labels: Record<string, string> = {
  fuel: "Топливо",
  driver_pay: "Зарплата",
  payroll_tax: "Начисления на зарплату",
  taxes: "Налоги",
  amortization: "Обслуживание и амортизация",
  marketing: "Маркетинг",
  other: "Прочее",
}
type Report = {
  categories: { category: string; currency: string; amountMinor: number }[]
  dailyExpenses: { date: string; currency: string; amountMinor: number }[]
  turnoverTaxBps: number
}
type Summary = {
  currency: string
  confirmedRevenueMinor: number
  netProfitMinor: number
  operationalExpensesMinor: number
  conversionComplete: boolean
}
export function FinanceOverview({
  from: suppliedFrom,
  to: suppliedTo,
  detailsOnly = false,
}: {
  from?: string
  to?: string
  detailsOnly?: boolean
}) {
  const range = React.useMemo(() => {
    const d = new Date()
    const local = (v: Date) =>
      `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
    return {
      from: suppliedFrom ?? local(new Date(d.getFullYear(), d.getMonth(), 1)),
      to: suppliedTo ?? local(d),
    }
  }, [suppliedFrom, suppliedTo])
  const [data, setData] = React.useState<{
    report: Report
    summary: Summary
  } | null>(null)
  const [error, setError] = React.useState("")
  React.useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const q = new URLSearchParams(range)
        const responses = await Promise.all([
          sessionFetch(`/api/accounting?view=report&${q}`, {
            cache: "no-store",
          }),
          sessionFetch(`/api/finance?${q}`, { cache: "no-store" }),
        ])
        if (responses.some((r) => !r.ok))
          throw Error("Финансовая статистика временно недоступна.")
        const [report, summary] = await Promise.all(
          responses.map((r) => r.json())
        )
        if (active) {
          setData({ report, summary })
          setError("")
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Ошибка загрузки.")
      }
    }
    void load()
    const timer = setInterval(() => void load(), 30000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [range])
  const maxima: Record<string, number> = {}
  for (const c of data?.report.categories ?? [])
    maxima[c.currency] = Math.max(maxima[c.currency] ?? 1, c.amountMinor)
  return (
    <section className="workspace-panel space-y-4 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">
          {detailsOnly ? "Структура расходов" : "Финансы за месяц"}
        </h2>
        <Link href="/finance" className="text-sm text-primary">
          Все операции →
        </Link>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!data && !error ? (
        <p className="text-sm text-muted-foreground">Загружаем статистику…</p>
      ) : null}
      {data && !detailsOnly ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Получено", data.summary.confirmedRevenueMinor],
            ["Расходы и начисления", data.summary.operationalExpensesMinor],
            ["Результат", data.summary.netProfitMinor],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {money(value as number, data.summary.currency)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {data?.summary.conversionComplete === false ? (
        <p className="text-xs text-amber-600">
          Итоги в базовой валюте неполные: отсутствуют курсы пересчёта.
        </p>
      ) : null}
      {data?.report.turnoverTaxBps ? (
        <div className="flex flex-wrap justify-between gap-2 rounded-xl border p-3 text-sm">
          <span>
            Прогноз налога с выручки · {data.report.turnoverTaxBps / 100}%
          </span>
          <strong className="tabular-nums">
            {money(
              Math.round(
                (data.summary.confirmedRevenueMinor *
                  data.report.turnoverTaxBps) /
                  10000
              ),
              data.summary.currency
            )}
          </strong>
          <p className="w-full text-xs text-muted-foreground">
            Расчётная сумма. В расходы включаются внесённые платежи категории
            «Налоги».
          </p>
        </div>
      ) : null}
      {data?.report.categories.length ? (
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          {data.report.categories.map((c) => (
            <div key={`${c.category}:${c.currency}`}>
              <div className="mb-2 flex justify-between gap-2 text-sm">
                <span>{labels[c.category] ?? c.category}</span>
                <strong className="tabular-nums">
                  {money(c.amountMinor, c.currency)}
                </strong>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{
                    width: `${Math.max(2, (c.amountMinor / maxima[c.currency]) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : data ? (
        <p className="text-sm text-muted-foreground">
          За выбранный период расходов пока нет.
        </p>
      ) : null}
    </section>
  )
}
