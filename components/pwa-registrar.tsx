"use client"

import * as React from "react"

export function PWARegistrar() {
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
      .register("/sw.js", { scope: "/" })
      .catch(() => {
        // The application stays fully usable when a browser or private mode blocks service workers.
      })
  }, [])

  return null
}
