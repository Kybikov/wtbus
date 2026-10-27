"use client"

import * as React from "react"
import { ArrowDownLeft, ArrowUpRight, BarChart3, Info } from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  statisticsChange,
  statisticsOccupancy,
  type StatisticsReport,
} from "@/lib/statistics"

export const colors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]
export const integer = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)
export const dateLabel = (value: string, month = false) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: month ? "long" : "short",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"))
export const shortMoney = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value / 100)

export function Hint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={text}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}
export function Panel({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "workspace-panel min-w-0 overflow-hidden rounded-2xl border bg-card",
        className
      )}
    >
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <Hint text={hint} />}
        </div>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}
export function Metric({
  title,
  value,
  detail,
  previous,
  current,
  icon: Icon = BarChart3,
  invert = false,
}: {
  title: string
  value: string
  detail?: string
  previous?: number
  current?: number
  icon?: typeof BarChart3
  invert?: boolean
}) {
  const change =
    previous === undefined || current === undefined
      ? null
      : statisticsChange(current, previous)
  const favorable =
    current !== undefined &&
    previous !== undefined &&
    (invert ? current < previous : current > previous)
  return (
    <article className="workspace-panel min-w-0 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground sm:text-sm">
          {title}
        </h3>
        <Icon className="size-4 shrink-0 text-primary" />
      </div>
      <p className="mt-4 text-xl font-semibold tracking-tight break-words tabular-nums sm:text-2xl 2xl:text-3xl">
        {value}
      </p>
      {change && (
        <p
          className={cn(
            "mt-2 flex flex-wrap items-center gap-1 text-xs",
            favorable
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground"
          )}
        >
          {current !== previous &&
            previous !== 0 &&
            (!change.startsWith("-") ? (
              <ArrowUpRight className="size-3.5" />
            ) : (
              <ArrowDownLeft className="size-3.5" />
            ))}
          {change}
          <span className="text-muted-foreground">к пред. периоду</span>
        </p>
      )}
      {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
    </article>
  )
}
type PlotRow = { date: string; [key: string]: number | string | null }
export function Trend({
  data,
  series,
  type = "area",
  money = false,
  format = integer,
}: {
  data: PlotRow[]
  series: { key: string; label: string; color?: string }[]
  type?: "area" | "bar" | "line"
  money?: boolean
  format?: (value: number) => string
}) {
  const config = Object.fromEntries(
    series.map((item, i) => [
      item.key,
      { label: item.label, color: item.color ?? colors[i % colors.length] },
    ])
  )
  const props = {
    data,
    margin: { top: 8, right: 8, left: -18, bottom: 0 },
    accessibilityLayer: true,
  }
  const axes = (
    <>
      <CartesianGrid vertical={false} strokeDasharray="3 3" />
      <XAxis
        dataKey="date"
        tickFormatter={(value) => dateLabel(String(value))}
        minTickGap={32}
        tickLine={false}
        axisLine={false}
        tickMargin={10}
      />
      <YAxis
        tickFormatter={(value) =>
          money ? shortMoney(Number(value)) : integer(Number(value))
        }
        allowDecimals={false}
        tickLine={false}
        axisLine={false}
        width={65}
      />
      <ChartTooltip
        content={
          <ChartTooltipContent
            labelFormatter={(value) => dateLabel(String(value), true)}
            formatter={(value, name) => (
              <div className="flex min-w-32 justify-between gap-4">
                <span className="text-muted-foreground">
                  {config[String(name)]?.label ?? String(name)}
                </span>
                <strong className="tabular-nums">
                  {format(Number(value))}
                </strong>
              </div>
            )}
          />
        }
      />
    </>
  )
  return (
    <>
      <ChartContainer
        config={config}
        className="aspect-auto h-60 w-full min-w-0 sm:h-72"
      >
        {type === "bar" ? (
          <BarChart {...props}>
            {axes}
            {series.map((item) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                fill={`var(--color-${item.key})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        ) : type === "line" ? (
          <LineChart {...props}>
            {axes}
            {series.map((item) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                stroke={`var(--color-${item.key})`}
                strokeWidth={2.5}
                dot={data.length < 15}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        ) : (
          <AreaChart {...props}>
            {axes}
            {series.map((item) => (
              <Area
                key={item.key}
                type="monotone"
                dataKey={item.key}
                stroke={`var(--color-${item.key})`}
                fill={`var(--color-${item.key})`}
                fillOpacity={0.12}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        )}
      </ChartContainer>
      <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {series.map((item) => (
          <span key={item.key} className="flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: config[item.key].color }}
            />
            {item.label}
          </span>
        ))}
      </div>
      <details className="mt-4 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded py-1 focus-visible:ring-2 focus-visible:ring-ring">
          Данные по дням
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border">
          <table className="w-full text-right tabular-nums">
            <thead className="sticky top-0 bg-card">
              <tr>
                <th className="p-2 text-left">Дата</th>
                {series.map((item) => (
                  <th key={item.key} className="p-2">
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.date} className="border-t">
                  <td className="p-2 text-left whitespace-nowrap">
                    {dateLabel(row.date)}
                  </td>
                  {series.map((item) => (
                    <td key={item.key} className="p-2 whitespace-nowrap">
                      {row[item.key] === null
                        ? "—"
                        : format(Number(row[item.key]))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}
export function Distribution({
  items,
  format = integer,
}: {
  items: { label: string; value: number }[]
  format?: (value: number) => string
}) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0)
  if (!total) return <Empty />
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
      <ChartContainer
        config={{ value: { label: "Количество" } }}
        className="mx-auto aspect-auto h-44 w-full max-w-60"
      >
        <PieChart accessibilityLayer>
          <Pie
            data={items.filter((item) => item.value > 0)}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={3}
            stroke="none"
            isAnimationActive={false}
          >
            {items
              .filter((item) => item.value > 0)
              .map((item, i) => (
                <Cell key={item.label} fill={colors[i % colors.length]} />
              ))}
          </Pie>
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, name) => (
                  <span>
                    {String(name)}: <strong>{format(Number(value))}</strong>
                  </span>
                )}
              />
            }
          />
        </PieChart>
      </ChartContainer>
      <ul className="min-w-0 space-y-3">
        {items.map((item, i) => (
          <li
            key={item.label}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: colors[i % colors.length] }}
              />
              <span className="break-words">{item.label}</span>
            </span>
            <span className="shrink-0 text-right tabular-nums">
              <strong>{format(item.value)}</strong>
              <span className="ml-2 text-muted-foreground">
                {Math.round((Math.max(0, item.value) / total) * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
export function Empty({
  text = "За выбранный период данных нет",
}: {
  text?: string
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
      <BarChart3 className="size-6 opacity-50" />
      <p>{text}</p>
    </div>
  )
}
export function RouteRanking({ report }: { report: StatisticsReport }) {
  if (!report.routes.length) return <Empty text="За этот период рейсов нет" />
  return (
    <div className="max-h-96 space-y-5 overflow-auto">
      {report.routes.map((route) => {
        const load = statisticsOccupancy(route.passengers, route.capacity)
        return (
          <div key={route.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{route.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {integer(route.passengers)} / {integer(route.capacity)} мест ·{" "}
                {integer(route.trips)} рейсов
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-chart-2"
                  style={{ width: `${Math.min(100, load ?? 0)}%` }}
                />
              </div>
              <span className="w-10 text-right text-xs tabular-nums">
                {load === null ? "—" : `${Math.round(load)}%`}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
