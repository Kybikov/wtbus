"use client"
// Adapted from React Bits Pro Stats 1 (licensed registry source).
import { motion, useReducedMotion } from "motion/react"
export default function Stats1({
  items,
  format,
}: {
  items: { label: string; value: number; color: string }[]
  format: (value: number) => string
}) {
  const reduced = useReducedMotion()
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0)
  if (!items.length || items.every((item) => item.value === 0))
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        За этот период поступлений нет
      </p>
    )
  return (
    <div className="space-y-5">
      <div className="flex h-4 overflow-hidden rounded-full" aria-hidden="true">
        {items
          .filter((item) => item.value > 0)
          .map((item) => (
            <motion.div
              key={item.label}
              initial={false}
              animate={{ flexGrow: item.value }}
              transition={{ duration: reduced ? 0 : 0.5 }}
              className="min-w-0 basis-0"
              style={{ backgroundColor: item.color }}
            />
          ))}
      </div>
      <div className="divide-y divide-border/60">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm"
          >
            <span className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </span>
            <span className="ml-auto flex gap-3 tabular-nums">
              <strong>{format(item.value)}</strong>
              <span className="w-12 text-right text-muted-foreground">
                {total > 0
                  ? `${Math.round((Math.max(0, item.value) / total) * 100)}%`
                  : "—"}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
