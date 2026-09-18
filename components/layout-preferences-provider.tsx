"use client"

import * as React from "react"

import {
  layoutCookieName,
  parseLayoutPreferences,
  serializeLayoutCookie,
  type LayoutSnapshot,
  type SidebarOverride,
} from "@/lib/layout-preferences"

type LayoutContext = LayoutSnapshot & {
  setSidebarOverride: (override: SidebarOverride) => void
}

const context = React.createContext<LayoutContext | null>(null)

function saveLayout(snapshot: LayoutSnapshot) {
  document.cookie = `${layoutCookieName}=${serializeLayoutCookie(snapshot)}; path=/; max-age=2592000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`
}

export function LayoutPreferencesProvider({
  initial,
  persist,
  children,
}: {
  initial: LayoutSnapshot
  persist: boolean
  children: React.ReactNode
}) {
  const [preferences, setPreferences] = React.useState(initial.preferences)
  const [override, setOverride] = React.useState(initial.override)

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = parseLayoutPreferences(document.documentElement.dataset)
      if (next) setPreferences(next)
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-sidebar-mode", "data-sidebar-variant", "data-scale",
        "data-radius", "data-density",
      ],
    })
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (persist) saveLayout({ preferences, override })
  }, [override, persist, preferences])

  const setSidebarOverride = React.useCallback((next: SidebarOverride) => {
    if (persist) saveLayout({ preferences, override: next })
    setOverride(next)
  }, [persist, preferences])

  return (
    <context.Provider value={{ preferences, override, setSidebarOverride }}>
      {children}
    </context.Provider>
  )
}

export function useLayoutPreferences() {
  const value = React.useContext(context)
  if (!value) throw new Error("LayoutPreferencesProvider is required")
  return value
}
