"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

type FieldSelectOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

type FieldSelectProps = {
  value: string
  onValueChange: (value: string) => void
  options: FieldSelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  "aria-label"?: string
}

function FieldSelect({
  value,
  onValueChange,
  options,
  placeholder = "Выберите значение",
  disabled,
  className,
  triggerClassName,
  "aria-label": ariaLabel,
}: FieldSelectProps) {
  return (
    <Select
      disabled={disabled}
      onValueChange={(nextValue) => onValueChange(nextValue ?? "")}
      value={value}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-11 w-full rounded-xl border-border bg-background px-3 text-left font-normal",
          triggerClassName
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={className}>
        {options.map((option) => (
          <SelectItem
            disabled={option.disabled}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { FieldSelect, type FieldSelectOption }
