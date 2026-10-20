"use client"
import * as React from "react"
import HoldButton from "@/components/react-bits/micro/HoldButton/HoldButton"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { DisabledActionReasonContext } from "@/components/disabled-action-scope"

export function HoldActionButton({
  children,
  onConfirm,
  disabled,
  disabledReason,
  className,
  tone = "danger",
  size = "default",
}: {
  children: React.ReactNode
  onConfirm: () => void
  disabled?: boolean
  disabledReason?: string
  className?: string
  tone?: "danger" | "archive"
  size?: "default" | "sm"
}) {
  const scopeReason = React.useContext(DisabledActionReasonContext)
  return (
    <HoldButton
      onHold={onConfirm}
      disabled={disabled}
      disabledReason={scopeReason ?? disabledReason}
      holdTime={1200}
      resetAfter={900}
      doneLabel="Подтверждено"
      backgroundColor="var(--control)"
      textColor="var(--foreground)"
      fillColor={tone === "danger" ? "var(--destructive)" : "var(--primary)"}
      fillTextColor={tone === "danger" ? "white" : "var(--primary-foreground)"}
      glow={false}
      waveAmplitude={3}
      className={cn(
        buttonVariants({ variant: "outline", size }),
        "!h-10 !rounded-xl !px-3 !text-sm",
        size === "sm" && "sm:!h-8",
        className
      )}
    >
      {children}
    </HoldButton>
  )
}
