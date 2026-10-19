"use client"

import * as React from "react"
import { toast } from "sonner"
import { createAutosaveQueue } from "@/lib/autosave"

export function useFieldAutosave<T extends object>(
  persist: (value: T) => Promise<T>
) {
  const persistRef = React.useRef(persist)
  React.useLayoutEffect(() => {
    persistRef.current = persist
  }, [persist])
  const [queue] = React.useState(() => createAutosaveQueue<T>(persist))
  const commit = React.useCallback(
    (patch: Partial<T>) => {
      void queue.commit(patch, persistRef.current).catch((error: unknown) => {
        toast.error("Изменения не сохранены", {
          description:
            error instanceof Error ? error.message : "Повторите попытку.",
        })
      })
    },
    [queue]
  )
  return React.useMemo(
    () => ({ initialize: queue.reset, commit }),
    [queue, commit]
  )
}
