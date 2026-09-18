"use client"

import { useSearchShortcutLabel } from "@/hooks/use-search-shortcut-label"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { adminSearchClassName } from "@/lib/admin-ui"

export function AdminSearchField({ value, onChange, label, placeholder, onGlobalSearch, autoFocus, className }: {
  value: string; onChange: (value: string) => void; label: string; placeholder: string
  onGlobalSearch: () => void; autoFocus?: boolean; className?: string
}) {
  const shortcut = useSearchShortcutLabel()
  return <div className={cn(adminSearchClassName, "flex min-w-0 items-center gap-1 px-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20", className)}>
    <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
    <Input aria-label={label} autoFocus={autoFocus} title={placeholder} placeholder="Поиск…" value={value} maxLength={120} onChange={event => onChange(event.target.value)} onKeyDown={event => { if(event.key === "Escape" && value) { event.preventDefault(); onChange("") } }} className="h-8 min-w-0 flex-1 rounded-none border-0 bg-transparent! px-1 text-sm shadow-none focus-visible:ring-0" />
    {value ? <Button aria-label="Очистить поиск" variant="ghost" size="icon-xs" className="size-6 shrink-0 rounded-md" onClick={() => onChange("")}><X className="size-3" /></Button> : null}
    <Button aria-label="Открыть глобальный поиск" title={`Глобальный поиск (${shortcut})`} variant="ghost" size="xs" onClick={onGlobalSearch} className="h-6 shrink-0 rounded-md px-1 text-[10px] text-muted-foreground"><kbd>{shortcut}</kbd></Button>
  </div>
}
