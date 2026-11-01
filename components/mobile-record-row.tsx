"use client"
import type { ReactNode } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { MobileSwipeActions } from "@/components/mobile-swipe-actions"
import { cn } from "@/lib/utils"

export function MobileRecordRow({
  label,
  selected,
  selecting,
  selectable,
  onSelect,
  onOpen,
  summary,
  content,
  actions,
  swipeActions,
}: {
  label: string
  selected: boolean
  selecting: boolean
  selectable: boolean
  onSelect: () => void
  onOpen?: () => void
  summary: ReactNode
  content?: ReactNode
  actions?: ReactNode
  swipeActions?: {
    label: string
    destructive?: boolean
    onSelect: () => void
  }[]
}) {
  const tap = () => {
    if (selecting && selectable) onSelect()
    else onOpen?.()
  }
  return (
    <MobileSwipeActions
      label={label}
      onOpen={onOpen}
      onTap={tap}
      onHold={selectable ? onSelect : undefined}
      onSelect={selectable ? onSelect : undefined}
      selected={selected}
      actions={swipeActions}
    >
      <article
        role="listitem"
        tabIndex={0}
        aria-label={selected ? `${label}, выбрано` : label}
        className={cn(
          "flex min-h-20 items-center gap-3 rounded-[26px] border border-border bg-card px-4 py-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
          selected && "border-primary bg-primary/10"
        )}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          if (
            !(event.target as HTMLElement).closest(
              "button,a,input,[role=checkbox]"
            )
          )
            tap()
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === " " && selectable) {
            event.preventDefault()
            onSelect()
          } else if (event.key === "Enter") {
            event.preventDefault()
            tap()
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
        <div className="min-w-0 flex-1 [&>div]:p-0">
          {content ?? (
            <>
              <p className="truncate text-sm font-semibold">{label}</p>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {summary}
              </div>
            </>
          )}
        </div>
        {actions}
      </article>
    </MobileSwipeActions>
  )
}
