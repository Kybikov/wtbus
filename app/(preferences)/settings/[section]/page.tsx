import { getSessionRole } from "@/lib/server-role"
import { redirect } from "next/navigation"
import { notFound } from "next/navigation"
import {
  CompanySettings,
  type CompanySettingsSection,
} from "@/components/company-settings"
export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>
}) {
  const { section } = await params
  if (
    ![
      "company",
      "payments",
      "finance",
      "fields",
      "integrations",
      "activity",
    ].includes(section)
  )
    notFound()
  const role = await getSessionRole()
  if (!role || !["owner", "admin", "developer"].includes(role))
    redirect("/profile")
  if (
    ["payments", "integrations", "finance"].includes(section) &&
    role === "admin"
  )
    redirect("/settings/company")
  return <CompanySettings section={section as CompanySettingsSection} />
}
