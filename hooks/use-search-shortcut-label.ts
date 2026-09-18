"use client"

import { useSyncExternalStore } from "react"

const subscribe = () => () => {}
const snapshot = () => /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"
const serverSnapshot = () => "Ctrl K"

export function useSearchShortcutLabel() {
  return useSyncExternalStore(subscribe,snapshot,serverSnapshot)
}
