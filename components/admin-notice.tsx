"use client"

import * as React from "react"
import { toast } from "sonner"

export function AdminNotice({
  message,
  variant = "success",
  title,
}: {
  message?: string | null
  variant?: "success" | "error" | "info"
  title?: string
}) {
  const lastMessage = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!message) {
      lastMessage.current = null
      return
    }
    if (lastMessage.current === message) return
    lastMessage.current = message
    const translated =
      message === "the company must keep at least one active owner"
        ? "В команде должен остаться хотя бы один активный владелец."
        : message
    const options = title ? { description: translated } : undefined
    if (variant === "error") toast.error(title ?? translated, options)
    else if (variant === "info") toast.info(title ?? translated, options)
    else toast.success(title ?? translated, options)
  }, [message, title, variant])

  return null
}
