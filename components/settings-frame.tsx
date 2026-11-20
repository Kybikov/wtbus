"use client"
import { createContext, useContext } from "react"
import { usePathname } from "next/navigation"
import { AppShell } from "@/components/app-shell"
import { SettingsWorkspace } from "@/components/settings-workspace"

const SettingsRole = createContext<string | undefined>(undefined)
export function useSettingsRole() {
  return useContext(SettingsRole)
}

export function SettingsFrame({
  role,
  children,
}: {
  role?: string
  children: React.ReactNode
}) {
  const path = usePathname()
  return (
    <AppShell
      pageTitle={
        path.startsWith("/settings") ? "Настройки компании" : "Личные настройки"
      }
      onRefresh={() => {
        window.dispatchEvent(new Event("vivat-settings-refresh"))
      }}
    >
      <SettingsRole.Provider value={role}>
        <SettingsWorkspace role={role} active={path}>
          {children}
        </SettingsWorkspace>
      </SettingsRole.Provider>
    </AppShell>
  )
}
