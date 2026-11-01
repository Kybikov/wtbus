"use client"

import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu"
import { DeliverySwitch } from "@/components/ui/delivery-switch"
import { Button } from "@/components/ui/button"

const subscribe = () => () => {}

export function ThemeToggle({
  menu = false,
  compact = false,
}: {
  menu?: boolean
  compact?: boolean
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
  const dark = mounted && resolvedTheme === "dark"
  if (compact)
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}
        title={dark ? "Тёмная тема" : "Светлая тема"}
        onClick={() => setTheme(dark ? "light" : "dark")}
      >
        {dark ? <Moon className="size-5" /> : <Sun className="size-5" />}
      </Button>
    )
  const content = (
    <>
      {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
      <span className="flex-1 text-left">
        {dark ? "Тёмная тема" : "Светлая тема"}
      </span>
      <span
        aria-hidden={menu || undefined}
        className={menu ? "pointer-events-none" : ""}
      >
        <DeliverySwitch
          label="Тёмная тема"
          checked={dark}
          onChange={(checked) => setTheme(checked ? "dark" : "light")}
          tabIndex={menu ? -1 : undefined}
        />
      </span>
    </>
  )
  if (menu)
    return (
      <DropdownMenuCheckboxItem
        checked={dark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        className="pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
      >
        {content}
      </DropdownMenuCheckboxItem>
    )
  return (
    <div className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-2 text-sm">
      {content}
    </div>
  )
}
