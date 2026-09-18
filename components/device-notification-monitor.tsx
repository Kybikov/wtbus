"use client"
import * as React from "react"
import { usePathname } from "next/navigation"
import { isPublicBookingPath } from "@/lib/public-booking"
import { parseRealtimeMessage, realtimeEvent } from "@/lib/realtime"
import { syncExistingPush } from "@/lib/web-push"

// One connection per tab. WebSocket invalidates data; only Web Push shows native alerts.
export function DeviceNotificationMonitor() {
  const pathname = usePathname()
  const publicPage =
    pathname === "/login" ||
    pathname.startsWith("/offline") ||
    isPublicBookingPath(pathname)
  React.useEffect(() => {
    if (publicPage) return
    let stopped = false
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const seen = new Set<string>()
    function connect() {
      if (
        stopped ||
        !navigator.onLine ||
        socket?.readyState === WebSocket.OPEN ||
        socket?.readyState === WebSocket.CONNECTING
      )
        return
      const connection = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/realtime`
      )
      socket = connection
      let pushSynced = false
      connection.onmessage = (event) => {
        if (typeof event.data !== "string") return
        const message = parseRealtimeMessage(event.data)
        if (!message || stopped || socket !== connection) return
        if (message.type === "ready") {
          attempts = 0
          if (!pushSynced) {
            pushSynced = true
            void syncExistingPush().catch(() => {})
          }
          seen.clear()
        }
        if (message.id) {
          if (seen.has(message.id)) return
          seen.add(message.id)
          if (seen.size > 1000) seen.delete(seen.values().next().value!)
        }
        window.dispatchEvent(
          new CustomEvent(realtimeEvent, { detail: message })
        )
      }
      connection.onclose = () => {
        if (stopped || socket !== connection) return
        clearTimeout(timer)
        timer = setTimeout(
          connect,
          Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5)) +
            Math.random() * 500
        )
      }
      connection.onerror = () => connection.close()
    }
    const online = () => {
      clearTimeout(timer)
      connect()
    }
    const visible = () => {
      if (document.visibilityState === "visible") {
        connect()
        window.dispatchEvent(
          new CustomEvent(realtimeEvent, { detail: { type: "ready" } })
        )
      }
    }
    connect()
    const fallback = setInterval(() => {
      if (
        navigator.onLine &&
        document.visibilityState === "visible" &&
        socket?.readyState !== WebSocket.OPEN
      )
        window.dispatchEvent(
          new CustomEvent(realtimeEvent, { detail: { type: "ready" } })
        )
    }, 30_000)
    window.addEventListener("online", online)
    document.addEventListener("visibilitychange", visible)
    return () => {
      stopped = true
      clearTimeout(timer)
      clearInterval(fallback)
      socket?.close()
      window.removeEventListener("online", online)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [publicPage])
  return null
}
