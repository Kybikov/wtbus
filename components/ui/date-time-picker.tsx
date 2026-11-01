"use client"

import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"

export function DateTimePicker({
  label,
  value,
  onValueChange,
  required = false,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  required?: boolean
}) {
  const [date = "", time = ""] = value.split("T")
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
      <DatePicker
        label={`${label}: дата`}
        value={date}
        required={required}
        onValueChange={(next) => onValueChange(`${next}T${time || "09:00"}`)}
      />
      <Input
        aria-label={`${label}: время`}
        type="time"
        value={time}
        required={required}
        onChange={(event) => onValueChange(`${date}T${event.target.value}`)}
      />
    </div>
  )
}
