"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { RefreshCw } from "lucide-react"
import { pullDistance, pullRefreshThreshold } from "@/lib/pull-refresh"
import { mobileViewportQuery } from "@/lib/mobile-viewport"

export function PullToRefresh({
  children,
  onRefresh,
  refreshing,
}: {
  children: ReactNode
  onRefresh: () => Promise<void>
  refreshing: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const [distance, setDistance] = useState(0)
  const [result, setResult] = useState("")
  useEffect(() => {
    const element = root.current
    if (!element) return
    let start: { x: number; y: number; scroll: HTMLElement } | null = null
    let pulled = 0
    const reset = () => {
      start = null
      pulled = 0
      setDistance(0)
    }
    const begin = (e: TouchEvent) => {
      if (
        !window.matchMedia(mobileViewportQuery).matches ||
        e.touches.length !== 1 ||
        busy.current ||
        refreshing
      )
        return
      const target = e.target as HTMLElement
      if (
        target.closest(
          'button,a,input,textarea,[role="slider"],[role="switch"]'
        )
      )
        return
      const scroll = target.closest<HTMLElement>(
        '[data-slot="scroll-area-viewport"]'
      )
      if (!scroll || scroll.scrollTop > 0) return
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, scroll }
      setResult("")
    }
    const move = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return reset()
      const dy = e.touches[0].clientY - start.y,
        dx = e.touches[0].clientX - start.x
      if (start.scroll.scrollTop > 0 || dy < 0 || Math.abs(dx) > Math.abs(dy))
        return reset()
      if (dy > 10) {
        if (e.cancelable) e.preventDefault()
        pulled = pullDistance(dx, dy, start.scroll.scrollTop, e.touches.length)
        setDistance(pulled)
      }
    }
    const end = async () => {
      const ready = pulled >= pullRefreshThreshold
      reset()
      if (!ready || busy.current) return
      busy.current = true
      try {
        await onRefresh()
      } catch {
        setResult("Не удалось обновить. Повторите попытку.")
      } finally {
        busy.current = false
      }
    }
    element.addEventListener("touchstart", begin, { passive: true })
    element.addEventListener("touchmove", move, { passive: false })
    element.addEventListener("touchend", end)
    element.addEventListener("touchcancel", reset)
    return () => {
      element.removeEventListener("touchstart", begin)
      element.removeEventListener("touchmove", move)
      element.removeEventListener("touchend", end)
      element.removeEventListener("touchcancel", reset)
    }
  }, [onRefresh, refreshing])
  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(""), 2500)
    return () => clearTimeout(timer)
  }, [result])
  return (
    <div
      ref={root}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {(distance > 0 || refreshing || result) && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-0 top-2 z-40 flex justify-center md:hidden"
        >
          <span className="flex items-center gap-2 rounded-full border bg-popover px-4 py-2 text-xs shadow-lg">
            <RefreshCw
              className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
              style={
                !refreshing
                  ? { transform: `rotate(${distance * 3}deg)` }
                  : undefined
              }
            />
            {refreshing
              ? "Обновляем…"
              : result ||
                (distance >= pullRefreshThreshold
                  ? "Отпустите, чтобы обновить"
                  : "Потяните, чтобы обновить")}
          </span>
        </div>
      )}
      {children}
    </div>
  )
}
