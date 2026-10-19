import { getSessionRole } from "@/lib/server-role"
import { SettingsFrame } from "@/components/settings-frame"

export default async function PreferencesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const role = await getSessionRole()
  return <SettingsFrame role={role ?? undefined}>{children}</SettingsFrame>
}
