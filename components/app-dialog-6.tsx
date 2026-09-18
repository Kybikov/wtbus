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
      className="grid min-w-0 gap-3 lg:grid-cols-2"
    >
      <Card className="workspace-panel min-w-0 shadow-none lg:col-span-2">
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <Database aria-hidden className="size-4 text-muted-foreground" />
              Данные записи
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">{overview}</CardContent>
      </Card>
      <Card className="workspace-panel min-w-0 shadow-none">
        <CardHeader>
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
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <History aria-hidden className="size-4 text-muted-foreground" />
              История действий
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">{activity}</CardContent>
      </Card>
    </motion.section>
  )
}
