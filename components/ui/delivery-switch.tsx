"use client"

import SquishSwitch from "@/components/react-bits/micro/SquishSwitch/SquishSwitch"

export function DeliverySwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <SquishSwitch
      checked={checked}
      onChange={onChange}
      ariaLabel={label}
      disabled={disabled}
      width={44}
      height={24}
      radius={12}
      trackColor="var(--control)"
      trackOnColor="var(--primary)"
      thumbColor="var(--muted-foreground)"
      thumbOnColor="var(--primary-foreground)"
      className="min-h-11 min-w-11 shrink-0 justify-center"
    />
  )
}
