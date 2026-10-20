"use client"

import { createContext, type ReactNode } from "react"

export const DisabledActionReasonContext = createContext<string | undefined>(
  undefined
)

export function DisabledActionScope({
  reason,
  children,
}: {
  reason?: string
  children: ReactNode
}) {
  return (
    <DisabledActionReasonContext.Provider value={reason}>
      {children}
    </DisabledActionReasonContext.Provider>
  )
}
