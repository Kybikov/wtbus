"use client"

import { CalendarDays, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { FieldSelect } from "@/components/ui/field-select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { statisticsPreset } from "@/lib/statistics"
import { cn } from "@/lib/utils"

// Quick-preset interaction follows the current React Bits Pro scheduling-4.
// Use the product's shadcn calendars and Glide Select for actual date/currency input.
const presets = [
  { key: "today", label: "Сегодня" },
  { key: "week", label: "7 дней" },
  { key: "30days", label: "30 дней" },
  { key: "month", label: "Этот месяц" },
]

export function StatisticsToolbar({
  today,
  from,
  to,
  currency,
  financial,
  onChange,
}: {
  today?: string
  from: string
  to: string
  currency: string
  financial: boolean
  onChange: (values: Record<string, string>) => void
}) {
  const active = today
    ? presets.find((preset) => {
        const range = statisticsPreset(today, preset.key)
        return range.from === from && range.to === to
      })
    : undefined
  return (
    <div
      role="group"
      aria-label="Период и валюта статистики"
      className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:items-center"
    >
      <div
        className={cn(
          "order-1 min-w-0 sm:w-36 sm:shrink-0",
          !financial && "col-span-2 sm:col-span-1"
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                className="h-10 w-full min-w-0 justify-between gap-1.5 bg-control px-2 text-xs font-normal sm:h-9"
                aria-label="Быстрый период статистики"
                disabled={!today}
                disabledReason="Дождитесь загрузки статистики, чтобы выбрать период в часовом поясе компании."
              />
            }
          >
            <CalendarDays className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              {active?.label ?? "Свои даты"}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-44"
            aria-label="Быстрый период статистики"
          >
            <DropdownMenuRadioGroup
              value={active?.key ?? ""}
              onValueChange={(value) => {
                if (today) onChange(statisticsPreset(today, String(value)))
              }}
            >
              {presets.map((preset) => (
                <DropdownMenuRadioItem
                  key={preset.key}
                  value={preset.key}
                  closeOnClick
                >
                  {preset.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="order-3 min-w-0 sm:order-2 sm:w-36 sm:shrink-0">
        <DatePicker
          label="Начало периода"
          prefix="С"
          value={from}
          max={to || undefined}
          onValueChange={(value) => onChange({ from: value })}
          className="h-10 gap-1.5 px-2 text-xs sm:h-9"
        />
      </div>
      <div className="order-4 min-w-0 sm:order-3 sm:w-36 sm:shrink-0">
        <DatePicker
          label="Конец периода"
          prefix="По"
          value={to}
          min={from || undefined}
          onValueChange={(value) => onChange({ to: value })}
          className="h-10 gap-1.5 px-2 text-xs sm:h-9"
        />
      </div>
      {financial && (
        <div className="order-2 min-w-0 sm:order-4 sm:w-20 sm:shrink-0">
          <FieldSelect
            aria-label="Валюта статистики"
            value={currency}
            options={["UAH", "EUR", "USD", "PLN"].map((value) => ({
              value,
              label: value,
            }))}
            onValueChange={(value) => onChange({ currency: value })}
            triggerClassName="h-10 px-2 text-xs sm:h-9"
          />
        </div>
      )}
    </div>
  )
}
