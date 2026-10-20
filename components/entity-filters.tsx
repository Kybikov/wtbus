"use client"
import { useState } from "react"
import { Filter, RotateCcw } from "lucide-react"
import {
  AdvancedFilterBuilder,
  newFilterGroup,
} from "@/components/advanced-filter-builder"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  countQuery,
  type FilterGroup,
  type QueryFieldChoice,
} from "@/lib/entity-query"
import { adminControlClassName } from "@/lib/admin-ui"
function complete(group: FilterGroup): boolean {
  return group.rules.every((node) =>
    "rules" in node
      ? node.rules.length > 0 && complete(node)
      : ["empty", "notEmpty"].includes(node.operator) ||
        (node.value.length > 0 &&
          node.value.every((value) => value.trim() !== ""))
  )
}
function FilterDraft({
  initial,
  fields,
  onApply,
  count,
}: {
  initial: FilterGroup
  fields: QueryFieldChoice[]
  onApply: (group: FilterGroup) => void
  count?: (group: FilterGroup) => number
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
        <AdvancedFilterBuilder
          group={draft}
          fields={fields}
          onChange={setDraft}
        />
      </div>
      <DialogFooter className="mt-4 flex-row items-center justify-between gap-3 border-t border-border pt-4">
        <Button
          variant="ghost"
          disabled={!countQuery(draft)}
          onClick={() => setDraft(newFilterGroup())}
        >
          <RotateCcw />
          Сбросить
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span role="status" className="text-xs text-muted-foreground">
            Совпадений: {count?.(draft) ?? "—"}
          </span>
          <Button disabled={!complete(draft)} onClick={() => onApply(draft)}>
            Применить
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
export function EntityFilters({
  fields,
  values,
  query,
  open,
  onOpenChange,
  onChange,
  count,
}: {
  fields: QueryFieldChoice[]
  values: Record<string, string>
  query?: FilterGroup
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (query: FilterGroup) => void
  count?: (query: FilterGroup) => number
}) {
  const legacy = Object.entries(values)
    .filter(([, value]) => value)
    .map(([field, value]) => ({
      id: `legacy-${field}`,
      field,
      operator: "eq" as const,
      value: [value],
    }))
  const initial: FilterGroup = legacy.length
    ? {
        id: "root",
        combinator: "and",
        rules: [...legacy, ...(query ? [query] : [])],
      }
    : (query ?? { id: "root", combinator: "and", rules: [] })
  const active = countQuery(initial)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={adminControlClassName}
            aria-label="Фильтры"
          />
        }
      >
        <Filter />
        <span className="sr-only sm:not-sr-only">Фильтры</span>
        {active > 0 && (
          <Badge variant="secondary" className="px-1.5 tabular-nums">
            {active}
          </Badge>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-4xl! flex-col gap-3 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Фильтры</DialogTitle>
          <DialogDescription className="sr-only">
            Условия по колонкам, объединённые в группы И или ИЛИ.
          </DialogDescription>
        </DialogHeader>
        <FilterDraft
          initial={initial}
          fields={fields}
          count={count}
          onApply={(next) => {
            onChange(next)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
