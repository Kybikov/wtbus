"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import {
  Panel,
  dateLabel,
  integer,
  shortMoney,
} from "@/components/statistics-charts"
import {
  statisticsCalendar,
  statisticsMonth,
  type StatisticsReport,
} from "@/lib/statistics"
import { cn } from "@/lib/utils"

export function StatisticsCalendar({
  report,
  money,
  onMonth,
  metric,
  onMetricChange,
}: {
  report: StatisticsReport
  money: (value: number) => string
  onMonth: (range: { from: string; to: string }) => void
  metric: string
  onMetricChange: (value: string) => void
}) {
  const [selected, setSelected] = useState("")
  const month = statisticsMonth(report.from)
  const days = statisticsCalendar(month.from)
  const byDate = new Map(report.daily.map((day) => [day.date, day]))
  const cash = new Map(
    report.finance?.daily.map((day) => [day.date, day.revenueMinor]) ?? []
  )
  const valueFor = (date: string) =>
    metric === "revenue"
      ? (cash.get(date) ?? 0)
      : (byDate.get(date)?.[metric as "bookings" | "passengers" | "trips"] ?? 0)
  const max = Math.max(
    1,
    ...report.daily.map((day) => Math.abs(valueFor(day.date)))
  )
  const selectedDate = byDate.has(selected)
    ? selected
    : byDate.has(report.today)
      ? report.today
      : report.from
  const day = byDate.get(selectedDate)!
  return (
    <Panel
      title="Календарь показателей"
      action={
        <div className="w-40">
          <FieldSelect
            aria-label="Показатель календаря"
            value={metric}
            options={[
              { value: "bookings", label: "Бронирования" },
              { value: "passengers", label: "Пассажиры" },
              { value: "trips", label: "Рейсы" },
              ...(report.finance
                ? [{ value: "revenue", label: "Получено" }]
                : []),
            ]}
            onValueChange={onMetricChange}
            triggerClassName="h-9"
          />
        </div>
      }
    >
      <div className="mb-5 flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Предыдущий месяц"
          disabled={month.from <= "1900-01-01"}
          disabledReason="Доступны даты начиная с января 1900 года."
          onClick={() => onMonth(statisticsMonth(month.from, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <h3 className="text-center text-sm font-semibold capitalize">
          {new Intl.DateTimeFormat("ru-RU", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(month.from + "T12:00:00Z"))}
        </h3>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Следующий месяц"
          disabled={month.to >= "2100-12-31"}
          disabledReason="Доступны даты до декабря 2100 года."
          onClick={() => onMonth(statisticsMonth(month.from, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label) => (
          <div
            key={label}
            className="pb-2 text-center text-xs text-muted-foreground"
          >
            {label}
          </div>
        ))}
        {days.map((date) => {
          const inMonth = date >= month.from && date <= month.to
          const available = inMonth && byDate.has(date)
          const value = valueFor(date)
          const intensity =
            available && value ? 0.08 + (Math.abs(value) / max) * 0.22 : 0
          return (
            <Button
              key={date}
              variant="ghost"
              disabled={!available}
              disabledReason={
                inMonth
                  ? "Дата находится за пределами выбранного периода. Выберите весь месяц стрелками календаря."
                  : "Дата другого месяца. Переключите месяц стрелками."
              }
              aria-label={`${dateLabel(date, true)}: ${available ? (metric === "revenue" ? money(value) : integer(value)) : "вне периода"}`}
              aria-pressed={selectedDate === date}
              onClick={() => setSelected(date)}
              className={cn(
                "relative flex h-16 min-w-0 flex-col items-center justify-between gap-1 rounded-lg border border-transparent px-0.5 py-2 font-normal sm:h-24 sm:p-3",
                available && "bg-muted/30",
                !inMonth && "opacity-30",
                selectedDate === date && "border-primary ring-1 ring-primary",
                date === report.today && "font-semibold"
              )}
              style={
                intensity
                  ? {
                      backgroundColor: `color-mix(in oklch, var(--chart-1) ${Math.round(intensity * 100)}%, var(--card))`,
                    }
                  : undefined
              }
            >
              <span className="text-xs sm:text-sm">
                {Number(date.slice(-2))}
              </span>
              <span
                className={cn(
                  "max-w-full truncate text-[10px] tabular-nums sm:text-sm",
                  (!value || !available) && "text-muted-foreground"
                )}
              >
                {available
                  ? metric === "revenue"
                    ? shortMoney(value)
                    : integer(value)
                  : "—"}
              </span>
            </Button>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Чем насыщеннее цвет, тем выше показатель.
        {metric === "revenue" && ` Суммы в ${report.finance?.currency}.`}
      </p>
      {day && (
        <div className="mt-5 rounded-xl border bg-muted/20 p-4">
          <h3 className="mb-3 text-sm font-semibold">
            {dateLabel(selectedDate, true)}
          </h3>
          <dl className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
            {[
              { label: "Бронирования", value: integer(day.bookings) },
              { label: "Пассажиры", value: integer(day.passengers) },
              { label: "Рейсы", value: integer(day.trips) },
              ...(report.finance
                ? [
                    {
                      label: "Получено",
                      value: money(cash.get(selectedDate) ?? 0),
                    },
                  ]
                : []),
            ].map((item) => (
              <div key={item.label}>
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="mt-1 text-base font-semibold tabular-nums">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Panel>
  )
}
