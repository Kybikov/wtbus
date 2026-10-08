"use client"

import * as React from "react"
import { GripVertical } from "lucide-react"

import { cn } from "@/lib/utils"

// Adapted from React Bits Pro App UI / Kanban 3.
// Drag position stays on the DOM. React state changes only when the card
// is dropped, so a full column does not re-render on every pointer move.
export type ReactBitsKanbanTone =
  "neutral" | "info" | "warning" | "success" | "danger" | "violet"

export type ReactBitsKanbanColumn = {
  id: string
  label: string
  description?: string
  tone?: ReactBitsKanbanTone
}

type Props<T> = {
  items: T[]
  columns: ReactBitsKanbanColumn[]
  getId: (item: T) => string
  getGroup: (item: T) => string
  getLabel: (item: T) => string
  renderCard: (item: T) => React.ReactNode
  renderGhost?: (item: T) => React.ReactNode
  canMove?: (item: T) => boolean
  canMoveTo?: (item: T, group: string) => boolean
  onMove?: (item: T, group: string) => boolean | void | Promise<boolean | void>
  emptyText?: string
}

const PAGE = 40

const toneStyles: Record<
  ReactBitsKanbanTone,
  { column: string; dot: string; count: string }
> = {
  neutral: {
    column: "border-border bg-muted/30",
    dot: "bg-muted-foreground",
    count: "bg-muted text-muted-foreground",
  },
  info: {
    column: "border-sky-500/20 bg-sky-500/[0.045]",
    dot: "bg-sky-400",
    count: "bg-sky-500/12 text-sky-300",
  },
  warning: {
    column: "border-amber-500/20 bg-amber-500/[0.045]",
    dot: "bg-amber-400",
    count: "bg-amber-500/12 text-amber-300",
  },
  success: {
    column: "border-emerald-500/20 bg-emerald-500/[0.045]",
    dot: "bg-emerald-400",
    count: "bg-emerald-500/12 text-emerald-300",
  },
  danger: {
    column: "border-red-500/20 bg-red-500/[0.04]",
    dot: "bg-red-400",
    count: "bg-red-500/12 text-red-300",
  },
  violet: {
    column: "border-violet-500/20 bg-violet-500/[0.045]",
    dot: "bg-violet-400",
    count: "bg-violet-500/12 text-violet-300",
  },
}

export default function ReactBitsKanban<T>({
  items,
  columns,
  getId,
  getGroup,
  getLabel,
  renderCard,
  canMove = () => true,
  canMoveTo = () => true,
  onMove,
  emptyText = "Здесь пока ничего нет",
}: Props<T>) {
  const itemById = React.useMemo(
    () => new Map(items.map((item) => [getId(item), item])),
    [getId, items]
  )
  const itemIds = React.useMemo(() => items.map(getId), [getId, items])
  const [order, setOrder] = React.useState(() => itemIds)
  const [groups, setGroups] = React.useState<Record<string, string>>({})
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [grabbedId, setGrabbedId] = React.useState<string | null>(null)
  const [shown, setShown] = React.useState<Record<string, number>>({})
  const [announcement, setAnnouncement] = React.useState("")
  const rootRef = React.useRef<HTMLDivElement>(null)
  const ghostRef = React.useRef<HTMLDivElement>(null)
  const columnRefs = React.useRef(new Map<string, HTMLElement>())
  const dragRef = React.useRef<{
    id: string
    origin: string
    dx: number
    dy: number
    width: number
    active: boolean
    startX: number
    startY: number
    pointerId: number
  } | null>(null)
  const dropRef = React.useRef<{ group: string; index: number } | null>(null)
  const keyboardOrigin = React.useRef<string | null>(null)

  const effectiveOrder = React.useMemo(() => {
    const seen = new Set(order)
    return [
      ...order.filter((id) => itemById.has(id)),
      ...itemIds.filter((id) => !seen.has(id)),
    ]
  }, [itemById, itemIds, order])

  const currentGroup = React.useCallback(
    (id: string) => {
      const item = itemById.get(id)
      return groups[id] ?? (item ? getGroup(item) : "")
    },
    [getGroup, groups, itemById]
  )

  const cardsByColumn = React.useMemo(() => {
    const result = new Map(columns.map((column) => [column.id, [] as string[]]))
    for (const id of effectiveOrder) {
      const group = currentGroup(id)
      if (!result.has(group)) result.set(group, [])
      result.get(group)?.push(id)
    }
    return result
  }, [columns, currentGroup, effectiveOrder])

  const visibleColumns = React.useMemo(() => {
    const result = [...columns]
    for (const group of cardsByColumn.keys()) {
      if (!result.some((column) => column.id === group)) {
        result.push({ id: group, label: group })
      }
    }
    return result
  }, [cardsByColumn, columns])

  const place = React.useCallback(
    (id: string, group: string, index: number) => {
      const item = itemById.get(id)
      if (!item || !canMoveTo(item, group)) return false
      setGroups((current) => ({ ...current, [id]: group }))
      setOrder((current) => {
        const seen = new Set(current)
        const base = [
          ...current.filter((candidate) => itemById.has(candidate)),
          ...itemIds.filter((candidate) => !seen.has(candidate)),
        ]
        const without = base.filter((candidate) => candidate !== id)
        const members = without.filter(
          (candidate) =>
            (groups[candidate] ??
              (itemById.get(candidate)
                ? getGroup(itemById.get(candidate)!)
                : "")) === group
        )
        const anchor = members[index]
        const next = [...without]
        if (anchor) next.splice(next.indexOf(anchor), 0, id)
        else {
          const last = members.at(-1)
          next.splice(last ? next.indexOf(last) + 1 : next.length, 0, id)
        }
        return next
      })
      return true
    },
    [canMoveTo, getGroup, groups, itemById, itemIds]
  )

  const commitMove = React.useCallback(
    async (id: string, origin: string, target = currentGroup(id)) => {
      const item = itemById.get(id)
      if (!item || target === origin || !onMove) return
      const accepted = await onMove(item, target)
      if (accepted === false) {
        setGroups((current) => ({ ...current, [id]: origin }))
        setAnnouncement(`${getLabel(item)} возвращён в колонку.`)
      } else {
        setAnnouncement(`${getLabel(item)} перемещён.`)
      }
    },
    [currentGroup, getLabel, itemById, onMove]
  )

  const paintDrop = (group: string | null) => {
    for (const [id, element] of columnRefs.current) {
      element.dataset.drop = id === group ? "true" : "false"
    }
  }

  const hideGhost = () => {
    const ghost = ghostRef.current
    if (!ghost) return
    ghost.hidden = true
  }

  const targetFromPoint = (clientX: number, clientY: number, id: string) => {
    for (const [group, element] of columnRefs.current) {
      const bounds = element.getBoundingClientRect()
      if (
        clientX < bounds.left ||
        clientX > bounds.right ||
        clientY < bounds.top ||
        clientY > bounds.bottom
      ) {
        continue
      }
      const cards = Array.from(
        element.querySelectorAll<HTMLElement>("[data-kanban-card]")
      ).filter((card) => card.dataset.kanbanCard !== id)
      let index = cards.length
      for (let position = 0; position < cards.length; position += 1) {
        const cardBounds = cards[position].getBoundingClientRect()
        if (clientY < cardBounds.top + cardBounds.height / 2) {
          index = position
          break
        }
      }
      return { group, index }
    }
    return null
  }

  const startPointerDrag = (
    event: React.PointerEvent<HTMLElement>,
    id: string
  ) => {
    if (
      (event.target as HTMLElement).closest(
        "button,input,textarea,select,a,[data-no-drag]"
      )
    )
      return
    const item = itemById.get(id)
    if (!onMove || !item || !canMove(item) || event.button !== 0) return
    const card = event.currentTarget.closest<HTMLElement>("[data-kanban-card]")
    const root = rootRef.current
    if (!card || !root) return
    event.preventDefault()
    const bounds = card.getBoundingClientRect()
    dragRef.current = {
      id,
      origin: currentGroup(id),
      dx: event.clientX - bounds.left,
      dy: event.clientY - bounds.top,
      width: bounds.width,
      active: false,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    }
    root.setPointerCapture(event.pointerId)
  }

  const movePointer = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const root = rootRef.current
    const ghost = ghostRef.current
    if (!drag || !root || !ghost) return
    if (!drag.active) {
      if (
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <
        4
      )
        return
      drag.active = true
      setDragId(drag.id)
      ghost.hidden = false
      ghost.textContent = getLabel(itemById.get(drag.id)!)
    }
    const rootBounds = root.getBoundingClientRect()
    ghost.style.transform = `translate(${event.clientX - rootBounds.left - drag.dx}px, ${event.clientY - rootBounds.top - drag.dy}px)`
    ghost.style.width = `${drag.width}px`
    const target = targetFromPoint(event.clientX, event.clientY, drag.id)
    dropRef.current = target
    paintDrop(target?.group ?? null)
  }

  const endPointerDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    const target = dropRef.current
    dragRef.current = null
    dropRef.current = null
    const root = rootRef.current
    if (root?.hasPointerCapture(drag.pointerId)) {
      root.releasePointerCapture(drag.pointerId)
    }
    hideGhost()
    paintDrop(null)
    if (drag.active && target) {
      const moved = place(drag.id, target.group, target.index)
      if (moved) void commitMove(drag.id, drag.origin, target.group)
    }
    setDragId(null)
  }

  const moveWithKeyboard = (
    event: React.KeyboardEvent<HTMLElement>,
    id: string
  ) => {
    const item = itemById.get(id)
    if (!onMove || !item || !canMove(item)) return
    const group = currentGroup(id)
    const cardIds = cardsByColumn.get(group) ?? []
    const cardIndex = cardIds.indexOf(id)
    const columnIndex = visibleColumns.findIndex(
      (column) => column.id === group
    )

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault()
      if (grabbedId === id) {
        setGrabbedId(null)
        void commitMove(id, keyboardOrigin.current ?? group)
        keyboardOrigin.current = null
      } else {
        keyboardOrigin.current = group
        setGrabbedId(id)
        setAnnouncement(`${getLabel(item)} выбран для перемещения.`)
      }
      return
    }
    if (event.key === "Escape" && grabbedId === id) {
      event.preventDefault()
      const origin = keyboardOrigin.current
      if (origin) setGroups((current) => ({ ...current, [id]: origin }))
      keyboardOrigin.current = null
      setGrabbedId(null)
      setAnnouncement("Перемещение отменено.")
      return
    }
    if (grabbedId !== id) return

    let handled = true
    if (event.key === "ArrowLeft" && columnIndex > 0) {
      const next = visibleColumns[columnIndex - 1].id
      place(id, next, (cardsByColumn.get(next) ?? []).length)
    } else if (
      event.key === "ArrowRight" &&
      columnIndex < visibleColumns.length - 1
    ) {
      const next = visibleColumns[columnIndex + 1].id
      place(id, next, (cardsByColumn.get(next) ?? []).length)
    } else if (event.key === "ArrowUp" && cardIndex > 0) {
      place(id, group, cardIndex - 1)
    } else if (event.key === "ArrowDown" && cardIndex < cardIds.length - 1) {
      place(id, group, cardIndex + 1)
    } else handled = false
    if (handled) event.preventDefault()
  }

  return (
    <div
      className={cn(
        "relative min-h-[28rem] w-full overflow-hidden",
        dragId && "touch-none select-none"
      )}
      onLostPointerCapture={endPointerDrag}
      onPointerCancel={endPointerDrag}
      onPointerMove={movePointer}
      onPointerUp={endPointerDrag}
      ref={rootRef}
    >
      <div className="flex w-full min-w-0 gap-3 overflow-x-auto pb-2">
        {visibleColumns.map((column) => {
          const ids = cardsByColumn.get(column.id) ?? []
          const limit = shown[column.id] ?? PAGE
          const visibleIds = ids.slice(0, limit)
          const tone = toneStyles[column.tone ?? "neutral"]
          return (
            <section
              aria-label={column.label}
              className={cn(
                "flex min-h-[26rem] w-[min(20rem,calc(100vw-3rem))] shrink-0 snap-start flex-col rounded-[var(--rb-r-2xl)] border p-1.5 data-[drop=true]:ring-2 data-[drop=true]:ring-primary/40",
                tone.column
              )}
              data-drop="false"
              key={column.id}
              ref={(element) => {
                if (element) columnRefs.current.set(column.id, element)
                else columnRefs.current.delete(column.id)
              }}
            >
              <div className="flex min-h-12 shrink-0 items-center gap-2 px-2 py-1.5">
                <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
                <span className="truncate text-sm font-semibold">
                  {column.label}
                </span>
                <span
                  className={cn(
                    "ml-auto rounded-full px-2 py-0.5 text-xs tabular-nums",
                    tone.count
                  )}
                >
                  {ids.length}
                </span>
                {column.description ? (
                  <span className="sr-only">{column.description}</span>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-1 pt-0">
                {visibleIds.map((id) => {
                  const item = itemById.get(id)
                  if (!item) return null
                  const movable = Boolean(onMove && canMove(item))
                  const dragging = dragId === id
                  const grabbed = grabbedId === id
                  return (
                    <div
                      className={cn(
                        "rounded-[var(--rb-r-lg)] border border-border/80 bg-card p-3 text-left shadow-sm",
                        movable &&
                          "cursor-grab hover:border-primary/35 focus-visible:outline-2 focus-visible:outline-primary",
                        grabbed && "border-primary ring-2 ring-primary/20",
                        dragging &&
                          "border-dashed bg-muted opacity-60"
                      )}
                      data-kanban-card={id}
                      key={id}
                      onKeyDown={(event) => moveWithKeyboard(event, id)}
                      onPointerDown={(event) => {
                        if (event.pointerType === "mouse") {
                          startPointerDrag(event, id)
                        }
                      }}
                      role={movable ? "button" : undefined}
                      tabIndex={movable ? 0 : undefined}
                    >
                      {movable ? (
                        <GripVertical
                          aria-hidden
                          className="float-right h-4 w-4 text-muted-foreground/45"
                        />
                      ) : null}
                      <div className={cn(movable && "pr-5")}>
                        {renderCard(item)}
                      </div>
                    </div>
                  )
                })}
                {ids.length > visibleIds.length ? (
                  <button
                    className="w-full rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
                    onClick={() =>
                      setShown((current) => ({
                        ...current,
                        [column.id]: (current[column.id] ?? PAGE) + PAGE,
                      }))
                    }
                    type="button"
                  >
                    Ещё {ids.length - visibleIds.length}
                  </button>
                ) : null}
                {ids.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    {emptyText}
                  </p>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 z-50 truncate rounded-[var(--rb-r-lg)] border border-primary/30 bg-card px-3 py-2 text-sm font-semibold shadow-2xl"
        hidden
        ref={ghostRef}
      />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
