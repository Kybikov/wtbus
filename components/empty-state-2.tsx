"use client"

// Licensed React Bits Pro empty-state-2, fetched from the configured Pro registry.
// Its framed no-results panel is adapted to bus inventory and shared shadcn actions;
// demo report controls are omitted because booking already provides search and filters.
import { RotateCcw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function EmptyState2({ title, description, onReset }: {
  title: string
  description: string
  onReset: () => void
}) {
  return <div className="rounded-[var(--rb-r-2xl)] border border-border bg-muted/20 p-1 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
    <div className="rounded-[var(--rb-r-lg)] border border-border bg-card px-5 py-8 text-center sm:px-10">
      <span aria-hidden="true" className="mx-auto flex size-10 items-center justify-center rounded-xl border border-border text-primary">
        <Search className="size-4" />
      </span>
      <div role="status">
        <h3 className="mt-4 text-base font-medium tracking-tight">{title}</h3>
        <p className="mx-auto mt-1.5 max-w-96 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Button type="button" variant="outline" className="mt-5 h-11 px-4" onClick={onReset}>
        <RotateCcw aria-hidden="true" />Скинути фільтри
      </Button>
    </div>
  </div>
}
