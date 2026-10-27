import { Suspense } from "react"
import { StatisticsWorkspace } from "@/components/statistics-workspace"
import { redirect } from "next/navigation"
import { getSessionRole } from "@/lib/server-role"
export default async function Page() {
  const role = await getSessionRole()
  if (role === "driver") redirect("/driver")
  return (
    <Suspense fallback={<p className="p-6">Загружаем статистику…</p>}>
      <StatisticsWorkspace role={role} />
    </Suspense>
  )
}
