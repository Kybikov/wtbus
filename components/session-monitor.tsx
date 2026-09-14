"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { sessionFetch } from "@/lib/session-navigation"

export function SessionMonitor() {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/offline")) return
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
        await sessionFetch("/api/auth/me", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10_000),
          ]),
        })
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
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", check)
      window.removeEventListener("online", check)
    }
  }, [pathname])
  return null
}
