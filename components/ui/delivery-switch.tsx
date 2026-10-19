"use client"
import { cn } from "@/lib/utils"
// React Bits Pro notifications-3 switch, with a 44px touch target around its track.
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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group grid size-11 shrink-0 place-items-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex h-5 w-9 items-center rounded-full p-0.5 ring-1 transition-colors duration-150 ring-inset motion-reduce:transition-none",
          checked ? "bg-primary ring-transparent" : "bg-muted ring-border"
        )}
      >
        <span
          className={cn(
            "block size-4 rounded-full shadow-sm transition-[translate,background-color] duration-150 motion-reduce:transition-none",
            checked
              ? "translate-x-4 bg-primary-foreground"
              : "bg-muted-foreground"
          )}
        />
      </span>
    </button>
  )
}
