"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  LayoutDashboard,
  RefreshCw,
  Route,
  Ticket,
  Users,
  Wallet,
} from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { OperationsDashboard } from "@/components/operations-dashboard"
import Stats1 from "@/components/stats-1"
import { StatisticsCalendar } from "@/components/statistics-calendar"
import { StatisticsToolbar } from "@/components/statistics-toolbar"
import {
  colors,
  dateLabel,
  Distribution,
  integer,
  Metric,
  Panel,
  RouteRanking,
  Trend,
} from "@/components/statistics-charts"
import { Button, buttonVariants } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import { sessionFetch } from "@/lib/session-navigation"
import { realtimeEvent } from "@/lib/realtime"
import { cn } from "@/lib/utils"
import {
  isStatisticsDate,
  statisticsCategoryLabels,
  statisticsMethodLabels,
  statisticsOccupancy,
  statisticsSourceLabels,
  type StatisticsReport,
} from "@/lib/statistics"

const sections = [
  { key: "summary", label: "Сводка", icon: LayoutDashboard },
  { key: "revenue", label: "Выручка", icon: Wallet },
  { key: "bookings", label: "Бронирования", icon: Ticket },
  { key: "trips", label: "Рейсы", icon: Route },
  { key: "calendar", label: "Календарь", icon: CalendarDays },
  { key: "live", label: "На линии", icon: Activity },
]

export function StatisticsWorkspace({ role }: { role: string | null }) {
  const params = useSearchParams()
  const financial =
    !!role && ["owner", "admin", "developer", "accountant"].includes(role)
  const visibleSections = sections.filter(
    (item) =>
      (item.key !== "revenue" || financial) &&
      (item.key !== "live" || role !== "accountant")
  )
  const section =
    visibleSections.find((item) => item.key === params.get("section"))?.key ??
    "summary"
  const fromParam = params.get("from") ?? ""
  const toParam = params.get("to") ?? ""
  const currencyParam = financial ? (params.get("currency") ?? "") : ""
  const query = new URLSearchParams()
  if (fromParam) query.set("from", fromParam)
  if (toParam) query.set("to", toParam)
  if (currencyParam) query.set("currency", currencyParam)
  const queryKey = query.toString()
  const [snapshot, setSnapshot] = React.useState<{
    key: string
    report: StatisticsReport
  } | null>(null)
  const [error, setError] = React.useState<{
    key: string
    message: string
  } | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [refresh, setRefresh] = React.useState(0)
  const [updatedAt, setUpdatedAt] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    let busy = false
    let pending = false
    async function load() {
      if (!navigator.onLine) {
        setError({
          key: queryKey,
          message:
            "Нет соединения с интернетом. Данные обновятся после подключения.",
        })
        return
      }
      if (document.hidden) return
      if (busy) {
        pending = true
        return
      }
      busy = true
      setRefreshing(true)
      let failure =
        "Не удалось загрузить статистику. Проверьте соединение и повторите загрузку."
      try {
        const response = await sessionFetch(`/api/statistics?${queryKey}`, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20_000),
          ]),
        })
        const body = await response.json()
        if (!response.ok) {
          failure = typeof body?.error === "string" ? body.error : failure
          throw new Error(failure)
        }
        if (!controller.signal.aborted) {
          setSnapshot({ key: queryKey, report: body })
          setError(null)
          setUpdatedAt(
            new Intl.DateTimeFormat("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZone: body.timezone,
            }).format(new Date())
          )
        }
      } catch {
        if (!controller.signal.aborted)
          setError({
            key: queryKey,
            message: failure,
          })
      } finally {
        busy = false
        if (!controller.signal.aborted) {
          setRefreshing(false)
          if (pending) {
            pending = false
            void load()
          }
        }
      }
    }
    void load()
    const reload = () => {
      void load()
    }
    const timer = window.setInterval(reload, 30_000)
    window.addEventListener(realtimeEvent, reload)
    window.addEventListener("online", reload)
    window.addEventListener("offline", reload)
    document.addEventListener("visibilitychange", reload)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener(realtimeEvent, reload)
      window.removeEventListener("online", reload)
      window.removeEventListener("offline", reload)
      document.removeEventListener("visibilitychange", reload)
    }
  }, [queryKey, refresh])
  const report = snapshot?.key === queryKey ? snapshot.report : null
  const loadError = error?.key === queryKey ? error.message : null
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    // Native history is integrated with useSearchParams in Next.js. Reading the
    // current URL also preserves a choice made just before the next click.
    window.history.replaceState(null, "", `/?${next}`)
  }
  const from = isStatisticsDate(fromParam) ? fromParam : report?.from || ""
  const to = isStatisticsDate(toParam) ? toParam : report?.to || ""
  const currency = currencyParam || snapshot?.report.finance?.currency || "UAH"
  const money = (value: number) =>
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value / 100)
  const finance = report?.finance
  const dayData =
    report?.daily.map((day) => ({
      ...day,
      revenueMinor:
        finance?.daily.find((item) => item.date === day.date)?.revenueMinor ??
        0,
      expensesMinor:
        finance?.daily.find((item) => item.date === day.date)?.expensesMinor ??
        0,
      occupancy: statisticsOccupancy(day.occupiedSeats, day.capacity),
    })) ?? []
  const sourceItems =
    report?.sources.map((item) => ({
      label: statisticsSourceLabels[item.key] ?? item.label,
      value: item.count,
    })) ?? []
  const bookingSeries = [
    { key: "bookings", label: "Бронирования" },
    { key: "cancelled", label: "Отменены", color: colors[4] },
  ]
  const revenueSeries = [
    { key: "revenueMinor", label: "Получено" },
    { key: "expensesMinor", label: "Расходы", color: colors[4] },
  ]
  const occupancy = report
    ? statisticsOccupancy(report.metrics.occupiedSeats, report.metrics.capacity)
    : null
  return (
    <AppShell
      pageTitle="Статистика"
      pageDescription={`Выручка, бронирования и рейсы. ${report?.timezone ?? "Часовой пояс компании"}${updatedAt ? ` · ${refreshing ? "Обновление…" : `Обновлено ${updatedAt}`}` : ""}. Бронирования — по дате создания, рейсы — по отправлению, деньги — по дате операции. Обе даты включены. Суммы только в выбранной валюте; количество записей — во всех валютах.`}
      pageControls={
        section !== "live" ? (
          <StatisticsToolbar
            today={(report ?? snapshot?.report)?.today}
            from={from}
            to={to}
            currency={currency}
            financial={financial}
            onChange={update}
          />
        ) : undefined
      }
      onRefresh={() => setRefresh((value) => value + 1)}
      refreshing={refreshing}
    >
      <div className="statistics-workspace grid min-w-0 items-start gap-4 xl:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="workspace-panel sticky top-0 hidden rounded-2xl border bg-card p-2 xl:block">
          <p className="px-3 pt-3 pb-2 text-xs text-muted-foreground">
            Статистика
          </p>
          <nav aria-label="Разделы статистики">
            {visibleSections.map((item) => (
              <Link
                key={item.key}
                href={`/?${new URLSearchParams({ ...Object.fromEntries(params), section: item.key })}`}
                scroll={false}
                aria-current={section === item.key ? "page" : undefined}
                className={cn(
                  "mb-1 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors hover:bg-accent",
                  section === item.key && "bg-accent font-semibold"
                )}
              >
                <item.icon
                  className={cn(
                    "size-4 text-muted-foreground",
                    section === item.key && "text-primary"
                  )}
                />
                {item.label}
              </Link>
            ))}
          </nav>
          {financial && (
            <div className="mt-3 border-t pt-2">
              <Link
                href="/finance"
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent"
              >
                <CircleDollarSign className="size-4" />
                Управление финансами
                <ArrowUpRight className="ml-auto size-3.5" />
              </Link>
            </div>
          )}
        </aside>
        <div className="min-w-0 space-y-4">
          <div className="workspace-panel rounded-2xl border bg-card p-3 xl:hidden">
            <FieldSelect
              aria-label="Раздел статистики"
              value={section}
              options={visibleSections.map((item) => ({
                value: item.key,
                label: (
                  <span className="flex items-center gap-2">
                    <item.icon className="size-4" />
                    {item.label}
                  </span>
                ),
              }))}
              onValueChange={(value) => update({ section: value })}
              triggerClassName="h-11 w-full"
            />
          </div>
          {loadError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <p>
                {loadError}
                {report && " Показаны последние загруженные данные."}
              </p>
              <Button
                variant="secondary"
                onClick={() => update({ from: "", to: "", currency: "" })}
              >
                Сбросить период и валюту
              </Button>
              <Button
                variant="outline"
                onClick={() => setRefresh((value) => value + 1)}
              >
                <RefreshCw className="size-4" />
                Повторить
              </Button>
            </div>
          )}
          {section === "live" ? (
            <OperationsDashboard embedded refreshToken={refresh} />
          ) : !report ? (
            !loadError && (
              <div
                role="status"
                className="workspace-panel rounded-2xl border p-8 text-center text-sm text-muted-foreground"
              >
                Загружаем статистику…
              </div>
            )
          ) : (
            <>
              {section === "summary" && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>article:first-child]:col-span-2 sm:[&>article:first-child]:col-span-1">
                    {report.periods.map((period) => (
                      <Metric
                        key={period.key}
                        title={`${finance ? "Получено" : "Бронирований"} ${period.key === "today" ? "сегодня" : period.key === "week" ? "за 7 дней" : "за 30 дней"}`}
                        value={
                          finance
                            ? money(
                                finance.periods.find(
                                  (item) => item.key === period.key
                                )?.revenueMinor ?? 0
                              )
                            : integer(period.bookings)
                        }
                        detail={`${integer(period.bookings)} бронирований · ${integer(period.passengers)} пассажиров`}
                        icon={finance ? Wallet : Ticket}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <h1 className="text-base font-semibold">
                      За выбранный период
                    </h1>
                    <span className="text-xs text-muted-foreground">
                      {dateLabel(report.from)} — {dateLabel(report.to)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                    <Metric
                      title="Бронирования"
                      value={integer(report.metrics.bookings)}
                      current={report.metrics.bookings}
                      previous={report.previous.bookings}
                      icon={Ticket}
                    />
                    <Metric
                      title="Пассажиры"
                      value={integer(report.metrics.passengers)}
                      current={report.metrics.passengers}
                      previous={report.previous.passengers}
                      icon={Users}
                    />
                    <Metric
                      title="Рейсы"
                      value={integer(report.metrics.trips)}
                      current={report.metrics.trips}
                      previous={report.previous.trips}
                      icon={Route}
                    />
                    <Metric
                      title="Загрузка"
                      value={
                        occupancy === null ? "—" : `${Math.round(occupancy)}%`
                      }
                      detail={`${integer(report.metrics.occupiedSeats)} из ${integer(report.metrics.capacity)} мест`}
                    />
                  </div>
                  <div className="grid gap-4 2xl:grid-cols-2">
                    {finance && (
                      <Panel
                        title={`Получено · ${currency}`}
                        hint="Оплаченные бронирования и наличные за вычетом возвратов. Перемещения денег между водителем и кассой исключены."
                      >
                        <Trend
                          data={dayData}
                          series={[revenueSeries[0]]}
                          money
                          format={money}
                        />
                      </Panel>
                    )}
                    <Panel title="Бронирования по дням">
                      <Trend data={dayData} series={bookingSeries} type="bar" />
                    </Panel>
                    <Panel title="Источники бронирований">
                      <Distribution items={sourceItems} />
                    </Panel>
                    <Panel
                      title="Загрузка направлений"
                      hint="Занятые места / общая вместимость. Отменённые рейсы исключены."
                    >
                      <RouteRanking report={report} />
                    </Panel>
                  </div>
                </>
              )}
              {section === "revenue" && finance && (
                <>
                  <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                    <Metric
                      title="Получено"
                      value={money(finance.totals.revenueMinor)}
                      current={finance.totals.revenueMinor}
                      previous={finance.previous.revenueMinor}
                      icon={Wallet}
                    />
                    <Metric
                      title="Расходы и начисления"
                      value={money(finance.totals.expensesMinor)}
                      current={finance.totals.expensesMinor}
                      previous={finance.previous.expensesMinor}
                      invert
                    />
                    <Metric
                      title="Результат"
                      value={money(
                        finance.totals.revenueMinor -
                          finance.totals.expensesMinor
                      )}
                      detail="Получено минус расходы"
                    />
                    <Metric
                      title="Возвраты"
                      value={money(finance.totals.refundsMinor)}
                      invert
                    />
                  </div>
                  <Panel
                    title={`Доходы и расходы · ${currency}`}
                    action={
                      <Link
                        href="/finance"
                        className={buttonVariants({
                          variant: "secondary",
                          size: "sm",
                        })}
                      >
                        Все операции
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    }
                  >
                    <Trend
                      data={dayData}
                      series={revenueSeries}
                      money
                      format={money}
                    />
                  </Panel>
                  <div className="grid gap-4 2xl:grid-cols-2">
                    <Panel
                      title="Способы поступления"
                      hint="Доли положительных поступлений после возвратов. Отрицательный итог возвратов показан суммой и не входит в доли."
                    >
                      <Stats1
                        items={finance.methods.map((item, i) => ({
                          label: statisticsMethodLabels[item.key] ?? item.key,
                          value: item.amountMinor,
                          color: colors[i % colors.length],
                        }))}
                        format={money}
                      />
                    </Panel>
                    <Panel title="Категории расходов">
                      <Distribution
                        items={finance.categories.map((item) => ({
                          label: statisticsCategoryLabels[item.key] ?? item.key,
                          value: item.amountMinor,
                        }))}
                        format={money}
                      />
                    </Panel>
                  </div>
                </>
              )}
              {section === "bookings" && (
                <>
                  <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                    <Metric
                      title="Создано"
                      value={integer(report.metrics.bookings)}
                      current={report.metrics.bookings}
                      previous={report.previous.bookings}
                      icon={Ticket}
                    />
                    <Metric
                      title="Подтверждены / выполнены"
                      value={integer(report.metrics.confirmed)}
                    />
                    <Metric
                      title="Отменены"
                      value={integer(report.metrics.cancelled)}
                      current={report.metrics.cancelled}
                      previous={report.previous.cancelled}
                      invert
                    />
                    <Metric
                      title="Истекли"
                      value={integer(report.metrics.expired)}
                    />
                  </div>
                  <Panel title="Динамика бронирований">
                    <Trend data={dayData} series={bookingSeries} type="bar" />
                  </Panel>
                  <div className="grid gap-4 2xl:grid-cols-2">
                    <Panel title="Статусы бронирований">
                      <Distribution
                        items={report.statuses.map((item) => ({
                          label: item.label,
                          value: item.count,
                        }))}
                      />
                    </Panel>
                    <Panel title="Откуда приходят пассажиры">
                      <Distribution items={sourceItems} />
                    </Panel>
                  </div>
                </>
              )}
              {section === "trips" && (
                <>
                  <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                    <Metric
                      title="Рейсы"
                      value={integer(report.metrics.trips)}
                      current={report.metrics.trips}
                      previous={report.previous.trips}
                      icon={Route}
                    />
                    <Metric
                      title="Завершены"
                      value={integer(report.metrics.completedTrips)}
                    />
                    <Metric
                      title="Отменены"
                      value={integer(report.metrics.cancelledTrips)}
                      invert
                    />
                    <Metric
                      title="Загрузка"
                      value={
                        occupancy === null ? "—" : `${Math.round(occupancy)}%`
                      }
                      detail={`${integer(report.metrics.occupiedSeats)} / ${integer(report.metrics.capacity)} мест`}
                    />
                  </div>
                  <div className="grid gap-4 2xl:grid-cols-2">
                    <Panel title="Рейсы по дням">
                      <Trend
                        data={dayData}
                        series={[
                          { key: "trips", label: "Рейсы" },
                          { key: "completedTrips", label: "Завершены" },
                        ]}
                        type="bar"
                      />
                    </Panel>
                    <Panel
                      title="Заполняемость"
                      hint="Дни без вместимости не имеют процента загрузки."
                    >
                      <Trend
                        data={dayData}
                        series={[{ key: "occupancy", label: "Загрузка" }]}
                        type="line"
                        format={(value) => `${Math.round(value)}%`}
                      />
                    </Panel>
                  </div>
                  <Panel title="Направления">
                    <RouteRanking report={report} />
                  </Panel>
                </>
              )}
              {section === "calendar" && (
                <StatisticsCalendar
                  report={report}
                  money={money}
                  onMonth={(range) => update(range)}
                  metric={
                    [
                      "bookings",
                      "passengers",
                      "trips",
                      ...(financial ? ["revenue"] : []),
                    ].includes(params.get("calendarMetric") ?? "")
                      ? params.get("calendarMetric")!
                      : "bookings"
                  }
                  onMetricChange={(value) => update({ calendarMetric: value })}
                />
              )}
              <p className="px-1 text-xs text-muted-foreground">
                Сравнение: {dateLabel(report.previousFrom)} —{" "}
                {dateLabel(report.previousTo)} · предыдущий период той же длины
              </p>
            </>
          )}
        </div>
      </div>
    </AppShell>
  )
}
