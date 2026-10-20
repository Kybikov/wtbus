"use client"

// Adapted from the live React Bits Pro kanban-3 source (motion layout +
// pointer/keyboard board), retaining our tenant workflows and shared controls.
import * as React from "react"
import { createPortal } from "react-dom"
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "motion/react"
import { ArrowDownAZ, EyeOff, LoaderCircle, Settings2 } from "lucide-react"
import { toast } from "sonner"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
} from "@/components/ui/context-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { statusToneClass } from "@/lib/entity-columns"
import {
  kanbanScrollSpeed,
  mergeCardOrder,
  placeKanbanCard,
  restoreKanbanCard,
} from "@/lib/kanban"

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
  canMove?: (item: T) => boolean
  canMoveTo?: (item: T, group: string) => boolean
  onMove?: (item: T, group: string) => boolean | void | Promise<boolean | void>
  onOrderChange?: (order: string[]) => void
  cardOrder?: string[]
  onOpen?: (item: T) => void
  onSelect?: (item: T) => void
  isSelected?: (item: T) => boolean
  onHideColumn?: (id: string) => void
  onConfigureCard?: () => void
  footerElement?: HTMLElement | null
  emptyText?: string
}
type Slot = { group: string; index: number }
type Grab = {
  id: string
  origin: string
  group: string
  previous: string[]
  order: string[]
}
type PointerDrag = {
  id: string
  origin: string
  previous: string[]
  dx: number
  dy: number
  width: number
  startX: number
  startY: number
  x: number
  y: number
  pointerId: number
  active: boolean
  openOnClick: boolean
  pointerType: string
  startedAt: number
  scrolling: boolean
  lastX: number
  lastY: number
  scrollStart: number
}
const PAGE = 40
const columnTones: Record<ReactBitsKanbanTone, string> = {
  neutral: "border-border bg-muted/55",
  info: "border-sky-500/25 bg-sky-500/[0.09]",
  warning: "border-amber-500/25 bg-amber-500/[0.09]",
  success: "border-emerald-500/25 bg-emerald-500/[0.09]",
  danger: "border-red-500/25 bg-red-500/[0.09]",
  violet: "border-violet-500/25 bg-violet-500/[0.09]",
}
const dots: Record<ReactBitsKanbanTone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-sky-500",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-red-500",
  violet: "bg-violet-500",
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
  onOrderChange,
  cardOrder,
  onOpen,
  onSelect,
  isSelected = () => false,
  onHideColumn,
  onConfigureCard,
  footerElement,
  emptyText = "Нет записей",
}: Props<T>) {
  const uid = React.useId(),
    reduce = useReducedMotion()
  const instructions = React.useId()
  const itemById = React.useMemo(
    () => new Map(items.map((item) => [getId(item), item])),
    [items, getId]
  )
  const [localOrder, setLocalOrder] = React.useState<string[]>([])
  const order = mergeCardOrder(cardOrder ?? localOrder, items.map(getId))
  const [overrides, setOverrides] = React.useState<
    Record<string, { from: string; to: string }>
  >({})
  const [pending, setPending] = React.useState<Set<string>>(() => new Set())
  const busy = React.useRef(new Set<string>())
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [touchScrolling, setTouchScrolling] = React.useState(false)
  const [grab, setGrab] = React.useState<Grab | null>(null)
  const [slot, setSlot] = React.useState<Slot | null>(null)
  const [shown, setShown] = React.useState<Record<string, number>>({})
  const [announcement, setAnnouncement] = React.useState("")
  const [availableHeight, setAvailableHeight] = React.useState<number | null>(
    null
  )
  const root = React.useRef<HTMLDivElement>(null),
    viewport = React.useRef<HTMLDivElement>(null),
    ghost = React.useRef<HTMLDivElement>(null)
  const colRefs = React.useRef(new Map<string, HTMLElement>())
  const drag = React.useRef<PointerDrag | null>(null),
    drop = React.useRef<Slot | null>(null),
    frame = React.useRef<number | null>(null)
  const skipClick = React.useRef(false)
  const lastTap = React.useRef<{ id: string; at: number } | null>(null)
  const model = React.useRef({ order, itemById, getGroup, onOrderChange })
  React.useLayoutEffect(() => {
    model.current = { order, itemById, getGroup, onOrderChange }
  }, [order, itemById, getGroup, onOrderChange])
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const groupOf = (id: string) => {
    const item = itemById.get(id),
      source = item ? getGroup(item) : ""
    return overrides[id]?.from === source ? overrides[id].to : source
  }
  const displayedGroup = (id: string) =>
    grab?.id === id ? grab.group : groupOf(id)
  const displayedOrder = grab?.order ?? order
  const groups = new Map(columns.map((column) => [column.id, [] as string[]]))
  for (const id of displayedOrder) {
    const group = displayedGroup(id)
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(id)
  }
  const visibleColumns: ReactBitsKanbanColumn[] = [
    ...columns,
    ...[...groups.keys()]
      .filter((group) => !columns.some((c) => c.id === group))
      .map((id) => ({ id, label: id })),
  ]
  React.useLayoutEffect(() => {
    const measure = () => {
      const top = viewport.current?.getBoundingClientRect().top
      if (top === undefined) return
      const footerTop = footerElement?.getBoundingClientRect().top
      const bottom = Math.min(
        window.innerHeight - 16,
        footerTop && footerTop > top ? footerTop - 12 : window.innerHeight - 16
      )
      setAvailableHeight(Math.max(120, Math.floor(bottom - top)))
    }
    const observer = new ResizeObserver(measure)
    if (root.current?.parentElement?.parentElement)
      observer.observe(root.current.parentElement.parentElement)
    if (footerElement) observer.observe(footerElement)
    const frame = requestAnimationFrame(measure)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", measure)
    }
  }, [footerElement])
  const movable = (item: T) =>
    Boolean(
      (onMove || onOrderChange) && canMove(item) && !pending.has(getId(item))
    )
  const allowed = (item: T, group: string) =>
    group === groupOf(getId(item)) || Boolean(onMove && canMoveTo(item, group))
  const remember = (next: string[]) => {
    setLocalOrder(next)
    onOrderChange?.(next)
  }
  const focusHandle = (id: string) =>
    requestAnimationFrame(() => {
      const handle = root.current?.querySelector<HTMLElement>(
        `[data-kanban-handle="${CSS.escape(id)}"]`
      )
      handle?.focus({ preventScroll: true })
      handle?.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
  async function commit(
    id: string,
    origin: string,
    target: string,
    next: string[],
    previous: string[],
    restoreFocus = false
  ) {
    const item = itemById.get(id)
    if (!item || busy.current.has(id) || !allowed(item, target)) return
    remember(next)
    if (target === origin) {
      setAnnouncement(`${getLabel(item)}: порядок изменён.`)
      if (restoreFocus) focusHandle(id)
      return
    }
    busy.current.add(id)
    setPending((current) => new Set(current).add(id))
    setOverrides((current) => ({
      ...current,
      [id]: { from: getGroup(item), to: target },
    }))
    let accepted = false
    try {
      accepted = (await onMove?.(item, target)) !== false
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось изменить статус."
      )
    } finally {
      if (!accepted) {
        const current = model.current
        const restored = restoreKanbanCard(
          mergeCardOrder(current.order, [...current.itemById.keys()]),
          id,
          previous
        )
        setLocalOrder(restored)
        current.onOrderChange?.(restored)
      }
      setOverrides((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      busy.current.delete(id)
      setPending((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
      setAnnouncement(
        accepted
          ? `${getLabel(item)} перемещён: ${visibleColumns.find((c) => c.id === target)?.label ?? target}.`
          : `${getLabel(item)} возвращён в исходную колонку.`
      )
      if (restoreFocus) focusHandle(id)
    }
  }
  const paint = (group: string | null, valid = true) => {
    for (const [id, element] of colRefs.current)
      element.dataset.drop =
        id === group ? (valid ? "allowed" : "blocked") : "none"
  }
  function targetAt(x: number, y: number, id: string): Slot | null {
    const viewportBounds = viewport.current?.getBoundingClientRect()
    if (
      !viewportBounds ||
      x < viewportBounds.left ||
      x > viewportBounds.right ||
      y < viewportBounds.top ||
      y > viewportBounds.bottom
    )
      return null
    for (const [group, element] of colRefs.current) {
      const rect = element.getBoundingClientRect()
      if (x < rect.left || x > rect.right) continue
      const cards = [
        ...element.querySelectorAll<HTMLElement>("[data-kanban-card]"),
      ].filter((card) => card.dataset.kanbanCard !== id)
      const index = cards.findIndex((card) => {
        const r = card.getBoundingClientRect()
        return y < r.top + r.height / 2
      })
      return { group, index: index < 0 ? cards.length : index }
    }
    return null
  }
  function updateDrop(d: PointerDrag) {
    const target = targetAt(d.x, d.y, d.id),
      item = itemById.get(d.id)
    const valid = !!target && !!item && allowed(item, target.group)
    paint(target?.group ?? null, valid)
    drop.current = valid ? target : null
    setSlot((current) =>
      valid && target
        ? current?.group === target.group && current.index === target.index
          ? current
          : target
        : current === null
          ? current
          : null
    )
  }
  function tick() {
    const d = drag.current
    if (!d?.active) return
    if (ghost.current) {
      ghost.current.style.width = `${d.width}px`
      ghost.current.style.transform = `translate3d(${d.x - d.dx}px,${d.y - d.dy}px,0)`
    }
    const rail = viewport.current
    if (rail) {
      const r = rail.getBoundingClientRect()
      rail.scrollLeft += kanbanScrollSpeed(d.x, r.left, r.right)
    }
    const target = targetAt(d.x, d.y, d.id)
    const body =
      target &&
      colRefs.current
        .get(target.group)
        ?.querySelector<HTMLElement>("[data-kanban-body]")
    if (body) {
      const r = body.getBoundingClientRect()
      body.scrollTop += kanbanScrollSpeed(d.y, r.top, r.bottom)
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 30) {
        const count = groups.get(target!.group)?.length ?? 0
        setShown((current) => {
          const limit = current[target!.group] ?? PAGE
          return limit < count
            ? { ...current, [target!.group]: Math.min(count, limit + PAGE) }
            : current
        })
      }
    }
    updateDrop(d)
    frame.current = requestAnimationFrame(tick)
  }
  function begin(
    event: React.PointerEvent<HTMLElement>,
    id: string,
    handle = false
  ) {
    if (event.button !== 0 || drag.current || grab || busy.current.has(id))
      return
    if (
      !handle &&
      (event.target as HTMLElement).closest(
        "button,input,textarea,select,a,[role=checkbox],[data-no-drag]"
      )
    )
      return
    const item = itemById.get(id),
      card = event.currentTarget.closest<HTMLElement>("[data-kanban-card]")
    if (!item || !movable(item) || !card) return
    event.preventDefault()
    event.stopPropagation()
    const rect = card.getBoundingClientRect()
    drag.current = {
      id,
      origin: groupOf(id),
      previous: [...order],
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      width: rect.width,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      active: false,
      openOnClick: !handle,
      pointerType: event.pointerType,
      startedAt: event.timeStamp,
      scrolling: false,
      lastX: event.clientX,
      lastY: event.clientY,
      scrollStart: viewport.current?.scrollLeft ?? 0,
    }
    root.current?.setPointerCapture(event.pointerId)
    card.focus({ preventScroll: true })
  }
  function move(event: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    d.x = event.clientX
    d.y = event.clientY
    if (document.querySelector('[data-slot="context-menu-content"][data-open]'))
      return
    const distance = Math.hypot(d.x - d.startX, d.y - d.startY)
    if (
      d.pointerType !== "mouse" &&
      !d.active &&
      (d.scrolling || (distance >= 5 && event.timeStamp - d.startedAt < 250))
    ) {
      d.scrolling = true
      setTouchScrolling(true)
      if (Math.abs(d.x - d.startX) > Math.abs(d.y - d.startY)) {
        if (viewport.current) viewport.current.scrollLeft -= d.x - d.lastX
      } else {
        const body = colRefs.current
          .get(d.origin)
          ?.querySelector<HTMLElement>("[data-kanban-body]")
        const delta = d.y - d.lastY
        let scroller: HTMLElement | null | undefined = body
        while (scroller) {
          const canScroll =
            scroller.scrollHeight > scroller.clientHeight + 1 &&
            (delta > 0
              ? scroller.scrollTop > 0
              : scroller.scrollTop <
                scroller.scrollHeight - scroller.clientHeight - 1)
          if (canScroll) {
            scroller.scrollTop -= delta
            break
          }
          scroller = scroller.parentElement
        }
        if (!scroller) window.scrollBy(0, -delta)
      }
      d.lastX = d.x
      d.lastY = d.y
      return
    }
    if (!d.active && distance >= 5) {
      d.active = true
      setDragId(d.id)
      setAnnouncement("Карточка выбрана для перемещения.")
      frame.current = requestAnimationFrame(tick)
    }
  }
  function finish(cancel = false, at = 0) {
    const d = drag.current
    if (!d) return
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    if (d.active) updateDrop(d)
    const target = drop.current
    drag.current = null
    drop.current = null
    paint(null)
    if (root.current?.hasPointerCapture(d.pointerId))
      root.current.releasePointerCapture(d.pointerId)
    if (d.active || d.openOnClick) {
      skipClick.current = true
      window.setTimeout(() => {
        skipClick.current = false
      }, 0)
    }
    setDragId(null)
    setTouchScrolling(false)
    if (
      !cancel &&
      d.scrolling &&
      Math.abs(d.x - d.startX) > 50 &&
      Math.abs(d.x - d.startX) > Math.abs(d.y - d.startY)
    ) {
      const rail = viewport.current,
        width = colRefs.current.get(d.origin)?.getBoundingClientRect().width
      if (rail && width)
        rail.scrollLeft = Math.max(
          0,
          Math.min(
            rail.scrollWidth - rail.clientWidth,
            d.scrollStart + (d.x < d.startX ? 1 : -1) * (width + 12)
          )
        )
    }
    setSlot(null)
    if (
      !cancel &&
      !d.scrolling &&
      !d.active &&
      d.openOnClick &&
      !document.querySelector('[data-slot="context-menu-content"][data-open]')
    ) {
      const item = itemById.get(d.id)
      if (item) {
        const previousTap = lastTap.current
        if (previousTap?.id === d.id && at - previousTap.at < 350) {
          lastTap.current = null
          onOpen?.(item)
        } else {
          lastTap.current = { id: d.id, at }
          onSelect?.(item)
        }
      }
    } else if (!cancel && d.active && target) {
      const next = placeKanbanCard(
        order,
        d.id,
        target.group,
        target.index,
        groupOf
      )
      void commit(d.id, d.origin, target.group, next, d.previous)
    } else if (d.active) setAnnouncement("Перемещение отменено.")
  }
  React.useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    []
  )
  React.useLayoutEffect(() => {
    if (!grab) return
    const handle = root.current?.querySelector<HTMLElement>(
      `[data-kanban-handle="${CSS.escape(grab.id)}"]`
    )
    handle?.focus({ preventScroll: true })
    handle?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [grab])
  function keyboard(event: React.KeyboardEvent, id: string) {
    const item = itemById.get(id)
    if (!item || !movable(item)) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      event.stopPropagation()
      if (grab?.id === id) {
        setGrab(null)
        void commit(
          id,
          grab.origin,
          grab.group,
          grab.order,
          grab.previous,
          true
        )
      } else {
        setGrab({
          id,
          origin: groupOf(id),
          group: groupOf(id),
          previous: [...order],
          order: [...order],
        })
        setAnnouncement(
          "Используйте стрелки для перемещения. Enter — подтвердить, Escape — отменить."
        )
      }
      return
    }
    if (grab?.id !== id) return
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setGrab(null)
      setAnnouncement("Перемещение отменено.")
      focusHandle(id)
      return
    }
    const columnIndex = visibleColumns.findIndex((c) => c.id === grab.group)
    const members = grab.order.filter(
      (candidate) =>
        (candidate === id ? grab.group : groupOf(candidate)) === grab.group
    )
    const index = members.indexOf(id)
    let group = grab.group,
      position = index
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowLeft" ? -1 : 1
      let nextIndex = columnIndex + direction
      while (
        visibleColumns[nextIndex] &&
        !allowed(item, visibleColumns[nextIndex].id)
      )
        nextIndex += direction
      const column = visibleColumns[nextIndex]
      if (!column) {
        event.preventDefault()
        return
      }
      group = column.id
      position =
        groups.get(group)?.filter((candidate) => candidate !== id).length ?? 0
    } else if (event.key === "ArrowUp") position = Math.max(0, index - 1)
    else if (event.key === "ArrowDown")
      position = Math.min(members.length - 1, index + 1)
    else return
    event.preventDefault()
    event.stopPropagation()
    setGrab({
      ...grab,
      group,
      order: placeKanbanCard(grab.order, id, group, position, groupOf),
    })
    setAnnouncement(
      `${getLabel(item)}: ${visibleColumns.find((c) => c.id === group)?.label ?? group}, позиция ${position + 1}.`
    )
  }
  return (
    <div
      ref={root}
      className="relative w-full min-w-0"
      data-kanban-board
      onPointerMove={move}
      onPointerUp={(event) => finish(false, event.timeStamp)}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault()
          event.stopPropagation()
          finish(true)
        }
      }}
    >
      <p id={instructions} className="sr-only">
        Нажмите на карточку, чтобы выбрать. Дважды — открыть. Для перемещения с
        клавиатуры нажмите Alt и пробел, затем стрелки и Enter. Escape отменяет
        перемещение. На телефоне удерживайте карточку перед перетаскиванием.
      </p>
      <div
        ref={viewport}
        className={cn(
          "flex h-[clamp(22rem,calc(100dvh-16rem),64rem)] w-full items-start gap-3 overflow-x-auto overflow-y-hidden pb-2",
          !dragId && !touchScrolling && "snap-x snap-proximity"
        )}
        data-kanban-viewport
        style={
          availableHeight === null ? undefined : { height: availableHeight }
        }
      >
        <LayoutGroup id={uid}>
          {visibleColumns.map((column) => {
            const ids = groups.get(column.id) ?? [],
              tone = column.tone ?? "neutral"
            let ordered = ids
            if (dragId && slot) {
              ordered = ids.filter((id) => id !== dragId)
              if (slot.group === column.id)
                ordered = [
                  ...ordered.slice(0, slot.index),
                  dragId,
                  ...ordered.slice(slot.index),
                ]
            }
            const limit = Math.max(
              shown[column.id] ?? PAGE,
              slot?.group === column.id ? slot.index + 1 : 0
            )
            return (
              <section
                key={column.id}
                aria-label={column.label}
                data-kanban-column={column.id}
                data-drop="none"
                ref={(el) => {
                  if (el) colRefs.current.set(column.id, el)
                  else colRefs.current.delete(column.id)
                }}
                className={cn(
                  "flex h-fit max-h-full w-[min(20rem,calc(100vw-3rem))] shrink-0 snap-start flex-col overflow-hidden rounded-[var(--rb-r-xl)] border transition-[border-color,box-shadow] data-[drop=allowed]:ring-2 data-[drop=allowed]:ring-primary/40 data-[drop=blocked]:ring-2 data-[drop=blocked]:ring-destructive/40 motion-reduce:transition-none",
                  columnTones[tone]
                )}
              >
                <ContextMenu>
                  <ContextMenuTrigger
                    render={
                      <header className="flex min-h-12 shrink-0 items-center gap-2 px-3" />
                    }
                  >
                    <span className={cn("size-2 rounded-full", dots[tone])} />
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {column.label}
                    </h3>
                    <Badge
                      variant="secondary"
                      className={cn("tabular-nums", statusToneClass(tone))}
                    >
                      {ordered.length}
                    </Badge>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuGroup>
                      <ContextMenuLabel>{column.label}</ContextMenuLabel>
                      <ContextMenuItem
                        onClick={() => {
                          const sorted = [...ids].sort((a, b) =>
                            getLabel(itemById.get(a)!).localeCompare(
                              getLabel(itemById.get(b)!),
                              "ru"
                            )
                          )
                          let cursor = 0
                          remember(
                            order.map((id) =>
                              ids.includes(id) ? sorted[cursor++] : id
                            )
                          )
                        }}
                      >
                        <ArrowDownAZ />
                        Карточки по названию
                      </ContextMenuItem>
                      {onConfigureCard && (
                        <ContextMenuItem onClick={onConfigureCard}>
                          <Settings2 />
                          Настроить карточки
                        </ContextMenuItem>
                      )}
                      {onHideColumn && (
                        <ContextMenuItem
                          disabled={visibleColumns.length <= 1}
                          disabledReason={
                            "На доске должен оставаться хотя бы один видимый столбец."
                          }
                          onClick={() => onHideColumn(column.id)}
                        >
                          <EyeOff />
                          Скрыть столбец
                        </ContextMenuItem>
                      )}
                    </ContextMenuGroup>
                  </ContextMenuContent>
                </ContextMenu>
                <div
                  data-kanban-body
                  className="min-h-0 space-y-2 overflow-y-auto overscroll-contain px-2 pb-2"
                >
                  {ordered.slice(0, limit).map((id) => {
                    const item = itemById.get(id)
                    if (!item) return null
                    const enabled = movable(item),
                      dragging = dragId === id,
                      isGrabbed = grab?.id === id
                    return (
                      <motion.article
                        key={id}
                        layout={reduce ? false : "position"}
                        layoutId={reduce ? undefined : `${uid}-${id}`}
                        transition={{
                          type: "spring",
                          bounce: 0,
                          duration: 0.3,
                        }}
                        data-kanban-card={id}
                        aria-busy={pending.has(id) || undefined}
                        tabIndex={0}
                        role="button"
                        data-kanban-handle={id}
                        aria-pressed={isSelected(item)}
                        aria-describedby={instructions}
                        aria-keyshortcuts="Enter Space Alt+Space"
                        aria-label={getLabel(item)}
                        style={{ touchAction: "none" }}
                        onPointerDown={(event) => begin(event, id)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return
                          if (
                            grab?.id === id ||
                            (event.altKey && event.key === " ")
                          ) {
                            keyboard(event, id)
                            return
                          }
                          if (event.key === " ") {
                            event.preventDefault()
                            onSelect?.(item)
                          }
                          if (event.key === "Enter") {
                            event.preventDefault()
                            onOpen?.(item)
                          }
                        }}
                        onDoubleClick={() => {
                          if (!movable(item)) onOpen?.(item)
                        }}
                        onClick={(event) => {
                          if (skipClick.current) return
                          if (
                            !(event.target as HTMLElement).closest(
                              "button,a,input,textarea,select,[role=checkbox],[data-no-drag]"
                            )
                          )
                            onSelect?.(item)
                        }}
                        className={cn(
                          "relative rounded-[var(--rb-r-lg)] border border-border/80 bg-card shadow-sm transition-[border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                          enabled
                            ? "cursor-grab hover:border-primary/35 active:cursor-grabbing"
                            : "cursor-pointer hover:border-primary/35",
                          isSelected(item) &&
                            "border-primary bg-primary/10 ring-1 ring-primary/50",
                          dragging &&
                            "border-dashed border-primary/60 bg-primary/10 shadow-none",
                          isGrabbed && "ring-2 ring-primary/40"
                        )}
                      >
                        {pending.has(id) && (
                          <span
                            className="absolute top-1 right-1 z-10 rounded-full bg-card p-1"
                            aria-label="Сохраняем"
                          >
                            <LoaderCircle className="size-3 animate-spin text-primary" />
                          </span>
                        )}
                        <div
                          className={cn(
                            dragging && "pointer-events-none opacity-25"
                          )}
                        >
                          {renderCard(item)}
                        </div>
                      </motion.article>
                    )
                  })}
                  {ordered.length > limit && (
                    <Button
                      className="w-full"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setShown((current) => ({
                          ...current,
                          [column.id]: limit + PAGE,
                        }))
                      }
                    >
                      Ещё {ordered.length - limit}
                    </Button>
                  )}
                  {!ordered.length && (
                    <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-border/80 px-3 text-center text-xs text-muted-foreground">
                      {dragId ? "Перетащите карточку сюда" : emptyText}
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </LayoutGroup>
      </div>
      {mounted &&
        createPortal(
          <AnimatePresence>
            {dragId && itemById.has(dragId) && (
              <motion.div
                key="ghost"
                ref={(element) => {
                  ghost.current = element
                  const d = drag.current
                  if (element && d) {
                    element.style.width = `${d.width}px`
                    element.style.transform = `translate3d(${d.x - d.dx}px,${d.y - d.dy}px,0)`
                  }
                }}
                aria-hidden
                inert
                data-kanban-overlay
                initial={{ opacity: 0.8 }}
                animate={{ opacity: 1 }}
                exit={{
                  opacity: 0,
                  transition: { duration: reduce ? 0 : 0.12 },
                }}
                className="pointer-events-none fixed top-0 left-0 z-[80] will-change-transform"
              >
                <div
                  className={cn(
                    "overflow-hidden rounded-[var(--rb-r-lg)] border border-primary/40 bg-card shadow-2xl",
                    !reduce && "scale-[1.02] rotate-[-1.5deg]"
                  )}
                >
                  {renderCard(itemById.get(dragId)!)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </p>
    </div>
  )
}
