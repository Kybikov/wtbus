"use client"

import * as React from "react"
import { GripVertical } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

// Adapted from React Bits Pro App UI / Kanban 3 for Vivat's domain data.
export type ReactBitsKanbanColumn = { id: string; label: string }

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

const spring = { type: "spring" as const, bounce: 0, duration: 0.34 }

export default function ReactBitsKanban<T>({
  items,
  columns,
  getId,
  getGroup,
  getLabel,
  renderCard,
  renderGhost,
  canMove = () => true,
  canMoveTo = () => true,
  onMove,
  emptyText = "Здесь пока ничего нет",
}: Props<T>) {
  const uid = React.useId()
  const reduceMotion = useReducedMotion()
  const itemById = React.useMemo(
    () => new Map(items.map((item) => [getId(item), item])),
    [getId, items]
  )
  const itemIds = React.useMemo(() => items.map(getId), [getId, items])
  const [order, setOrder] = React.useState(() => itemIds)
  const [groups, setGroups] = React.useState<Record<string, string>>({})
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [grabbedId, setGrabbedId] = React.useState<string | null>(null)
  const [ghost, setGhost] = React.useState({ x: 0, y: 0, width: 0 })
  const [announcement, setAnnouncement] = React.useState("")
  const rootRef = React.useRef<HTMLDivElement>(null)
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
  const keyboardOrigin = React.useRef<string | null>(null)

  const effectiveOrder = React.useMemo(
    () => [
      ...order.filter((id) => itemById.has(id)),
      ...itemIds.filter((id) => !order.includes(id)),
    ],
    [itemById, itemIds, order]
  )

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
      if (!item || !canMoveTo(item, group)) return
      setGroups((current) => ({ ...current, [id]: group }))
      setOrder((current) => {
        const base = [
          ...current.filter((candidate) => itemById.has(candidate)),
          ...itemIds.filter((candidate) => !current.includes(candidate)),
        ]
        const without = base.filter((candidate) => candidate !== id)
        const members = without.filter(
          (candidate) => currentGroup(candidate) === group
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
    },
    [canMoveTo, currentGroup, itemById, itemIds]
  )

  const commitMove = React.useCallback(
    async (id: string, origin: string) => {
      const item = itemById.get(id)
      const target = currentGroup(id)
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

  const targetFromPoint = React.useCallback(
    (clientX: number, clientY: number, id: string) => {
      for (const [group, element] of columnRefs.current) {
        const bounds = element.getBoundingClientRect()
        if (clientX < bounds.left || clientX > bounds.right) continue
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
    },
    []
  )

  const startPointerDrag = (
    event: React.PointerEvent<HTMLElement>,
    id: string
  ) => {
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
    if (!drag || !root) return
    if (!drag.active) {
      if (
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4
      )
        return
      drag.active = true
      setDragId(drag.id)
    }
    const rootBounds = root.getBoundingClientRect()
    setGhost({
      x: event.clientX - rootBounds.left - drag.dx,
      y: event.clientY - rootBounds.top - drag.dy,
      width: drag.width,
    })
    const target = targetFromPoint(event.clientX, event.clientY, drag.id)
    if (target) place(drag.id, target.group, target.index)
  }

  const endPointerDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    const root = rootRef.current
    if (root?.hasPointerCapture(drag.pointerId)) {
      root.releasePointerCapture(drag.pointerId)
    }
    if (drag.active) void commitMove(drag.id, drag.origin)
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
    const columnIndex = visibleColumns.findIndex((column) => column.id === group)

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
      const target = visibleColumns[columnIndex - 1].id
      place(id, target, (cardsByColumn.get(target) ?? []).length)
    } else if (
      event.key === "ArrowRight" &&
      columnIndex < visibleColumns.length - 1
    ) {
      const target = visibleColumns[columnIndex + 1].id
      place(id, target, (cardsByColumn.get(target) ?? []).length)
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
      <div className="flex min-w-max gap-3 overflow-x-auto pb-2">
        {visibleColumns.map((column) => {
          const ids = cardsByColumn.get(column.id) ?? []
          return (
            <section
              aria-label={column.label}
              className="flex min-h-[26rem] w-[19rem] shrink-0 flex-col rounded-[var(--rb-r-2xl)] border border-border bg-muted/35 p-1.5"
              key={column.id}
            >
              <div className="flex h-10 shrink-0 items-center gap-2 px-2">
                <span className="truncate text-sm font-semibold">
                  {column.label}
                </span>
                <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {ids.length}
                </span>
              </div>
              <div
                className="min-h-0 flex-1 space-y-2 overflow-y-auto p-1 pt-0"
                ref={(element) => {
                  if (element) columnRefs.current.set(column.id, element)
                  else columnRefs.current.delete(column.id)
                }}
              >
                {ids.map((id) => {
                  const item = itemById.get(id)
                  if (!item) return null
                  const movable = Boolean(onMove && canMove(item))
                  const dragging = dragId === id
                  const grabbed = grabbedId === id
                  return (
                    <motion.div
                      className={cn(
                        "rounded-[var(--rb-r-lg)]",
                        dragging && "border border-dashed border-border bg-muted"
                      )}
                      data-kanban-card={id}
                      key={id}
                      layoutId={reduceMotion ? undefined : `${uid}-${id}`}
                      transition={reduceMotion ? { duration: 0 } : spring}
                    >
                      <div
                        aria-label={`${getLabel(item)}. ${column.label}.`}
                        aria-roledescription={
                          movable ? "Перемещаемая карточка" : undefined
                        }
                        className={cn(
                          "group relative rounded-[var(--rb-r-lg)] border border-border bg-card p-3 text-left shadow-sm transition-[border-color,box-shadow,opacity] duration-150",
                          movable &&
                            "cursor-grab hover:border-primary/35 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary",
                          grabbed && "border-primary ring-2 ring-primary/20",
                          dragging && "invisible"
                        )}
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
                            className="absolute top-3 right-2 h-4 w-4 text-muted-foreground/45 transition-colors group-hover:text-muted-foreground"
                          />
                        ) : null}
                        <div className={cn(movable && "pr-5")}>
                          {renderCard(item)}
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
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

      <AnimatePresence>
        {dragId && itemById.get(dragId) ? (
          <motion.div
            animate={
              reduceMotion
                ? { opacity: 1 }
                : { opacity: 1, rotate: -1.2, scale: 1.02 }
            }
            className="pointer-events-none absolute z-50 rounded-[var(--rb-r-lg)] border border-primary/30 bg-card p-3 shadow-2xl"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0.9 }}
            key="kanban-ghost"
            style={{ left: ghost.x, top: ghost.y, width: ghost.width }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
          >
            {renderGhost?.(itemById.get(dragId)!) ??
              renderCard(itemById.get(dragId)!)}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
