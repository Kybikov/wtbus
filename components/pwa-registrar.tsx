"use client"

import * as React from "react"
import { updateInstallState, type InstallPrompt } from "@/lib/pwa-install"

export function PWARegistrar() {
  React.useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)")
    const refresh = () =>
      updateInstallState({
        ready: true,
        standalone:
          display.matches ||
          ("standalone" in navigator && navigator.standalone === true),
        ios:
          /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
      })
    const installPrompt = (event: Event) => {
      event.preventDefault()
      updateInstallState({ prompt: event as InstallPrompt })
    }
    const installed = () =>
      updateInstallState({ standalone: true, prompt: null })
    refresh()
    window.addEventListener("beforeinstallprompt", installPrompt)
    window.addEventListener("appinstalled", installed)
    display.addEventListener("change", refresh)
    return () => {
      window.removeEventListener("beforeinstallprompt", installPrompt)
      window.removeEventListener("appinstalled", installed)
      display.removeEventListener("change", refresh)
    }
  }, [])
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    // Development chunk names are reused by HMR. A cached older chunk produces
    // hydration failures and can keep obsolete GPS logic alive after an edit.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then(async (registrations) => {
          await Promise.all(
            registrations
              .filter((registration) => {
                const worker =
                  registration.active ??
                  registration.waiting ??
                  registration.installing
                return worker && new URL(worker.scriptURL).pathname === "/sw.js"
              })
              .map((registration) => registration.unregister())
          )
          if ("caches" in window) {
            const keys = await caches.keys()
            await Promise.all(
              keys
                .filter((key) => key.startsWith("vivat-bus-"))
                .map((key) => caches.delete(key))
            )
          }
        })
        .catch(() => {})
      return
    }

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        // The application stays fully usable when a browser or private mode blocks service workers.
      })
  }, [])

  return null
}
