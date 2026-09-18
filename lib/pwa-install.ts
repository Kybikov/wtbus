"use client"

import { useSyncExternalStore } from "react"

export interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}
type InstallState = {
  ready: boolean
  standalone: boolean
  ios: boolean
  prompt: InstallPrompt | null
}
const initial: InstallState = {
  ready: false,
  standalone: false,
  ios: false,
  prompt: null,
}
let state = initial
const listeners = new Set<() => void>()
export function updateInstallState(patch: Partial<InstallState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}
export function usePWAInstall() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => state,
    () => initial
  )
}
export async function installPWA() {
  const prompt = state.prompt
  if (!prompt) return null
  // The event is single-use, including when the user dismisses the prompt.
  updateInstallState({ prompt: null })
  await prompt.prompt()
  const choice = await prompt.userChoice
  return choice.outcome
}
