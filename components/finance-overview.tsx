"use client"
import Link from "next/link"
import { useTripProfits } from "@/components/trip-money-summary"
import { formatMoney, type TripProfit } from "@/lib/money-v2"

export function FinanceOverview({
  from,
  to,
}: {
  from?: string
  to?: string
  detailsOnly?: boolean
}) {
  const { items, error } = useTripProfits(undefined, from, to)
  const groups = new Map<
    string,
    { revenue: number; expense: number; debt: number; missing: boolean }
  >()
  for (const item of items as TripProfit[]) {
    const total = groups.get(item.currency) ?? {
      revenue: 0,
      expense: 0,
      debt: 0,
      missing: false,
    }
    total.revenue += item.revenueMinor
    total.expense += item.expenseMinor
    total.debt += item.outstandingMinor
    total.missing ||= item.rateMissing
    groups.set(item.currency, total)
  }
  return (
    <section className="workspace-panel min-w-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Финансы по рейсам</h2>
        <Link className="text-sm text-primary underline" href="/finance">
          Открыть финансы
        </Link>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {[...groups].map(([currency, total]) => (
          <dl key={currency} className="grid grid-cols-2 gap-2 text-sm">
            <dt className="col-span-2 font-semibold">{currency}</dt>
            {total.missing ? (
              <dd className="col-span-2 text-amber-600">
                Итог неполный: добавьте исторический курс
              </dd>
            ) : null}
            <dt className="text-muted-foreground">Полученная выручка</dt>
            <dd className="text-right tabular-nums">
              {total.missing ? "—" : formatMoney(total.revenue, currency)}
            </dd>
            <dt className="text-muted-foreground">Расходы и начисления</dt>
            <dd className="text-right tabular-nums">
              {total.missing ? "—" : formatMoney(total.expense, currency)}
            </dd>
            <dt className="text-muted-foreground">Результат</dt>
            <dd
              className={`text-right tabular-nums ${total.revenue < total.expense ? "text-destructive" : "text-emerald-600"}`}
            >
              {total.missing
                ? "—"
                : formatMoney(total.revenue - total.expense, currency)}
            </dd>
            <dt className="text-muted-foreground">Долг пассажиров</dt>
            <dd className="text-right tabular-nums">
              {formatMoney(total.debt, currency)}
            </dd>
          </dl>
        ))}
      </div>
    </section>
  )
}
