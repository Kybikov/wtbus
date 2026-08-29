"use client"

import * as React from "react"

export function PWARegistrar() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {
        // The application stays fully usable when a browser or private mode blocks service workers.
      })
  }, [])

  return null
}
