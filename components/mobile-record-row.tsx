"use client"

import * as React from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

// Mobile 5 Sorbet: compact independent rows. A hold selects without blocking scroll.
export function MobileRecordRow({
  label,
  selected,
  selecting,
  selectable,
  onSelect,
  onOpen,
  summary,
  actions,
}: {
  label: string
  selected: boolean
  selecting: boolean
  selectable: boolean
  onSelect: () => void
  onOpen?: () => void
  summary: React.ReactNode
  actions?: React.ReactNode
}) {
  const hold = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const origin = React.useRef({ x: 0, y: 0 })
  const held = React.useRef(false)
  const clear = () => clearTimeout(hold.current)
  React.useEffect(() => () => clearTimeout(hold.current), [])
  return (
    <article
      role="listitem"
      tabIndex={0}
      aria-label={selected ? `${label}, выбрано` : label}
      className={cn(
        "flex min-h-20 touch-auto items-center gap-3 rounded-[26px] border border-border bg-card px-4 py-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary bg-primary/10"
      )}
      onPointerDown={(event) => {
        clear()
        held.current = false
        if (
          event.pointerType === "mouse" ||
          !selectable ||
          (event.target as HTMLElement).closest(
            "button,a,input,[role=checkbox]"
          )
        )
          return
        origin.current = { x: event.clientX, y: event.clientY }
        hold.current = setTimeout(() => {
          held.current = true
          onSelect()
        }, 450)
      }}
      onPointerMove={(event) => {
        if (
          Math.hypot(
            event.clientX - origin.current.x,
            event.clientY - origin.current.y
          ) > 8
        )
          clear()
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button,a,input,[role=checkbox]"
          )
        )
          return
        if (held.current) {
          held.current = false
          return
        }
        if (selecting && selectable) onSelect()
        else onOpen?.()
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === " " && selectable) {
          event.preventDefault()
          onSelect()
        } else if (event.key === "Enter") {
          event.preventDefault()
          if (selecting && selectable) onSelect()
          else onOpen?.()
        }
      }}
    >
      {selecting ? (
        <Checkbox
          aria-label={`Выбрать ${label}`}
          checked={selected}
          disabled={!selectable}
          onCheckedChange={onSelect}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{label}</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {summary}
        </div>
      </div>
      {actions}
    </article>
  )
}
