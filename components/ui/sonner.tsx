"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      closeButton
      duration={4500}
      expand
      gap={10}
      richColors
      visibleToasts={4}
      position="bottom-right"
      theme={(resolvedTheme as ToasterProps["theme"]) ?? "system"}
      toastOptions={{
        classNames: {
          toast:
            "font-sans rounded-2xl border-border/80 bg-popover/95 shadow-2xl shadow-black/20 backdrop-blur-xl",
          title: "font-semibold tracking-[-0.01em]",
          description: "text-muted-foreground leading-relaxed",
          actionButton: "rounded-lg font-medium",
          cancelButton: "rounded-lg",
          closeButton:
            "border-border bg-background text-foreground hover:bg-accent",
        },
      }}
      {...props}
    />
  )
}
