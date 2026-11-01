"use client"
import type { CSSProperties } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useIsMobile } from "@/hooks/use-mobile"
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme()
  const mobile = useIsMobile()
  return (
    <Sonner
      theme={(resolvedTheme as ToasterProps["theme"]) ?? "system"}
      className="toaster group"
      position={mobile ? "top-center" : "bottom-right"}
      swipeDirections={mobile ? ["top", "left", "right"] : ["right", "bottom"]}
      offset={
        mobile
          ? {
              top: "calc(var(--mobile-safe-top) + 4.5rem)",
              left: "0.75rem",
              right: "0.75rem",
            }
          : undefined
      }
      closeButton={mobile}
      toastOptions={{ closeButtonAriaLabel: "Закрыть уведомление" }}
      visibleToasts={mobile ? 1 : 3}
      mobileOffset={{
        top: "calc(var(--mobile-safe-top) + 4.5rem)",
        left: "0.75rem",
        right: "0.75rem",
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
      {...props}
    />
  )
}
