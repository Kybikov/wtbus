"use client"

import SquishSwitch from "@/components/react-bits/micro/SquishSwitch/SquishSwitch"

export function DeliverySwitch({
  checked,
  onChange,
  label,
  disabled,
  tabIndex,
  disabledReason,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabledReason?: string
  tabIndex?: number
  disabled?: boolean
}) {
  return (
    <span
      title={disabled ? disabledReason : undefined}
      data-disabled-reason={disabled ? disabledReason : undefined}
      tabIndex={disabled && disabledReason ? 0 : undefined}
      className="inline-flex shrink-0"
    >
      <SquishSwitch
        checked={checked}
        onChange={onChange}
        ariaLabel={label}
        disabled={disabled}
        tabIndex={tabIndex}
        width={44}
        height={24}
        radius={12}
        trackColor="var(--control)"
        trackOnColor="var(--primary)"
        thumbColor="var(--muted-foreground)"
        thumbOnColor="var(--primary-foreground)"
        className="min-h-11 min-w-11 shrink-0 justify-center"
      />
    </span>
  )
}
