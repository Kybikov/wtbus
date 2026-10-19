"use client"

// Adapted from live React Bits Pro filtering-2: scrollable facets, live count,
// individual resets and a fixed footer, using the workspace's shared controls.
import * as React from "react"
import {
  Check,
  ChevronsUpDown,
  Filter,
  LoaderCircle,
  RotateCcw,
  Search,
  X,
} from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import type { EntityFilter } from "@/lib/entity-views"
import { adminControlClassName } from "@/lib/admin-ui"

function FilterChoice({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const choices = [{ value: "", label: "Все" }, ...options]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            variant="outline"
            className="w-full justify-between font-normal"
          />
        }
      >
        <span className="truncate">
          {choices.find((option) => option.value === value)?.label ?? value}
        </span>
        <ChevronsUpDown className="shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-3rem))] p-1"
      >
        <Command className="rounded-lg">
          <CommandInput
            placeholder="Найти значение…"
            aria-label={`Поиск: ${label}`}
          />
          <CommandList>
            <CommandEmpty>Ничего не найдено.</CommandEmpty>
            {choices.map((option) => (
              <CommandItem
                key={option.value}
                value={`${option.label} ${option.value}`}
                onSelect={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {value === option.value && <Check className="size-4" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
export function EntityFilters<T>({
  collection,
  filters,
  values,
  open,
  onOpenChange,
  onChange,
  filterRequest,
  resultCount,
  loading,
}: {
  collection: string
  filters: EntityFilter<T>[]
  values: Record<string, string>
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (values: Record<string, string>) => void
  filterRequest?: string | null
  resultCount: number
  loading?: boolean
}) {
  const mobile = useIsMobile()
  const [search, setSearch] = React.useState({
    request: filterRequest,
    value: "",
  })
  const query = search.request === filterRequest ? search.value : ""
  const body = React.useRef<HTMLDivElement>(null)
  const count = Object.values(values).filter(Boolean).length
  const shown = filters.filter((filter) =>
    [filter.label, ...(filter.options ?? []).map((o) => o.label)]
      .join(" ")
      .toLocaleLowerCase("ru")
      .includes(query.trim().toLocaleLowerCase("ru"))
  )
  React.useEffect(() => {
    if (!open || !filterRequest) return
    const timer = setTimeout(() => {
      const row = body.current?.querySelector<HTMLElement>(
        `[data-filter-id="${CSS.escape(filterRequest)}"]`
      )
      row?.scrollIntoView({ block: "nearest" })
      row?.querySelector<HTMLElement>("button,input")?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [open, filterRequest, mobile])
  const update = (id: string, value: string) => {
    const next = { ...values }
    if (value) next[id] = value
    else delete next[id]
    onChange(next)
  }
  const trigger = (
    <Button
      variant="outline"
      size="sm"
      className={adminControlClassName}
      aria-label="Фильтры"
    >
      <Filter />
      <span className="sr-only sm:not-sr-only">Фильтры</span>
      {count > 0 && (
        <Badge variant="secondary" className="ml-0.5 px-1.5 tabular-nums">
          {count}
        </Badge>
      )}
    </Button>
  )
  const content = (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Фильтры</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Все выбранные условия действуют вместе.
          </p>
        </div>
        <Button
          aria-label="Закрыть фильтры"
          variant="ghost"
          size="icon-sm"
          onClick={() => onOpenChange(false)}
        >
          <X />
        </Button>
      </header>
      {filters.length > 3 && (
        <div className="px-4 pt-3">
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Поиск фильтров"
              placeholder="Найти фильтр…"
              value={query}
              onChange={(event) =>
                setSearch({ request: filterRequest, value: event.target.value })
              }
            />
          </InputGroup>
        </div>
      )}
      <div
        ref={body}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
        data-filter-fields
      >
        {shown.length ? (
          shown.map((filter) => (
            <section
              key={filter.id}
              data-filter-id={filter.id}
              className="space-y-2 border-b border-border/70 py-4 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={`${collection}-filter-${filter.id}`}
                  className="text-sm font-medium"
                >
                  {filter.label}
                </label>
                {values[filter.id] && (
                  <Button
                    aria-label={`Сбросить фильтр ${filter.label}`}
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => update(filter.id, "")}
                  >
                    <X />
                  </Button>
                )}
              </div>
              {filter.type === "date" ? (
                <DatePicker
                  id={`${collection}-filter-${filter.id}`}
                  label={filter.label}
                  value={values[filter.id] ?? ""}
                  onValueChange={(value) => update(filter.id, value)}
                />
              ) : (
                <FilterChoice
                  id={`${collection}-filter-${filter.id}`}
                  label={filter.label}
                  options={filter.options ?? []}
                  value={values[filter.id] ?? ""}
                  onChange={(value) => update(filter.id, value)}
                />
              )}
            </section>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Таких фильтров нет.
          </p>
        )}
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-border bg-card px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={!count}
          onClick={() => onChange({})}
        >
          <RotateCcw />
          Сбросить
        </Button>
        <span
          role="status"
          aria-live="polite"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          {loading ? (
            <>
              <LoaderCircle className="size-3 animate-spin" />
              Обновляем…
            </>
          ) : (
            <>
              Записей:{" "}
              <strong className="text-foreground tabular-nums">
                {resultCount}
              </strong>
            </>
          )}
        </span>
        <Button size="sm" onClick={() => onOpenChange(false)}>
          Готово
        </Button>
      </footer>
    </>
  )
  return mobile ? (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger render={trigger} />
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl p-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Фильтры</SheetTitle>
          <SheetDescription>
            Выберите условия отображения записей.
          </SheetDescription>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  ) : (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="end"
        className="flex max-h-[min(38rem,calc(100dvh-7rem))] w-96 max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl p-0"
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}
