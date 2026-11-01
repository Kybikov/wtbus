"use client"

import { MapPin } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DisabledActionScope } from "@/components/disabled-action-scope"

export function MapPointTarget({
  value,
  onValueChange,
  disabled = false,
  disabledReason,
}: {
  value: "start" | "end"
  onValueChange: (value: "start" | "end") => void
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <p className="text-xs text-muted-foreground">
        Нажмите на карту, чтобы изменить место:
      </p>
      <DisabledActionScope reason={disabled ? disabledReason : undefined}>
        <Tabs
          value={value}
          onValueChange={(next) => {
            if (!disabled) onValueChange(next as "start" | "end")
          }}
        >
          <TabsList
            aria-label="Какое место изменить на карте"
            className="w-full sm:w-fit"
          >
            <TabsTrigger
              value="start"
              disabled={disabled}
              data-disabled-reason={disabled ? disabledReason : undefined}
            >
              <MapPin className="size-4" />
              Посадка
            </TabsTrigger>
            <TabsTrigger
              value="end"
              disabled={disabled}
              data-disabled-reason={disabled ? disabledReason : undefined}
            >
              <MapPin className="size-4" />
              Высадка
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </DisabledActionScope>
    </div>
  )
}
