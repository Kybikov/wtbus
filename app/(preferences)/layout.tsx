import { getSessionAccess } from "@/lib/server-role"
import { SettingsFrame } from "@/components/settings-frame"

export default async function PreferencesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const access = await getSessionAccess()
  return (
    <SettingsFrame role={access?.role} platformAdmin={access?.platformAdmin}>
      {children}
    </SettingsFrame>
  )
}
