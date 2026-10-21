import * as React from "react"

import { mobileViewportQuery } from "@/lib/mobile-viewport"

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}

function getSnapshot() {
  return window.matchMedia(mobileViewportQuery).matches
}
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(mobileViewportQuery)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}
