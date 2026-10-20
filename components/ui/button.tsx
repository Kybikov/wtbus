"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { VariantProps } from "class-variance-authority"
import { useContext } from "react"
import { buttonVariants } from "@/lib/button-variants"
import { DisabledActionReasonContext } from "@/components/disabled-action-scope"

import { cn } from "@/lib/utils"

function Button({
  className,
  variant = "default",
  size = "default",
  disabledReason,
  disabled,
  title,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { disabledReason?: string }) {
  const scopeReason = useContext(DisabledActionReasonContext)
  const reason = scopeReason ?? disabledReason ?? title
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
      disabled={disabled}
      focusableWhenDisabled={disabled ? true : props.focusableWhenDisabled}
      data-disabled-reason={disabled ? reason : undefined}
      aria-description={disabled ? reason : props["aria-description"]}
      title={disabled && reason ? undefined : title}
    />
  )
}

export { Button, buttonVariants }
