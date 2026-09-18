"use client"

import type { ComponentProps } from "react"
import PhoneNumberInput, { getCountryCallingCode, type Country } from "react-phone-number-input"
import labels from "react-phone-number-input/locale/ua"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

function CountrySelect({ value, options, onChange, disabled, readOnly }: {
  value?: Country; options: { value?: Country; label: string; divider?: boolean }[]
  onChange: (value?: Country) => void; disabled?: boolean; readOnly?: boolean
}) {
  return <Select value={value ?? "international"} onValueChange={(next) => onChange(next === "international" ? undefined : next as Country)} disabled={disabled || readOnly}>
    <SelectTrigger aria-label="Країна телефонного номера" className="h-11! w-24 shrink-0 rounded-xl border-border bg-background px-3">
      <SelectValue>{value ? `${value} +${getCountryCallingCode(value)}` : "+"}</SelectValue>
    </SelectTrigger>
    <SelectContent alignItemWithTrigger={false} className="max-w-[calc(100vw-2rem)]">
      {options.filter((option) => !option.divider).map((option) => <SelectItem key={option.value ?? "international"} value={option.value ?? "international"}>{option.label}{option.value && ` +${getCountryCallingCode(option.value)}`}</SelectItem>)}
    </SelectContent>
  </Select>
}

export function PhoneInput({ className, ...props }: ComponentProps<typeof PhoneNumberInput>) {
  return <PhoneNumberInput defaultCountry="UA" international labels={labels} inputComponent={Input} countrySelectComponent={CountrySelect} className={cn("flex min-w-0 gap-2 [&_input]:h-11 [&_input]:rounded-xl [&_input]:border-border [&_input]:bg-background [&_input]:px-3", className)} {...props} />
}
