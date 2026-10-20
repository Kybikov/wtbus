"use client"
import { useLayoutEffect } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
// One draggable registration per header. CSS variables move every matching cell
// without registering each body cell as another drop target or rendering each row.
export function SortableColumn({
  id,
  index,
  children,
}: {
  id: string
  index: number
  children: (state: ReturnType<typeof useSortable>) => React.ReactNode
}) {
  const state = useSortable({ id })
  const { transform, isDragging, node } = state
  useLayoutEffect(() => {
    const table = node.current?.closest("table")
    if (!table) return
    table.style.setProperty(`--column-shift-${index}`, `${transform?.x ?? 0}px`)
    if (isDragging) table.style.setProperty(`--column-layer-${index}`, "10")
    else table.style.removeProperty(`--column-layer-${index}`)
    table.style.setProperty(
      `--column-duration-${index}`,
      isDragging ? "0ms" : "180ms"
    )
    return () => {
      table.style.removeProperty(`--column-shift-${index}`)
      table.style.removeProperty(`--column-layer-${index}`)
      table.style.removeProperty(`--column-duration-${index}`)
    }
  }, [transform?.x, isDragging, index, node])
  return children({
    ...state,
    transform: transform ? { ...transform, y: 0 } : null,
  })
}
export function columnMotion(
  index: number,
  pinned = false
): React.CSSProperties {
  return {
    transform: `translateX(var(--column-shift-${index},0px))`,
    transition: `transform var(--column-duration-${index},180ms) cubic-bezier(.2,.8,.2,1)`,
    zIndex: `var(--column-layer-${index},${pinned ? 3 : 1})`,
  }
}
export { CSS }
