"use client"
// Adapted from React Bits Pro app-dialog-6: metadata, related records and history.
// All sections stay visible; shadcn cards replace the demo's modal and tabs.
import type { ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Database, History, Link2 } from "lucide-react"
export default function EntityDetailContent({
  overview,
  related,
  activity,
}: {
  overview: ReactNode
  related: ReactNode
  activity: ReactNode
}) {
  const reduced = useReducedMotion()
  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="grid min-h-[calc(100dvh-5.5rem)] min-w-0 items-stretch gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]"
    >
      <Card className="workspace-panel min-w-0 shadow-none">
        <CardHeader className="border-b border-border/70">
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <Database aria-hidden className="size-4 text-muted-foreground" />
              Данные записи
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">{overview}</CardContent>
      </Card>
      <div className="grid min-w-0 gap-3 lg:grid-rows-[minmax(18rem,auto)_minmax(14rem,1fr)]">
        <Card className="workspace-panel min-w-0 shadow-none">
          <CardHeader className="border-b border-border/70">
            <CardTitle>
              <h2 className="flex items-center gap-2">
                <Link2 aria-hidden className="size-4 text-muted-foreground" />
                Связанные записи
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">{related}</CardContent>
        </Card>
        <Card className="workspace-panel min-w-0 shadow-none">
          <CardHeader className="border-b border-border/70">
            <CardTitle>
              <h2 className="flex items-center gap-2">
                <History aria-hidden className="size-4 text-muted-foreground" />
                История действий
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">{activity}</CardContent>
        </Card>
      </div>
    </motion.section>
  )
}
