"use client"

import { FieldSelect } from "@/components/ui/field-select"
import { StatisticsPeriodPicker } from "@/components/statistics-period-picker"

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
  return (
    <div
      role="group"
      aria-label="Период и валюта статистики"
      className="flex min-w-0 items-center gap-2"
    >
      <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
        <StatisticsPeriodPicker
          today={today}
          from={from}
          to={to}
          onChange={onChange}
        />
      </div>
      {financial && (
        <div className="w-20 shrink-0">
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
