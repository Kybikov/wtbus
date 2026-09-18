import { cookies } from "next/headers"

import {
  defaultLayoutPreferences,
  layoutCookieName,
  parseLayoutCookie,
  parseLayoutPreferences,
  type LayoutSnapshot,
} from "@/lib/layout-preferences"

export async function getInitialLayoutSnapshot(): Promise<LayoutSnapshot & { authenticated: boolean }> {
  const store = await cookies()
  const session = store.get("vivat_session")?.value
  const cached = parseLayoutCookie(store.get(layoutCookieName)?.value)
  if (session && cached) return { ...cached, authenticated: true }

  let preferences = defaultLayoutPreferences
  if (session) {
    try {
      const response = await fetch(
        `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/v1/me/preferences`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session}`, Accept: "application/json" },
          signal: AbortSignal.timeout(3_000),
        }
      )
      if (response.ok) {
        preferences = parseLayoutPreferences(await response.json()) ?? preferences
      }
    } catch {
      // Preference availability must not prevent the application from rendering.
    }
  }
  const legacyOpen = store.get("sidebar_state")?.value
  return {
    preferences,
    authenticated: Boolean(session),
    override:
      session && (legacyOpen === "true" || legacyOpen === "false")
        ? { mode: preferences.sidebarMode, open: legacyOpen === "true" }
        : null,
  }
}
