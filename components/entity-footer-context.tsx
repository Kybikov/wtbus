"use client"

import { createContext } from "react"

export const EntityFooterContext = createContext<{
  enabled: boolean
  target: HTMLElement | null
}>({ enabled: false, target: null })
