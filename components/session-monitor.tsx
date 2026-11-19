"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { sessionFetch } from "@/lib/session-navigation"
import { isPublicBookingPath } from "@/lib/public-booking"

export function SessionMonitor() {
  const pathname = usePathname()
  const publicPage =
    pathname === "/login" ||
    pathname.startsWith("/offline") ||
    isPublicBookingPath(pathname)
  useEffect(() => {
    if (publicPage) return
    const controller = new AbortController()
    let pending = false
    async function check() {
      if (
        pending ||
        document.visibilityState !== "visible" ||
        !navigator.onLine
      )
        return
      pending = true
      try {
        const response = await sessionFetch("/api/auth/me", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10_000),
          ]),
        })
        if (response.ok && !controller.signal.aborted) {
          const identity = await response.json()
          if (typeof identity.workspaceReadOnly === "boolean")
            window.dispatchEvent(
              new CustomEvent("vivat:workspace-read-only", {
                detail: identity.workspaceReadOnly,
              })
            )
        }
      } catch {
        // Losing connectivity does not end a session. Check again on reconnect.
      } finally {
        pending = false
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 60_000)
    document.addEventListener("visibilitychange", check)
    window.addEventListener("online", check)
    const reloadWorkspace = (event: StorageEvent) => {
      if (event.key === "vivat:workspace-change") window.location.replace("/")
    }
    window.addEventListener("storage", reloadWorkspace)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", check)
      window.removeEventListener("online", check)
      window.removeEventListener("storage", reloadWorkspace)
    }
  }, [publicPage])
  return null
}
