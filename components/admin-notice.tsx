"use client"

import * as React from "react"
import { toast } from "sonner"

export function AdminNotice({ message }: { message?: string | null }) {
  const lastMessage = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!message) {
      lastMessage.current = null
      return
    }
    if (lastMessage.current === message) return
    lastMessage.current = message
    toast.success(message)
  }, [message])

  return null
}
