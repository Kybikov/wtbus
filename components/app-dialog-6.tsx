"use client"
// Adapted from React Bits Pro app-dialog-6: one compact panel with section tabs.
import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="mx-auto w-full max-w-5xl min-w-0"
    >
      <Tabs defaultValue="details" className="gap-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <TabsList
            aria-label="Разделы записи"
            className="h-11! min-w-0 flex-1 sm:w-auto sm:flex-none"
          >
            <TabsTrigger
              value="details"
              className="px-2 text-xs sm:px-3 sm:text-sm"
            >
              <Database className="hidden sm:block" />
              Детали
            </TabsTrigger>
            <TabsTrigger
              value="related"
              className="px-2 text-xs sm:px-3 sm:text-sm"
            >
              <Link2 className="hidden sm:block" />
              Связи
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="px-2 text-xs sm:px-3 sm:text-sm"
            >
              <History className="hidden sm:block" />
              Активность
            </TabsTrigger>
          </TabsList>
          {overviewMeta}
        </div>
        <TabsContent value="details" keepMounted>
          <Card className="workspace-panel gap-0 py-0 shadow-none">
            <CardContent className="min-w-0 p-3 sm:p-4">{overview}</CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="related" keepMounted>
          <Card className="workspace-panel min-w-0 gap-3 py-3 shadow-none">
            {related}
          </Card>
        </TabsContent>
        <TabsContent value="history" keepMounted>
          <Card className="workspace-panel py-0 shadow-none">
            <CardContent className="min-w-0 p-3 sm:p-4">{activity}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.section>
  )
}
