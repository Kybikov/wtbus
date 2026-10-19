"use client"
import { Badge } from "@/components/ui/badge"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const weekday = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

function isoDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function parseDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  )
  return Number.isNaN(date.getTime()) ? null : date
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function shiftMonth(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function gridStart(month: Date) {
  const start = monthStart(month)
  const offset = (start.getDay() + 6) % 7
  return new Date(start.getFullYear(), start.getMonth(), 1 - offset)
}

export function EntityCalendar<T>({
  items,
  dateValue,
  getId,
  getLabel,
  renderItem,
}: {
  items: T[]
  dateValue: (item: T) => string | undefined
  getId: (item: T) => string
  getLabel: (item: T) => string
  renderItem: (item: T) => React.ReactNode
}) {
  const indexed = React.useMemo(() => {
    const byDay = new Map<string, T[]>()
    const undated: T[] = []
    for (const item of items) {
      const raw = dateValue(item)
      if (!raw || !parseDay(raw)) {
        undated.push(item)
        continue
      }
      const bucket = byDay.get(raw)
      if (bucket) bucket.push(item)
      else byDay.set(raw, [item])
    }
    return { byDay, undated }
  }, [dateValue, items])

  const [month, setMonth] = React.useState(() => {
    const today = isoDay(new Date())
    const keys = [...indexed.byDay.keys()].sort()
    const pick = keys.find((key) => key >= today) ?? keys.at(-1) ?? today
    return monthStart(parseDay(pick) ?? new Date())
  })
  const [selected, setSelected] = React.useState(() => isoDay(new Date()))

  const days = React.useMemo(() => {
    const start = gridStart(month)
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      return date
    })
  }, [month])

  const selectedItems = indexed.byDay.get(selected) ?? []
  const title = new Intl.DateTimeFormat("ru", {
    month: "long",
    year: "numeric",
  }).format(month)
  const selectedTitle = parseDay(selected)
    ? new Intl.DateTimeFormat("ru", {
        day: "numeric",
        month: "long",
        weekday: "long",
      }).format(parseDay(selected)!)
    : selected

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
      <section className="surface-card p-3">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="px-1 text-sm font-semibold capitalize">{title}</h3>
          <div className="ml-auto flex items-center gap-1">
            <Button
              aria-label="Предыдущий месяц"
              onClick={() => setMonth((current) => shiftMonth(current, -1))}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronLeft />
            </Button>
            <Button
              onClick={() => {
                const today = new Date()
                setMonth(monthStart(today))
                setSelected(isoDay(today))
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Сегодня
            </Button>
            <Button
              aria-label="Следующий месяц"
              onClick={() => setMonth((current) => shiftMonth(current, 1))}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {weekday.map((label) => (
            <div className="py-1" key={label}>
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((date) => {
            const key = isoDay(date)
            const bucket = indexed.byDay.get(key) ?? []
            const inMonth = date.getMonth() === month.getMonth()
            const isToday = key === isoDay(new Date())
            return (
              <button
                aria-pressed={selected === key}
                className={cn(
                  "flex min-h-20 flex-col gap-1 rounded-xl border border-transparent px-1.5 py-1 text-left hover:bg-muted/70",
                  !inMonth && "opacity-40",
                  selected === key && "border-primary/40 bg-primary/10",
                  isToday && "ring-1 ring-primary/30"
                )}
                key={key}
                onClick={() => setSelected(key)}
                type="button"
              >
                <span className="flex items-center justify-between text-xs">
                  <span className="tabular-nums">{date.getDate()}</span>
                  {bucket.length ? (
                    <Badge
                      variant="secondary"
                      className="bg-muted tabular-nums"
                    >
                      {bucket.length}
                    </Badge>
                  ) : null}
                </span>
                {bucket.slice(0, 3).map((item) => (
                  <span
                    className="truncate text-[11px] leading-4 text-foreground/80"
                    key={getId(item)}
                  >
                    {getLabel(item)}
                  </span>
                ))}
              </button>
            )
          })}
        </div>
      </section>
      <section className="surface-card flex max-h-[40rem] min-h-64 flex-col p-3">
        <h3 className="mb-3 px-1 text-sm font-semibold capitalize">
          {selectedTitle}
          <span className="ml-2 text-muted-foreground tabular-nums">
            {selectedItems.length}
          </span>
        </h3>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {selectedItems.length ? (
            selectedItems.map((item) => (
              <div key={getId(item)}>{renderItem(item)}</div>
            ))
          ) : (
            <p className="px-1 text-sm text-muted-foreground">
              На этот день записей нет.
            </p>
          )}
          {indexed.undated.length ? (
            <div className="border-t border-border pt-3">
              <p className="mb-2 px-1 text-xs text-muted-foreground">
                Без даты · {indexed.undated.length}
              </p>
              {indexed.undated.map((item) => (
                <div className="mb-2" key={getId(item)}>
                  {renderItem(item)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
