import { OperationsDashboard } from "@/components/operations-dashboard"
import { redirect } from "next/navigation"
import { getSessionRole } from "@/lib/server-role"
import { appHome } from "@/lib/app-entry"

export default async function Page() {
  const role = await getSessionRole()
  if (role && appHome(role) !== "/") redirect(appHome(role))
  return <OperationsDashboard />
}
