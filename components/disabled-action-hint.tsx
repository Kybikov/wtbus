"use client"

import * as React from "react"
import { Tooltip, TooltipContent } from "@/components/ui/tooltip"

type Hint = { element: HTMLElement; reason: string }
function readHint(target: EventTarget | null): Hint | null {
  if (!(target instanceof Element)) return null
  const element = target.closest<HTMLElement>("[data-disabled-reason]")
  if (!element || !element.isConnected) return null
  const disabled = element.matches(
    ":disabled, [aria-disabled=true], [data-disabled]"
  )
  const reason =
    element
      .closest<HTMLElement>("[data-disabled-scope]")
      ?.dataset.disabledScope?.trim() || element.dataset.disabledReason?.trim()
  return disabled && reason ? { element, reason } : null
}

// Delegation also covers portal menus and native disabled buttons, without
// adding layout wrappers or replacing their activation/permission guards.
export function DisabledActionHint() {
  const [hint, setHint] = React.useState<Hint | null>(null)
  const id = React.useId()
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let hovered: HTMLElement | null = null
    const cancel = () => clearTimeout(timer)
    const hide = () => {
      cancel()
      hovered = null
      setHint(null)
    }
    const show = (target: EventTarget | null, delay = 0) => {
      cancel()
      const next = readHint(target)
      if (!next) {
        setHint(null)
        return
      }
      timer = setTimeout(() => setHint(readHint(next.element)), delay)
    }
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      const next = readHint(event.target)
      if (hovered === next?.element) return
      hovered = next?.element ?? null
      show(event.target, 250)
    }
    const out = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      const next = readHint(event.relatedTarget)
      if (next?.element === hovered) return
      hovered = null
      if (!readHint(document.activeElement)) hide()
    }
    const focus = (event: FocusEvent) => {
      if (readHint(event.target)) show(event.target)
      else if (hovered) show(hovered, 250)
      else hide()
    }
    const blur = () => {
      if (!hovered) hide()
    }
    const touch = (event: PointerEvent) => {
      if (event.pointerType === "touch") show(event.target)
      else if (!readHint(event.target)) hide()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide()
    }
    document.addEventListener("pointerover", over, true)
    document.addEventListener("pointerout", out, true)
    document.addEventListener("focusin", focus, true)
    document.addEventListener("focusout", blur, true)
    document.addEventListener("pointerdown", touch, true)
    document.addEventListener("keydown", escape, true)
    document.addEventListener("scroll", hide, true)
    window.addEventListener("resize", hide)
    return () => {
      cancel()
      document.removeEventListener("pointerover", over, true)
      document.removeEventListener("pointerout", out, true)
      document.removeEventListener("focusin", focus, true)
      document.removeEventListener("focusout", blur, true)
      document.removeEventListener("pointerdown", touch, true)
      document.removeEventListener("keydown", escape, true)
      document.removeEventListener("scroll", hide, true)
      window.removeEventListener("resize", hide)
    }
  }, [])
  React.useEffect(() => {
    if (!hint) return
    const { element } = hint
    const tokens = new Set(
      (element.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
    )
    tokens.add(id)
    element.setAttribute("aria-describedby", [...tokens].join(" "))
    const observer = new MutationObserver(() => {
      const next = readHint(element)
      if (!next) setHint(null)
      else if (next.reason !== hint.reason) setHint(next)
    })
    observer.observe(element, {
      attributes: true,
      attributeFilter: [
        "disabled",
        "aria-disabled",
        "data-disabled",
        "data-disabled-reason",
      ],
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      const remaining = (element.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter((token) => token && token !== id)
      if (remaining.length)
        element.setAttribute("aria-describedby", remaining.join(" "))
      else element.removeAttribute("aria-describedby")
    }
  }, [hint, id])
  return (
    <Tooltip
      open={Boolean(hint)}
      onOpenChange={(open) => {
        if (!open) setHint(null)
      }}
    >
      <TooltipContent
        id={id}
        role="tooltip"
        anchor={hint?.element}
        data-disabled-action-hint=""
        className="pointer-events-none z-[100] max-w-80 leading-5 whitespace-normal"
      >
        {hint?.reason}
      </TooltipContent>
    </Tooltip>
  )
}
