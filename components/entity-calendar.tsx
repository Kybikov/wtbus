"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useIsMobile } from "@/hooks/use-mobile"
import { statusToneClass } from "@/lib/entity-columns"
import {
  calendarDayKey,
  parseCalendarDay,
  calendarMonthDays,
} from "@/lib/calendar-grid"
import { cn } from "@/lib/utils"

const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "violet"
const dots: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-sky-500",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-red-500",
  violet: "bg-violet-500",
}
const monthStart = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1)

export function EntityCalendar<T>({
  items,
  dateValue,
  getId,
  getLabel,
  getTone = () => "neutral",
  renderItem,
  footerElement,
}: {
  items: T[]
  dateValue: (item: T) => string | undefined
  getId: (item: T) => string
  getLabel: (item: T) => string
  getTone?: (item: T) => Tone
  renderItem: (item: T) => React.ReactNode
  footerElement?: HTMLElement | null
}) {
  const mobile = useIsMobile()
  const root = React.useRef<HTMLElement>(null)
  const [height, setHeight] = React.useState<number | null>(null)
  const [today, setToday] = React.useState(() => calendarDayKey(new Date()))
  const [month, setMonth] = React.useState(() => monthStart(new Date()))
  const [selected, setSelected] = React.useState(() =>
    calendarDayKey(new Date())
  )
  const [open, setOpen] = React.useState(false)
  const [undatedOpen, setUndatedOpen] = React.useState(false)
  React.useEffect(() => {
    const tick = () => setToday(calendarDayKey(new Date()))
    const timer = setInterval(tick, 60000)
    window.addEventListener("focus", tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", tick)
    }
  }, [])
  React.useLayoutEffect(() => {
    const measure = () => {
      const top = root.current?.getBoundingClientRect().top
      if (top === undefined) return
      const foot = footerElement?.getBoundingClientRect().top
      const bottom = Math.min(
        window.innerHeight - 12,
        foot && foot > top ? foot - 12 : window.innerHeight - 12
      )
      setHeight(Math.max(300, Math.floor(bottom - top)))
    }
    const observer = new ResizeObserver(measure)
    if (footerElement) observer.observe(footerElement)
    if (root.current?.parentElement)
      observer.observe(root.current.parentElement)
    const frame = requestAnimationFrame(measure)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", measure)
    }
  }, [footerElement, mobile])
  const indexed = React.useMemo(() => {
    const byDay = new Map<string, T[]>(),
      undated: T[] = []
    for (const item of items) {
      const day = dateValue(item)
      if (!day || !parseCalendarDay(day)) {
        undated.push(item)
        continue
      }
      const bucket = byDay.get(day)
      if (bucket) bucket.push(item)
      else byDay.set(day, [item])
    }
    return { byDay, undated }
  }, [dateValue, items])
  const days = calendarMonthDays(month)
  const weeks = days.length / 7
  const selectedItems = indexed.byDay.get(selected) ?? []
  const selectedDate = parseCalendarDay(selected)
  const selectedTitle = selectedDate
    ? new Intl.DateTimeFormat("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(selectedDate)
    : selected
  const year = new Date().getFullYear()
  const years = [
    ...new Set([
      ...Array.from({ length: 21 }, (_, i) => year - 10 + i),
      month.getFullYear(),
    ]),
  ].sort((a, b) => a - b)
  return (
    <>
      <section
        ref={root}
        aria-label="Календарь записей"
        data-entity-calendar
        className="surface-card flex min-h-0 w-full min-w-0 flex-col overflow-hidden"
        style={{ height: height ?? "calc(100dvh - 13rem)" }}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-1">
            <FieldSelect
              aria-label="Месяц календаря"
              value={String(month.getMonth())}
              onValueChange={(value) =>
                setMonth(new Date(month.getFullYear(), Number(value), 1))
              }
              options={Array.from({ length: 12 }, (_, index) => ({
                value: String(index),
                label: new Intl.DateTimeFormat("ru-RU", {
                  month: "long",
                }).format(new Date(2026, index, 1)),
              }))}
              triggerClassName="w-auto border-0 bg-transparent px-2 font-semibold capitalize"
            />
            <FieldSelect
              aria-label="Год календаря"
              value={String(month.getFullYear())}
              onValueChange={(value) =>
                setMonth(new Date(Number(value), month.getMonth(), 1))
              }
              options={years.map((value) => ({
                value: String(value),
                label: String(value),
              }))}
              triggerClassName="w-auto border-0 bg-transparent px-2 font-semibold"
            />
          </div>
          <nav
            aria-label="Навигация календаря"
            className="flex items-center gap-1"
          >
            {indexed.undated.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setUndatedOpen(true)}
              >
                Без даты · {indexed.undated.length}
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Предыдущий месяц"
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
              }
            >
              <ChevronLeft />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const now = new Date()
                setMonth(monthStart(now))
                setSelected(calendarDayKey(now))
                setToday(calendarDayKey(now))
                setOpen(false)
              }}
            >
              Сегодня
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Следующий месяц"
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
              }
            >
              <ChevronRight />
            </Button>
          </nav>
        </header>
        <div
          className="grid shrink-0 grid-cols-7 border-b bg-muted/25"
          aria-hidden="true"
        >
          {weekdays.map((day, index) => (
            <div
              key={day}
              className={cn(
                "px-1 py-2 text-center text-xs font-medium text-muted-foreground",
                index > 4 && "text-primary"
              )}
            >
              {day}
            </div>
          ))}
        </div>
        <div
          className="grid min-h-0 flex-1 grid-cols-7"
          style={{ gridTemplateRows: `repeat(${weeks},minmax(0,1fr))` }}
        >
          {days.map((date, index) => {
            const key = calendarDayKey(date),
              bucket = indexed.byDay.get(key) ?? [],
              inMonth = date.getMonth() === month.getMonth(),
              isToday = key === today,
              isSelected = key === selected
            const dateLabel = new Intl.DateTimeFormat("ru-RU", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(date)
            return (
              <button
                key={key}
                type="button"
                data-calendar-day={key}
                aria-label={`${dateLabel}${isToday ? ", сегодня" : ""} · записей: ${bucket.length}`}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isSelected}
                className={cn(
                  "group relative flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden border-r border-b border-border/60 p-1.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:p-2",
                  index % 7 > 4 && "bg-muted/15",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                  isSelected &&
                    "bg-primary/10 ring-1 ring-primary/50 ring-inset",
                  isToday && "bg-primary/5"
                )}
                onClick={() => {
                  setSelected(key)
                  if (!inMonth) setMonth(monthStart(date))
                  setOpen(true)
                }}
              >
                <span className="flex w-full min-w-0 shrink-0 items-center justify-between gap-1">
                  <span
                    className={cn(
                      "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums sm:size-8 sm:text-sm",
                      isToday &&
                        "bg-primary font-bold text-primary-foreground shadow-sm",
                      !inMonth && !isToday && "opacity-50"
                    )}
                  >
                    {date.getDate()}
                  </span>
                  {bucket.length > 0 && (
                    <span className="truncate text-[10px] font-semibold text-muted-foreground tabular-nums sm:text-xs">
                      {bucket.length}
                    </span>
                  )}
                </span>
                {mobile ? (
                  <span className="mt-1 flex flex-wrap justify-center gap-1">
                    {bucket.slice(0, 4).map((item) => (
                      <span
                        key={getId(item)}
                        className={cn(
                          "size-1.5 rounded-full",
                          dots[getTone(item)]
                        )}
                      />
                    ))}
                  </span>
                ) : (
                  bucket.slice(0, 3).map((item) => (
                    <span
                      key={getId(item)}
                      className={cn(
                        "block w-full shrink-0 truncate rounded-md border-l-2 px-1.5 py-1 text-[11px] leading-4 font-medium",
                        statusToneClass(getTone(item))
                      )}
                      title={getLabel(item)}
                    >
                      {getLabel(item)}
                    </span>
                  ))
                )}
                {!mobile && bucket.length > 3 && (
                  <span className="text-[11px] text-muted-foreground">
                    Ещё {bucket.length - 3}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(85dvh,var(--mobile-viewport-height,85dvh))] w-[calc(100%-1.5rem)] max-w-2xl! flex-col gap-4 p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="pr-8 capitalize">
              {selectedTitle}
            </DialogTitle>
            <DialogDescription>
              Записей: {selectedItems.length}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain">
            {selectedItems.length ? (
              selectedItems.map((item) => (
                <div key={getId(item)} className="rounded-xl border bg-card">
                  {renderItem(item)}
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                На этот день записей нет.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={undatedOpen} onOpenChange={setUndatedOpen}>
        <DialogContent className="flex max-h-[85dvh] max-w-2xl! flex-col">
          <DialogHeader>
            <DialogTitle>Без даты</DialogTitle>
            <DialogDescription>
              Записей: {indexed.undated.length}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-2 overflow-y-auto">
            {indexed.undated.map((item) => (
              <div key={getId(item)}>{renderItem(item)}</div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
