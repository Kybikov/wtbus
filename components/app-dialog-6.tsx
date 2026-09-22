"use client"
// Adapted from React Bits Pro app-dialog-6: metadata, related records and history.
// All sections stay visible; shadcn cards replace the demo's modal and tabs.
import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Database, History, Link2 } from "lucide-react"
export default function EntityDetailContent({
  overview,
  overviewMeta,
  related,
  activity,
}: {
  overview: React.ReactNode
  overviewMeta?: React.ReactNode
  related: React.ReactNode
  activity: React.ReactNode
}) {
  const reduced = useReducedMotion()
  const rightColumn = React.useRef<HTMLDivElement>(null)
  const [split, setSplit] = React.useState(50)

  React.useEffect(() => {
    const stored = Number(localStorage.getItem("entity-detail-right-split"))
    if (!Number.isFinite(stored) || stored < 25 || stored > 75) return
    const frame = requestAnimationFrame(() => setSplit(stored))
    return () => cancelAnimationFrame(frame)
  }, [])

  const updateSplit = React.useCallback((next: number) => {
    const value = Math.max(25, Math.min(75, Math.round(next)))
    setSplit(value)
    localStorage.setItem("entity-detail-right-split", String(value))
  }, [])

  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (!rightColumn.current) return
    event.preventDefault()
    const bounds = rightColumn.current.getBoundingClientRect()
    const move = (moveEvent: PointerEvent) =>
      updateSplit(((moveEvent.clientY - bounds.top) / bounds.height) * 100)
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop, { once: true })
  }

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="grid w-full min-w-0 items-stretch gap-3 xl:h-[calc(100dvh-5.5rem)] xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_minmax(28rem,0.72fr)] xl:overflow-hidden"
    >
      <Card className="workspace-panel min-w-0 shadow-none xl:h-full xl:min-h-0">
        <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-3 border-b border-border/70">
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <Database aria-hidden className="size-4 text-muted-foreground" />
              Данные записи
            </h2>
          </CardTitle>
          {overviewMeta}
        </CardHeader>
        <CardContent className="min-w-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          {overview}
        </CardContent>
      </Card>
      <div
        ref={rightColumn}
        className="grid min-w-0 gap-3 xl:h-full xl:min-h-0 xl:grid-rows-[minmax(0,var(--related-size))_0.75rem_minmax(0,var(--activity-size))] xl:gap-0"
        style={
          {
            "--related-size": `${split}fr`,
            "--activity-size": `${100 - split}fr`,
          } as React.CSSProperties
        }
      >
        <Card className="workspace-panel min-w-0 shadow-none xl:min-h-0">
          <CardHeader className="shrink-0 border-b border-border/70">
            <CardTitle>
              <h2 className="flex items-center gap-2">
                <Link2 aria-hidden className="size-4 text-muted-foreground" />
                Связанные записи
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            {related}
          </CardContent>
        </Card>
        <button
          aria-label="Изменить высоту связанных записей и истории действий"
          aria-orientation="horizontal"
          aria-valuemax={75}
          aria-valuemin={25}
          aria-valuenow={split}
          className="group relative hidden cursor-row-resize touch-none xl:block"
          onDoubleClick={() => updateSplit(50)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") updateSplit(split - 5)
            if (event.key === "ArrowDown") updateSplit(split + 5)
            if (event.key === "Home") updateSplit(25)
            if (event.key === "End") updateSplit(75)
          }}
          onPointerDown={startResize}
          role="separator"
          type="button"
        >
          <span className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 rounded-full bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
          <span className="absolute top-1/2 left-1/2 h-1.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card transition-colors group-hover:border-primary group-focus-visible:border-primary" />
        </button>
        <Card className="workspace-panel min-w-0 shadow-none xl:min-h-0">
          <CardHeader className="shrink-0 border-b border-border/70">
            <CardTitle>
              <h2 className="flex items-center gap-2">
                <History aria-hidden className="size-4 text-muted-foreground" />
                История действий
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            {activity}
          </CardContent>
        </Card>
      </div>
    </motion.section>
  )
}
