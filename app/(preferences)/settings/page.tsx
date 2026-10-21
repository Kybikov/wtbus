import { getSessionRole } from "@/lib/server-role"
import { redirect } from "next/navigation"
export default async function SettingsPage() {
  const role = await getSessionRole()
  redirect(role === "accountant" ? "/settings/accounting" : "/settings/company")
}
