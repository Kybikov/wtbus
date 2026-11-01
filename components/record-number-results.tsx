"use client"
import * as React from "react"
import { sessionFetch } from "@/lib/session-navigation"
import { entityDetailHref, entityNames } from "@/lib/entity-details"
import type { EntityCollection } from "@/lib/entity-views"
import { CommandGroup, CommandItem } from "@/components/ui/command"

type Match = {
  id: string
  entity: EntityCollection
  number: string
  label: string
}
export function useRecordNumberSearch(
  open: boolean,
  query: string,
  enabled: boolean
) {
  const [state, setState] = React.useState<{
    query: string
    items: Match[]
    error: string
  }>({ query: "", items: [], error: "" })
  React.useEffect(() => {
    if (!open || !enabled || !query.trim()) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await sessionFetch(
          `/api/record-number-search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal }
        )
        const payload = await response.json()
        if (!response.ok || !Array.isArray(payload.items))
          throw Error(payload.error ?? "Не удалось найти записи по номеру.")
        if (!controller.signal.aborted)
          setState({
            query,
            items: payload.items.filter(
              (item: Match) => item.entity in entityNames
            ),
            error: "",
          })
      } catch (reason) {
        if (!controller.signal.aborted)
          setState({
            query,
            items: [],
            error:
              reason instanceof Error
                ? reason.message
                : "Не удалось найти записи по номеру.",
          })
      }
    }, 220)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, enabled, query])
  return state.query === query && open && enabled
    ? state
    : { query, items: [], error: "" }
}
export function RecordNumberResults({
  items,
  error,
  navigate,
}: {
  items: Match[]
  error: string
  navigate: (href: string) => void
}) {
  return (
    <>
      {error ? (
        <p className="px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      {items.length ? (
        <CommandGroup heading="ЗАПИСИ ПО НОМЕРУ">
          {items.map((item) => (
            <CommandItem
              key={`${item.entity}:${item.id}`}
              value={`record:${item.entity}:${item.id}`}
              onSelect={() => navigate(entityDetailHref(item.entity, item.id))}
              className="min-h-12 cursor-pointer"
            >
              <span className="min-w-0">
                <span className="block font-semibold">
                  {item.number} · {entityNames[item.entity]}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {item.label}
                </span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  )
}
