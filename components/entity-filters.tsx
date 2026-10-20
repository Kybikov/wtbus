"use client"
import { useState } from "react"
import { Filter, RotateCcw } from "lucide-react"
import {
  AdvancedFilterBuilder,
  newFilterGroup,
  QueryChoice,
} from "@/components/advanced-filter-builder"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
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
  appendQueryRule,
  fieldOperators,
  queryWithLegacyFilters,
  isCompleteFilterRule,
  type FilterGroup,
  type QueryFieldChoice,
} from "@/lib/entity-query"
import { adminControlClassName } from "@/lib/admin-ui"
function complete(group: FilterGroup): boolean {
  return group.rules.every((node) =>
    "rules" in node
      ? node.rules.length > 0 && complete(node)
      : isCompleteFilterRule(node)
  )
}
function FilterDraft({
  initial,
  fields,
  onApply,
  count,
  initialField,
}: {
  initial: FilterGroup
  fields: QueryFieldChoice[]
  onApply: (group: FilterGroup) => void
  count?: (group: FilterGroup) => number
  initialField?: string | null
}) {
  const [prepared] = useState(() => {
    const field = fields.find((item) => item.id === initialField)
    return field
      ? appendQueryRule(initial, {
          id: crypto.randomUUID(),
          field: field.id,
          operator: fieldOperators(field.kind)[0],
          value: [],
        })
      : initial
  })
  const [draft, setDraft] = useState(prepared ?? initial)
  return (
    <>
      {!prepared && (
        <p role="alert" className="text-sm text-destructive">
          Не удалось добавить условие: достигнут лимит вложенности или
          количества. Измените существующие условия.
        </p>
      )}
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
  initialField,
}: {
  fields: QueryFieldChoice[]
  values: Record<string, string>
  query?: FilterGroup
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (query: FilterGroup) => void
  count?: (query: FilterGroup) => number
  initialField?: string | null
}) {
  const initial = queryWithLegacyFilters(values, query)
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
          initialField={initialField}
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

function ColumnSearchDraft({
  field,
  initial,
  onApply,
  count,
}: {
  field: QueryFieldChoice
  initial: FilterGroup
  onApply: (query: FilterGroup) => void
  count?: (query: FilterGroup) => number
}) {
  const [value, setValue] = useState<string[]>([])
  const [id] = useState(() => crypto.randomUUID())
  const next = appendQueryRule(initial, {
    id,
    field: field.id,
    operator:
      field.kind === "text"
        ? "contains"
        : field.kind === "select"
          ? "in"
          : "eq",
    value,
  })
  const complete = value.length > 0 && value.every((item) => item.trim() !== "")
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (complete && next) onApply(next)
      }}
    >
      <div className="grid gap-2 text-sm">
        <label htmlFor={field.kind === "select" ? undefined : `search-${id}`}>
          {field.label}
        </label>
        {field.kind === "select" ? (
          <QueryChoice
            label={`Значения: ${field.label}`}
            options={field.options ?? []}
            values={value}
            onChange={setValue}
            multiple
          />
        ) : field.kind === "date" ? (
          <DatePicker
            id={`search-${id}`}
            label={`Дата: ${field.label}`}
            value={value[0] ?? ""}
            onValueChange={(item) => setValue([item])}
          />
        ) : (
          <Input
            id={`search-${id}`}
            autoFocus
            type={field.kind === "number" ? "number" : "text"}
            step="any"
            maxLength={500}
            placeholder={
              field.kind === "number" ? "Введите число" : "Введите текст…"
            }
            value={value[0] ?? ""}
            onChange={(event) => setValue([event.target.value])}
          />
        )}
      </div>
      {!next && (
        <p role="alert" className="text-sm text-destructive">
          Достигнут лимит условий. Измените существующий фильтр.
        </p>
      )}
      <DialogFooter className="flex-row items-center justify-between gap-3">
        <span role="status" className="mr-auto text-xs text-muted-foreground">
          Совпадений: {complete && next ? (count?.(next) ?? "—") : "—"}
        </span>
        <Button type="submit" disabled={!complete || !next}>
          Найти
        </Button>
      </DialogFooter>
    </form>
  )
}

export function EntityColumnSearch({
  field,
  values,
  query,
  onClose,
  onApply,
  count,
}: {
  field?: QueryFieldChoice
  values: Record<string, string>
  query?: FilterGroup
  onClose: () => void
  onApply: (query: FilterGroup) => void
  count?: (query: FilterGroup) => number
}) {
  return (
    <Dialog
      open={Boolean(field)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md!">
        <DialogHeader>
          <DialogTitle>
            Поиск в колонке{field ? ` «${field.label}»` : ""}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Добавьте условие поиска к текущим фильтрам.
          </DialogDescription>
        </DialogHeader>
        {field && (
          <ColumnSearchDraft
            key={field.id}
            field={field}
            initial={queryWithLegacyFilters(values, query)}
            count={count}
            onApply={(next) => {
              onApply(next)
              onClose()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
