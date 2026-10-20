"use client"

// Adapted from the licensed React Bits Pro List 4 source supplied for this task.
// Controlled items, measured row heights and Russian keyboard announcements.
import * as React from "react"
import { GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"

type Drag<T> = {
  id: string
  from: number
  dy: number
  height: number
  center: number
  centers: number[]
  previous: T[]
}

export function ReorderableList<T>({
  items,
  getId,
  getLabel,
  onReorder,
  children,
  disabled = false,
  className,
}: {
  items: T[]
  getId: (item: T) => string
  getLabel: (item: T) => string
  onReorder: (items: T[]) => void
  children: (item: T, handle: React.ReactNode, index: number) => React.ReactNode
  disabled?: boolean
  className?: string
}) {
  const [drag, setDrag] = React.useState<Drag<T> | null>(null)
  const [keyboard, setKeyboard] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState("")
  const [settling, setSettling] = React.useState(false)
  const start = React.useRef(0)
  const snapshot = React.useRef<T[]>([])
  const list = React.useRef<HTMLUListElement>(null)
  const target = drag
    ? drag.centers.reduce(
        (best, center, index) =>
          Math.abs(center - drag.center - drag.dy) <
          Math.abs(drag.centers[best] - drag.center - drag.dy)
            ? index
            : best,
        drag.from
      )
    : -1
  const reorder = (source: T[], from: number, to: number) => {
    const next = [...source]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  }
  const focus = (id: string) =>
    requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLElement>(`[data-list4-handle="${CSS.escape(id)}"]`)
        ?.focus()
    )
  React.useEffect(() => {
    if (!settling) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettling(false))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [settling])
  const finish = (
    event: React.PointerEvent<HTMLUListElement>,
    cancel = false
  ) => {
    if (!drag) return
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancel && target !== drag.from) {
      onReorder(reorder(drag.previous, drag.from, target))
      setSettling(true)
      setMessage(`Позиция ${target + 1} из ${items.length}.`)
    } else if (cancel) setMessage("Перемещение отменено.")
    focus(drag.id)
    setDrag(null)
  }
  return (
    <>
      <ul
        ref={list}
        className={cn("min-w-0 space-y-1", drag && "select-none", className)}
        style={{ touchAction: "pan-y" }}
        onPointerDown={(event) => {
          if (
            disabled ||
            event.button !== 0 ||
            !(event.target as HTMLElement).closest("[data-list4-handle]")
          )
            return
          const id = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-list4-row]"
          )?.dataset.list4Row
          const from = items.findIndex((item) => getId(item) === id)
          if (!id || from < 0) return
          const rows = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "[data-list4-row]"
            ),
          ].map((row) => row.getBoundingClientRect())
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          start.current = event.clientY
          setKeyboard(null)
          setSettling(false)
          setDrag({
            id,
            from,
            dy: 0,
            height: rows[from].height + 4,
            center: rows[from].top + rows[from].height / 2,
            centers: rows.map((row) => row.top + row.height / 2),
            previous: [...items],
          })
        }}
        onPointerMove={(event) =>
          setDrag((current) =>
            current ? { ...current, dy: event.clientY - start.current } : null
          )
        }
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && drag) {
            event.preventDefault()
            setDrag(null)
            setMessage("Перемещение отменено.")
          }
        }}
      >
        {items.map((item, index) => {
          const id = getId(item),
            dragging = drag?.id === id,
            grabbed = keyboard === id
          let shift = 0
          if (drag && !dragging) {
            if (drag.from < target && index > drag.from && index <= target)
              shift = -drag.height
            else if (target < drag.from && index >= target && index < drag.from)
              shift = drag.height
          }
          const handle = (
            <button
              type="button"
              disabled={disabled}
              data-disabled-reason={
                "Выберите порядок «Вручную», чтобы перетаскивать элементы."
              }
              data-list4-handle={id}
              aria-label={`Переместить: ${getLabel(item)}. Позиция ${index + 1} из ${items.length}`}
              aria-pressed={grabbed}
              title={
                disabled
                  ? undefined
                  : "Перетащите. С клавиатуры: пробел, стрелки, Escape."
              }
              className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-muted-foreground hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
              onKeyDown={(event) => {
                if (grabbed || event.key === " " || event.key === "Enter")
                  event.stopPropagation()
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault()
                  if (grabbed) {
                    setKeyboard(null)
                    setMessage(`Позиция ${index + 1} из ${items.length}.`)
                  } else {
                    snapshot.current = [...items]
                    setKeyboard(id)
                    setMessage(
                      "Используйте стрелки. Пробел — подтвердить, Escape — отменить."
                    )
                  }
                } else if (
                  grabbed &&
                  (event.key === "ArrowUp" || event.key === "ArrowDown")
                ) {
                  event.preventDefault()
                  const to = Math.max(
                    0,
                    Math.min(
                      items.length - 1,
                      index + (event.key === "ArrowUp" ? -1 : 1)
                    )
                  )
                  if (to !== index) {
                    onReorder(reorder(items, index, to))
                    focus(id)
                    setMessage(`Позиция ${to + 1} из ${items.length}.`)
                  }
                } else if (grabbed && event.key === "Escape") {
                  event.preventDefault()
                  onReorder(snapshot.current)
                  setKeyboard(null)
                  focus(id)
                  setMessage("Перемещение отменено.")
                }
              }}
            >
              <GripVertical aria-hidden className="size-4" />
            </button>
          )
          return (
            <li
              key={id}
              data-list4-row={id}
              style={{
                transform: `translateY(${dragging ? drag.dy : shift}px)`,
                zIndex: dragging || grabbed ? 10 : undefined,
              }}
              className={cn(
                "relative min-w-0 rounded-lg",
                !settling &&
                  !dragging &&
                  "transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
                (dragging || grabbed) &&
                  "bg-popover shadow-lg ring-1 ring-border"
              )}
            >
              {children(item, handle, index)}
            </li>
          )
        })}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
    </>
  )
}
