"use client"
import { useState, useRef } from "react"
export function useEntitySelection<T>(getId: (item: T) => string) {
  const running = useRef(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(
    items: T[],
    change: (item: T) => Promise<void>,
    reload: () => Promise<unknown>
  ) {
    if (running.current) return
    running.current = true
    setPending(true)
    setError(null)
    const failed = new Set<string>()
    const messages: string[] = []
    for (const item of items.filter((item) => selected.has(getId(item))))
      try {
        await change(item)
      } catch (reason) {
        failed.add(getId(item))
        messages.push(
          reason instanceof Error
            ? reason.message
            : "Не удалось изменить запись."
        )
      }
    setSelected(failed)
    try {
      await reload()
    } catch (reason) {
      messages.push(
        reason instanceof Error ? reason.message : "Не удалось обновить данные."
      )
    }
    setError([...new Set(messages)].join(" ") || null)
    running.current = false
    setPending(false)
  }
  return { selected, setSelected, pending, error, run }
}
