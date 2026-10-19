"use client"

import { Check, ChevronDown } from "lucide-react"
import { HexColorPicker } from "react-colorful"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const presets = [
  "#E9B74D",
  "#F97316",
  "#EF4444",
  "#EC4899",
  "#8B5CF6",
  "#3B82F6",
  "#14B8A6",
  "#22C55E",
]

export function ColorPicker({
  value,
  onValueChange,
  onValueCommit,
  disabled,
  id,
}: {
  value: string
  onValueChange: (value: string) => void
  onValueCommit?: (value: string) => void
  disabled?: boolean
  id?: string
}) {
  const valid = /^#[\da-f]{6}$/i.test(value)
  const color = valid ? value : "#E9B74D"
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open && valid) onValueCommit?.(value)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            disabled={disabled}
            variant="outline"
            className="w-full justify-start font-normal"
            aria-label="Выбрать основной цвет"
          />
        }
      >
        <span
          aria-hidden
          className="size-5 shrink-0 rounded-md"
          style={{ backgroundColor: color }}
        />
        <span className="font-mono uppercase">{color}</span>
        <ChevronDown className="ml-auto text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="color-picker w-72 gap-4">
        <p className="text-sm font-medium">Основной цвет</p>
        <HexColorPicker
          color={color}
          onChange={(next) => onValueChange(next.toUpperCase())}
        />
        <div
          className="grid grid-cols-4 gap-2 sm:grid-cols-8"
          aria-label="Палитра цветов"
        >
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`Цвет ${preset}`}
              aria-pressed={preset === color.toUpperCase()}
              onClick={() => onValueChange(preset)}
              className="grid size-11 place-items-center rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring sm:size-7"
              style={{ backgroundColor: preset }}
            >
              {preset === color.toUpperCase() ? (
                <Check className="size-4 text-white drop-shadow" />
              ) : null}
            </button>
          ))}
        </div>
        <label className="space-y-2 text-xs text-muted-foreground">
          HEX
          <Input
            aria-label="HEX цвета"
            className="mt-2 font-mono uppercase"
            value={value}
            maxLength={7}
            pattern="^#[0-9A-Fa-f]{6}$"
            onChange={(event) =>
              onValueChange(event.target.value.toUpperCase())
            }
            aria-invalid={!valid}
          />
        </label>
      </PopoverContent>
    </Popover>
  )
}
