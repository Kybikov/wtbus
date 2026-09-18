"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { motion, useReducedMotion } from "motion/react"
import {
  Bell,
  CalendarDays,
  Car,
  House,
  Inbox,
  Route,
  Search,
  Settings,
  Ticket,
  User,
  Users,
  Wallet,
  X,
  ListFilter,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  mobileNavigation,
  mobileDockNavigation,
  isMobileDestinationActive,
} from "@/lib/mobile-navigation"
import type { StaffRole } from "@/lib/admin-actions"
import { sessionFetch } from "@/lib/session-navigation"
import { entityDetailHref } from "@/lib/entity-details"
import { cn } from "@/lib/utils"

const icons = {
  home: House,
  calendar: CalendarDays,
  ticket: Ticket,
  inbox: Inbox,
  route: Route,
  car: Car,
  users: Users,
  wallet: Wallet,
  settings: Settings,
  bell: Bell,
  user: User,
}
type Customer = { id: string; fullName: string; phone: string }
type Booking = {
  id: string
  customerName: string
  customerPhone: string
  origin: string
  destination: string
}
type SearchState = {
  customers: Customer[]
  bookings: Booking[]
  loading: boolean
  error: string | null
}
const emptyResults: SearchState = {
  customers: [],
  bookings: [],
  loading: false,
  error: null,
}

// Adapted from the user's licensed React Bits Pro Mobile 3 source.
// Shadcn owns controls, modal focus/keyboard handling and the real CRM result list.
export function MobileDock({
  role,
  localSearch,
}: {
  role: StaffRole
  localSearch?: {
    value: string
    onChange: (value: string) => void
    placeholder: string
    label?: string
  }
}) {
  const pathname = usePathname()
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  const layoutId = React.useId()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<SearchState>(emptyResults)
  const [viewport, setViewport] = React.useState({ bottom: 0, height: 600 })
  const searchTrigger = React.useRef<HTMLButtonElement>(null)
  const destinations = mobileNavigation(role)
  const matches = destinations.filter((item) =>
    item.label
      .toLocaleLowerCase("ru")
      .includes(query.trim().toLocaleLowerCase("ru"))
  )

  React.useEffect(() => {
    const view = window.visualViewport
    const update = () =>
      setViewport({
        bottom: Math.max(
          0,
          window.innerHeight -
            (view?.height ?? window.innerHeight) -
            (view?.offsetTop ?? 0)
        ),
        height: view?.height ?? window.innerHeight,
      })
    update()
    view?.addEventListener("resize", update)
    view?.addEventListener("scroll", update)
    window.addEventListener("resize", update)
    return () => {
      view?.removeEventListener("resize", update)
      view?.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [])
  React.useEffect(() => {
    const value = query.trim()
    if (!open || value.length < 2 || role === "driver") return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const [customerResponse, bookingResponse] = await Promise.all([
          sessionFetch(
            `/api/customers?q=${encodeURIComponent(value)}&limit=6`,
            { signal: controller.signal, cache: "no-store" }
          ),
          sessionFetch(`/api/bookings?q=${encodeURIComponent(value)}&limit=6`, {
            signal: controller.signal,
            cache: "no-store",
          }),
        ])
        if (!customerResponse.ok || !bookingResponse.ok)
          throw new Error("Не удалось выполнить поиск. Повторите попытку.")
        const [customers, bookings] = await Promise.all([
          customerResponse.json(),
          bookingResponse.json(),
        ])
        if (!controller.signal.aborted)
          setResults({
            customers: Array.isArray(customers.items) ? customers.items : [],
            bookings: Array.isArray(bookings.items) ? bookings.items : [],
            loading: false,
            error: null,
          })
      } catch (error) {
        if (!controller.signal.aborted)
          setResults({
            ...emptyResults,
            error:
              error instanceof Error
                ? error.message
                : "Нет соединения. Повторите поиск.",
          })
      }
    }, 250)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [open, query, role])

  function changeQuery(value: string) {
    setQuery(value)
    setResults({
      ...emptyResults,
      loading: value.trim().length >= 2 && role !== "driver",
    })
  }
  function changeOpen(value: boolean) {
    setOpen(value)
    if (!value) {
      setQuery("")
      setResults(emptyResults)
    }
  }
  function navigate(href: string) {
    changeOpen(false)
    router.push(href)
  }
  const keyboardOpen = viewport.bottom > 120

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <div
        className={cn(
          "mobile-dock pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 md:hidden",
          (open || keyboardOpen) && "invisible"
        )}
      >
        <motion.nav
          aria-label="Основная навигация"
          layout={!reduceMotion}
          layoutId={`${layoutId}-dock-frame`}
          className="pointer-events-auto flex h-14 items-center gap-1 rounded-full border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur-md"
        >
          {mobileDockNavigation(role).map((item) => {
            const active = isMobileDestinationActive(pathname, item.href)
            const Icon = icons[item.icon]
            return (
              <Button
                key={item.href}
                render={<Link href={item.href} />}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                variant="ghost"
                size="icon-lg"
                className={cn(
                  "relative size-11 rounded-full",
                  active &&
                    "text-primary-foreground hover:text-primary-foreground"
                )}
              >
                {active ? (
                  <motion.span
                    aria-hidden
                    layoutId={`${layoutId}-active`}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: "spring", bounce: 0, duration: 0.35 }
                    }
                    className="absolute inset-0 rounded-full bg-primary"
                  />
                ) : null}
                <Icon aria-hidden className="relative size-5" />
              </Button>
            )
          })}
          <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />
          <DialogTrigger
            render={
              <Button
                ref={searchTrigger}
                aria-label="Поиск и все разделы"
                size="icon-lg"
                variant="ghost"
                className="size-11 rounded-full"
              />
            }
          >
            <Search className="size-5" />
          </DialogTrigger>
        </motion.nav>
      </div>
      <DialogContent
        showCloseButton={false}
        finalFocus={searchTrigger}
        className="mobile-dock-search top-auto! right-4! left-4! w-auto! max-w-none! translate-x-0! translate-y-0! gap-0 rounded-none! bg-transparent! p-0! shadow-none! ring-0! md:hidden"
        style={{
          bottom: `calc(${viewport.bottom}px + max(16px, env(safe-area-inset-bottom)))`,
          maxHeight: Math.max(140, viewport.height - 32),
        }}
      >
        <DialogTitle className="sr-only">Поиск и разделы CRM</DialogTitle>
        <DialogDescription className="sr-only">
          Найдите раздел, пассажира или бронирование. Результаты расположены над
          полем поиска.
        </DialogDescription>
        <Command
          shouldFilter={false}
          className="flex h-auto max-h-[inherit] flex-col-reverse gap-2 overflow-visible rounded-none bg-transparent p-0"
        >
          <motion.div
            layoutId={`${layoutId}-dock-frame`}
            layout={!reduceMotion}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.25 }}
            className="flex h-14 shrink-0 items-center rounded-full border border-border bg-popover p-1.5 shadow-lg"
          >
            <CommandInput
              autoFocus
              maxLength={120}
              value={query}
              onValueChange={changeQuery}
              aria-label="Поиск в CRM"
              placeholder={
                role === "driver"
                  ? "Найти раздел…"
                  : "Имя, телефон, бронь или раздел…"
              }
              className="text-base"
            />
            <Button
              aria-label="Закрыть поиск"
              variant="ghost"
              size="icon-lg"
              className="size-11 shrink-0 rounded-full"
              onClick={() => changeOpen(false)}
            >
              <X className="size-5" />
            </Button>
          </motion.div>
          <CommandList
            aria-busy={results.loading}
            className="max-h-[min(55dvh,26rem)] min-h-0 rounded-2xl border border-border bg-popover p-1.5 shadow-lg"
          >
            {localSearch && query.trim() ? (
              <CommandGroup heading="ЭТА СТРАНИЦА">
                <CommandItem
                  value="filter-page"
                  onSelect={() => {
                    localSearch.onChange(query.trim())
                    changeOpen(false)
                  }}
                >
                  <ListFilter />
                  <span className="min-w-0 truncate">
                    Искать «{query.trim()}» на странице
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {localSearch?.value && !query ? (
              <CommandGroup heading="ФИЛЬТР СТРАНИЦЫ">
                <CommandItem
                  value="clear-page"
                  onSelect={() => {
                    localSearch.onChange("")
                    changeOpen(false)
                  }}
                >
                  <X />
                  Сбросить поиск на странице
                </CommandItem>
              </CommandGroup>
            ) : null}
            {matches.length ? (
              <CommandGroup heading="РАЗДЕЛЫ">
                {matches.map((item) => {
                  const Icon = icons[item.icon]
                  return (
                    <CommandItem
                      key={item.href}
                      value={item.href}
                      onSelect={() => navigate(item.href)}
                    >
                      <Icon />
                      {item.label}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
            {results.loading ? (
              <p role="status" className="p-4 text-sm text-muted-foreground">
                Ищем…
              </p>
            ) : null}
            {results.error ? (
              <p role="alert" className="p-4 text-sm text-destructive">
                {results.error}
              </p>
            ) : null}
            {results.customers.length ? (
              <CommandGroup heading="КЛИЕНТЫ">
                {results.customers.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`customer:${item.id}`}
                    onSelect={() =>
                      navigate(entityDetailHref("customers", item.id))
                    }
                  >
                    <User />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {item.fullName}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {item.phone}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.bookings.length ? (
              <CommandGroup heading="БРОНИРОВАНИЯ">
                {results.bookings.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`booking:${item.id}`}
                    onSelect={() =>
                      navigate(entityDetailHref("bookings", item.id))
                    }
                  >
                    <Ticket />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {item.origin} → {item.destination}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.customerName} · {item.customerPhone}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {!results.loading &&
            !results.error &&
            !matches.length &&
            !results.customers.length &&
            !results.bookings.length ? (
              <p role="status" className="p-4 text-sm text-muted-foreground">
                Ничего не найдено.
              </p>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
