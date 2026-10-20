"use client"
// React Bits Glide Select's gliding highlight, hosted by Base UI for portal,
// collision detection, long-list scrolling, typeahead and disabled options.
import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

export default function GlideSelectList({
  children,
}: {
  children: React.ReactNode
}) {
  const list = React.useRef<HTMLDivElement>(null),
    pill = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    const root = list.current,
      highlight = pill.current
    if (!root || !highlight) return
    let frame = 0,
      first = true,
      last: HTMLElement | null = null
    const update = () => {
      const active = root.querySelector<HTMLElement>(
        "[data-highlighted]:not([data-disabled])"
      )
      if (last && !root.contains(last)) last = null
      if (active) last = active
      const item =
        active ??
        last ??
        root.querySelector<HTMLElement>("[data-selected]:not([data-disabled])")
      if (!item) {
        highlight.style.opacity = "0"
        return
      }
      const row = item.getBoundingClientRect(),
        bounds = root.getBoundingClientRect()
      highlight.style.transitionDuration = first ? "0ms" : ""
      highlight.style.transform = `translateY(${row.top - bounds.top + root.scrollTop}px)`
      highlight.style.height = `${row.height}px`
      highlight.style.opacity = "1"
      first = false
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(root, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ["data-highlighted", "data-selected"],
    })
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    root.addEventListener("scroll", schedule, { passive: true })
    schedule()
    return () => {
      observer.disconnect()
      resize.disconnect()
      cancelAnimationFrame(frame)
      root.removeEventListener("scroll", schedule)
    }
  }, [])
  return (
    <SelectPrimitive.List
      ref={list}
      className="relative"
      data-glide-select-list
    >
      <span
        ref={pill}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 rounded-lg bg-control-hover opacity-0 transition-[transform,height,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
      />
      {children}
    </SelectPrimitive.List>
  )
}
