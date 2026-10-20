"use client"
import { useEffect, useRef, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
export function InfiniteSentinel({
  hasMore,
  loading,
  onMore,
  auto = false,
  version = 0,
}: {
  hasMore: boolean
  loading?: boolean
  onMore: () => void | Promise<void>
  auto?: boolean
  version?: number | string
}) {
  const target = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const [error, setError] = useState(false)
  const callback = useRef(onMore)
  useEffect(()=>{callback.current=onMore},[onMore])
  useEffect(() => {
    if (!hasMore || loading || error) return
    let active = true
    const more = async () => {
      if (busy.current) return
      busy.current = true
      try {
        await callback.current()
      } catch {
        if (active) setError(true)
      } finally {
        busy.current = false
      }
    }
    if (auto) {
      void more()
      return () => {
        active = false
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void more()
      },
      { rootMargin: "300px" }
    )
    if (target.current) observer.observe(target.current)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [hasMore, loading, auto, version, error])
  if (!hasMore) return null
  return (
    <div
      ref={target}
      className="flex min-h-12 items-center justify-center py-3"
      role="status"
    >
      {error ? (
        <Button variant="outline" onClick={() => setError(false)}>
          Повторить загрузку
        </Button>
      ) : (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Подгружаем записи…
        </span>
      )}
    </div>
  )
}
