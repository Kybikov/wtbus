"use client"

import { useState } from "react"
import { CalendarDays, ChevronDown } from "lucide-react"
import { ru } from "react-day-picker/locale"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  isStatisticsDate,
  shiftStatisticsDate,
  statisticsPeriodLabel,
  statisticsPeriodPresets,
  statisticsPreset,
} from "@/lib/statistics"
import { cn } from "@/lib/utils"

const date = (value: string) => {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day, 12)
}
const key = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
// Shared shadcn range calendar; quick selection follows the fetched React Bits
// scheduling-4 interaction, composed into the user's two-month reference layout.
export function StatisticsPeriodPicker({
  today,
  from,
  to,
  onChange,
}: {
  today?: string
  from: string
  to: string
  onChange: (range: { from: string; to: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState<Date>()
  const [draft, setDraft] = useState<DateRange>()
  const label = statisticsPeriodLabel(today, from, to)
  const apply = (range: { from: string; to: string }) => {
    onChange(range)
    setOpen(false)
  }
  const chooseOpen = (next: boolean) => {
    if (next) {
      const initial = isStatisticsDate(from) ? from : today
      if (initial) setMonth(date(initial.slice(0, 7) + "-01"))
      setDraft(
        isStatisticsDate(from) && isStatisticsDate(to)
          ? { from: date(from), to: date(to) }
          : undefined
      )
    }
    setOpen(next)
  }
  const pending = draft?.from && !draft.to
  return (
    <Popover open={open} onOpenChange={chooseOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            aria-label="Период статистики"
            aria-description={
              from && to ? `${label}: ${from} — ${to}` : "Выбрать период"
            }
            disabled={!today}
            disabledReason="Дождитесь загрузки статистики, чтобы выбрать период в часовом поясе компании."
            className="h-10 w-full min-w-0 justify-between gap-2 bg-control px-3 text-xs font-normal sm:h-9"
          />
        }
      >
        <CalendarDays className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Выбор периода"
        className="statistics-period-popup w-[34rem] max-w-[calc(100vw-1rem)] gap-0 overscroll-contain p-0"
      >
        <div className="order-2 px-2 pt-2 sm:order-1 sm:px-3">
          <Calendar
            mode="range"
            locale={ru}
            numberOfMonths={2}
            captionLayout="dropdown"
            formatters={{
              formatMonthDropdown: (value) =>
                value.toLocaleString("ru-RU", { month: "long" }),
            }}
            month={month}
            onMonthChange={setMonth}
            selected={draft}
            resetOnSelect
            required
            max={365}
            startMonth={date("1900-01-01")}
            endMonth={date("2100-12-01")}
            showOutsideDays={false}
            disabled={[
              { before: date("1900-01-01") },
              { after: date("2100-12-31") },
              ...(pending
                ? [
                    {
                      before: date(shiftStatisticsDate(key(draft.from!), -365)),
                    },
                    { after: date(shiftStatisticsDate(key(draft.from!), 365)) },
                  ]
                : []),
            ]}
            className="w-full bg-transparent p-2 [--cell-size:2rem]"
            classNames={{
              months: "relative flex flex-col gap-5 sm:flex-row",
              month: "flex w-full min-w-0 flex-col gap-3",
              month_caption:
                "flex h-11 w-full items-center justify-center px-11 sm:h-8 sm:px-8",
              dropdown_root:
                "relative flex h-full items-center rounded-lg px-1",
              dropdown:
                "absolute inset-0 h-full w-full cursor-pointer bg-popover opacity-0",
              dropdowns:
                "flex h-full w-full min-w-0 items-center justify-center gap-1",
            }}
            onSelect={(range) => {
              setDraft(range)
              if (range?.from && range.to)
                apply({ from: key(range.from), to: key(range.to) })
            }}
          />
          <p role="status" className="px-2 pb-3 text-xs text-muted-foreground">
            {pending
              ? "Выберите последнюю дату периода"
              : "Выберите первую и последнюю дату периода"}
          </p>
        </div>
        <div className="order-1 border-b p-4 sm:order-2 sm:border-t sm:border-b-0">
          <p className="mb-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Быстрый выбор
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {statisticsPeriodPresets.map((preset) => {
              const range = today ? statisticsPreset(today, preset.key) : null
              const available =
                !!range &&
                isStatisticsDate(range.from) &&
                isStatisticsDate(range.to)
              const active = range?.from === from && range?.to === to
              return (
                <Button
                  key={preset.key}
                  variant="outline"
                  aria-pressed={active}
                  disabled={!available}
                  disabledReason={
                    !today
                      ? "Дождитесь загрузки статистики."
                      : "Доступны даты с 1900 по 2100 год."
                  }
                  className={cn(
                    "h-8 rounded-full px-2 text-[11px] font-medium sm:text-xs",
                    active && "border-primary/50 bg-primary/12"
                  )}
                  onClick={() => range && apply(range)}
                >
                  {preset.label}
                </Button>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
