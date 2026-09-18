"use client"

import { useState, type ChangeEvent } from "react"
import { CalendarDays } from "lucide-react"
import { uk } from "react-day-picker/locale"
import type { DropdownProps } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { FieldSelect } from "@/components/ui/field-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// Civil dates stay local to the calendar: never parse YYYY-MM-DD as UTC.
function civilDate(value?: string) {
  const [year, month, day] = (value ?? "").split("-").map(Number)
  return value ? new Date(year, month - 1, day, 12) : undefined
}

function CalendarDropdown({ options, value, onChange, "aria-label": label }: DropdownProps) {
  return <FieldSelect aria-label={label} value={String(value)} options={(options ?? []).map((option) => ({ ...option, value: String(option.value) }))} onValueChange={(next) => onChange?.({ target: { value: next } } as ChangeEvent<HTMLSelectElement>)} triggerClassName="data-[size=default]:h-8 min-w-0 px-2 text-xs" />
}

export function DatePicker({ id, label, value, onValueChange, min, max, disabled, required, className }: {
  id?: string; label: string; value: string; onValueChange: (value: string) => void; min?: string; max?: string; disabled?: boolean; required?: boolean; className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = civilDate(value)
  const earliest = civilDate(min)
  const latest = civilDate(max)
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button id={id} type="button" variant="outline" disabled={disabled} aria-label={label} aria-required={required} className={cn("h-11 w-full justify-between rounded-xl bg-background px-3 font-normal text-foreground aria-expanded:bg-background dark:bg-background dark:hover:bg-muted", className)} />}>
      <span className="truncate">{selected ? new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(selected) : "Оберіть дату"}</span><CalendarDays className="size-4 shrink-0" />
    </PopoverTrigger>
    <PopoverContent align="start" aria-label={label} className="w-auto max-w-[calc(100vw-2rem)] gap-0 rounded-xl p-0 motion-reduce:animate-none">
      <Calendar mode="single" required selected={selected} defaultMonth={selected ?? latest ?? earliest} locale={uk} autoFocus captionLayout="dropdown" startMonth={earliest ?? new Date(1900, 0)} endMonth={latest ?? new Date(2100, 11)} disabled={[...(earliest ? [{ before: earliest }] : []), ...(latest ? [{ after: latest }] : [])]} components={{ Dropdown: CalendarDropdown }} classNames={{ dropdowns: "flex w-full min-w-0 items-center gap-2" }} onSelect={(date) => { if (date) { onValueChange(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`); setOpen(false) } }} />
    </PopoverContent>
  </Popover>
}
