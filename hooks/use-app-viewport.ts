"use client"

import * as React from "react"
import {
  mobileViewportQuery,
  resolveMobileViewport,
  type MobileViewport,
} from "@/lib/mobile-viewport"

const initial: MobileViewport = {
  layoutHeight: 600,
  height: 600,
  top: 0,
  bottom: 0,
  keyboard: false,
  safeTop: 0,
  safeBottom: 0,
}
const properties = [
  "--mobile-layout-height",
  "--mobile-viewport-height",
  "--mobile-viewport-top",
  "--mobile-viewport-bottom",
  "--mobile-safe-top",
  "--mobile-safe-bottom",
]
const editable = (element: Element | null) =>
  !!element?.matches(
    'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]),textarea,[contenteditable="true"]'
  )

export function useAppViewport(enabled: boolean) {
  const [viewport, setViewport] = React.useState(initial)
  React.useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    const mobile = window.matchMedia(mobileViewportQuery)
    const standalone = window.matchMedia("(display-mode: standalone)")
    const fullscreen = window.matchMedia("(display-mode: fullscreen)")
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    const view = window.visualViewport
    // Resolve env() through actual padding: WebKit may return the literal env()
    // expression when a custom property's computed value is read instead.
    const probe = document.createElement("div")
    probe.ariaHidden = "true"
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;width:0;height:100vh;height:100lvh;top:0;left:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:border-box;overflow:hidden;"
    document.body.append(probe)
    let frame = 0,
      keyboard = false
    const timers = new Set<number>()
    const clear = () => {
      properties.forEach((property) => root.style.removeProperty(property))
      delete root.dataset.mobileKeyboard
      delete root.dataset.iosStandalone
    }
    const isInstalledIOS = () =>
      ios &&
      (standalone.matches ||
        fullscreen.matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true)
    const resetRootScroll = () => {
      if (
        mobile.matches &&
        ios &&
        document.querySelector(".app-shell-frame") &&
        Math.abs((view?.scale ?? 1) - 1) < 0.01
      )
        window.scrollTo({ left: 0, top: 0, behavior: "instant" })
    }
    const measure = () => {
      frame = 0
      if (!mobile.matches) {
        clear()
        return
      }
      const style = getComputedStyle(probe)
      const installed = isInstalledIOS()
      const next = resolveMobileViewport({
        innerHeight: window.innerHeight,
        largeHeight: parseFloat(style.height) || window.innerHeight,
        visualHeight: view?.height ?? window.innerHeight,
        visualTop: view?.offsetTop ?? 0,
        scale: view?.scale ?? 1,
        iosStandalone: installed,
        focused: editable(document.activeElement),
        wasKeyboard: keyboard,
        safeTop: parseFloat(style.paddingTop) || 0,
        safeBottom: parseFloat(style.paddingBottom) || 0,
      })
      if (!next) return // Never counteract intentional pinch zoom.
      keyboard = next.keyboard
      const values = [
        next.layoutHeight,
        next.height,
        next.top,
        next.bottom,
        next.safeTop,
        next.safeBottom,
      ]
      properties.forEach((property, index) =>
        root.style.setProperty(property, values[index] + "px")
      )
      root.dataset.mobileKeyboard = String(next.keyboard)
      root.dataset.iosStandalone = String(installed)
      setViewport((current) =>
        Object.keys(next).every(
          (key) =>
            current[key as keyof MobileViewport] ===
            next[key as keyof MobileViewport]
        )
          ? current
          : next
      )
      if (ios && window.scrollY !== 0) resetRootScroll()
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const focusChanged = (event: Event) => {
      if (!editable(event.target as Element)) return
      schedule()
      if (!ios) return
      // iOS commits keyboard/viewport changes over several animation frames.
      resetRootScroll()
      for (const delay of [50, 150, 350]) {
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          resetRootScroll()
          schedule()
        }, delay)
        timers.add(timer)
      }
    }
    schedule()
    view?.addEventListener("resize", schedule)
    view?.addEventListener("scroll", schedule)
    window.addEventListener("resize", schedule)
    window.addEventListener("orientationchange", schedule)
    window.addEventListener("pageshow", schedule)
    document.addEventListener("visibilitychange", schedule)
    document.addEventListener("focusin", focusChanged)
    document.addEventListener("focusout", focusChanged)
    mobile.addEventListener("change", schedule)
    standalone.addEventListener("change", schedule)
    fullscreen.addEventListener("change", schedule)
    return () => {
      cancelAnimationFrame(frame)
      timers.forEach((timer) => clearTimeout(timer))
      view?.removeEventListener("resize", schedule)
      view?.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("orientationchange", schedule)
      window.removeEventListener("pageshow", schedule)
      document.removeEventListener("visibilitychange", schedule)
      document.removeEventListener("focusin", focusChanged)
      document.removeEventListener("focusout", focusChanged)
      mobile.removeEventListener("change", schedule)
      standalone.removeEventListener("change", schedule)
      fullscreen.removeEventListener("change", schedule)
      probe.remove()
      clear()
    }
  }, [enabled])
  return viewport
}
