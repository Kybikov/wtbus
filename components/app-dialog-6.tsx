"use client"
// Adapted from React Bits Pro app-dialog-6: metadata, related records and history.
// A full page uses shadcn cards/tabs instead of the demo's modal and focus trap.
import type { ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
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
      className="min-w-0"
    >
      <Tabs defaultValue="overview" className="min-w-0 gap-3">
        <TabsList className="workspace-panel w-full justify-start gap-1 p-2 group-data-horizontal/tabs:h-auto max-sm:flex-wrap">
          <TabsTrigger className="h-9 flex-none px-3" value="overview">
            Обзор
          </TabsTrigger>
          <TabsTrigger className="h-9 flex-none px-3" value="related">
            Связанные записи
          </TabsTrigger>
          <TabsTrigger className="h-9 flex-none px-3" value="activity">
            История действий
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Card className="workspace-panel shadow-none">
            <CardHeader>
              <CardTitle>
                <h2>Данные записи</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>{overview}</CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="related">
          <Card className="workspace-panel shadow-none">
            <CardHeader>
              <CardTitle>
                <h2>Связанные записи</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>{related}</CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="activity">
          <Card className="workspace-panel shadow-none">
            <CardHeader>
              <CardTitle>
                <h2>История действий</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>{activity}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.section>
  )
}
