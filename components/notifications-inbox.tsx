"use client"
// React Bits Pro notifications-6: bell counter, All/Unread filter, compact
// event rows and notification-center action, backed by the CRM inbox API.
import * as React from "react"
import Link from "next/link"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  Bell,
  BellOff,
  CalendarDays,
  CheckCheck,
  CircleDollarSign,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Ticket,
  UsersRound,
} from "lucide-react"
import { toast } from "sonner"
import { sessionFetch } from "@/lib/session-navigation"
import { realtimeEvent } from "@/lib/realtime"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
type Notice = {
  id: string
  title: string
  body: string
  url: string
  category: string
  createdAt: string
  readAt: string | null
}
const paths = new Set([
  "/requests",
  "/bookings",
  "/trips",
  "/driver",
  "/finance",
  "/profile",
  "/team",
])
function useInbox(unreadOnly = false) {
  const [items, setItems] = React.useState<Notice[]>([])
  const [unread, setUnread] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [next, setNext] = React.useState("")
  const [moreLoading, setMoreLoading] = React.useState(false)
  const [reading, setReading] = React.useState(false)
  const inFlight = React.useRef(false)
  const paginated = React.useRef(false)
  const generation = React.useRef(0)
  const active = React.useRef<AbortController | null>(null)
  const loadPage = React.useCallback(
    async (cursor = "") => {
      if (inFlight.current) return
      inFlight.current = true
      const version = generation.current
      const controller = new AbortController()
      active.current = controller
      try {
        const query = new URLSearchParams()
        if (cursor) query.set("before", cursor)
        if (unreadOnly) query.set("unread", "1")
        const response = await sessionFetch(`/api/notifications?${query}`, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        })
        const payload = await response.json()
        if (
          !response.ok ||
          !Array.isArray(payload?.items) ||
          typeof payload.unread !== "number"
        )
          throw new Error()
        if (version !== generation.current) return
        const valid = payload.items.filter(
          (item: Notice) =>
            typeof item?.id === "string" &&
            typeof item.title === "string" &&
            typeof item.body === "string" &&
            typeof item.createdAt === "string" &&
            paths.has(item.url)
        ) as Notice[]
        if (cursor) paginated.current = true
        setItems((current) =>
          cursor
            ? [
                ...current,
                ...valid.filter(
                  (item) => !current.some((old) => old.id === item.id)
                ),
              ]
            : paginated.current
              ? [
                  ...valid,
                  ...current.filter(
                    (item) => !valid.some((fresh) => fresh.id === item.id)
                  ),
                ]
              : valid
        )
        setUnread(payload.unread)
        if (cursor || !paginated.current)
          setNext(typeof payload.next === "string" ? payload.next : "")
        setError(null)
      } catch {
        if (!controller.signal.aborted && version === generation.current)
          setError("Не удалось загрузить уведомления.")
      } finally {
        if (version === generation.current) {
          setLoading(false)
          inFlight.current = false
        }
      }
    },
    [unreadOnly]
  )
  const load = React.useCallback(() => loadPage(), [loadPage])
  React.useEffect(() => {
    generation.current++
    active.current?.abort()
    inFlight.current = false
    paginated.current = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void load(), 300)
    }
    timer = setTimeout(() => {
      setLoading(true)
      void load()
    }, 0)
    window.addEventListener(realtimeEvent, refresh)
    window.addEventListener("vivat-notifications-changed", refresh)
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh()
    }, 60000)
    return () => {
      clearTimeout(timer)
      clearInterval(poll)
      active.current?.abort()
      window.removeEventListener(realtimeEvent, refresh)
      window.removeEventListener("vivat-notifications-changed", refresh)
    }
  }, [load])
  async function more() {
    setMoreLoading(true)
    try {
      await loadPage(next)
    } finally {
      setMoreLoading(false)
    }
  }
  async function read(id?: string) {
    setReading(true)
    try {
      const response = await sessionFetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : { all: true }),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok)
        throw new Error("Не удалось отметить уведомления прочитанными.")
      const marked = items.filter(
        (item) => !item.readAt && (!id || item.id === id)
      ).length
      setItems((current) =>
        current.map((item) =>
          !id || item.id === id
            ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
            : item
        )
      )
      setUnread((current) => (id ? Math.max(0, current - marked) : 0))
      window.dispatchEvent(new Event("vivat-notifications-changed"))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось обновить уведомления."
      )
    } finally {
      setReading(false)
    }
  }
  return {
    items: unreadOnly ? items.filter((item) => !item.readAt) : items,
    unread,
    loading,
    error,
    load,
    read,
    next,
    more,
    moreLoading,
    reading,
  }
}
function ago(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000)
  )
  return minutes < 1
    ? "сейчас"
    : minutes < 60
      ? `${minutes} мин`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)} ч`
        : new Date(value).toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "short",
          })
}
function InboxItems({
  inbox,
  compact,
  onSelect,
}: {
  inbox: ReturnType<typeof useInbox>
  compact?: boolean
  onSelect?: () => void
}) {
  return (
    <div>
      {inbox.loading ? (
        <p className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Загружаем…
        </p>
      ) : null}
      {inbox.error ? (
        <div className="space-y-2 p-4 text-center">
          <p className="text-sm text-muted-foreground" role="status">
            {inbox.error}
          </p>
          <Button variant="ghost" size="sm" onClick={() => void inbox.load()}>
            <RefreshCw />
            Повторить
          </Button>
        </div>
      ) : null}
      {!inbox.loading && !inbox.error && !inbox.items.length ? (
        <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
          <BellOff className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Новых уведомлений нет</p>
          <p className="text-xs text-muted-foreground">
            Здесь появятся события, доступные вашей роли.
          </p>
        </div>
      ) : null}
      <ul className="space-y-1">
        {inbox.items.map((item) => {
          const Icon =
            item.category === "newBookings"
              ? Ticket
              : item.category === "trips"
                ? CalendarDays
                : item.category === "payments"
                  ? CircleDollarSign
                  : item.category === "team"
                    ? UsersRound
                    : Bell
          return (
            <li key={item.id}>
              <Link
                href={item.url}
                onClick={() => {
                  void inbox.read(item.id)
                  onSelect?.()
                }}
                className={cn(
                  "flex min-w-0 items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                  !item.readAt && "bg-primary/5"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg",
                    item.readAt
                      ? "text-muted-foreground"
                      : "bg-primary/10 text-primary"
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm leading-5",
                      !item.readAt && "font-semibold"
                    )}
                  >
                    {!item.readAt ? (
                      <span className="sr-only">Не прочитано: </span>
                    ) : null}
                    {item.title}
                  </span>
                  {!compact ? (
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {item.body}
                    </span>
                  ) : null}
                </span>
                <time
                  className="mt-0.5 shrink-0 text-[11px] text-muted-foreground"
                  dateTime={item.createdAt}
                  title={new Date(item.createdAt).toLocaleString("ru-RU")}
                >
                  {ago(item.createdAt)}
                </time>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
function InboxFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(String(next))}>
      <TabsList className="rounded-lg">
        <TabsTrigger value="all" className="flex-none rounded-md px-2.5 text-xs">
          Все
        </TabsTrigger>
        <TabsTrigger value="unread" className="flex-none rounded-md px-2.5 text-xs">
          Непрочитанные
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
export function NotificationsBell() {
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState("all")
  const inbox = useInbox(filter === "unread")
  const reduce = useReducedMotion()
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) void inbox.load()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            aria-label={`Уведомления${inbox.unread ? `: ${inbox.unread} непрочитанных` : ""}`}
            className="relative size-11 rounded-xl md:size-9"
            size="icon-lg"
            variant="ghost"
          />
        }
      >
        <Bell className="size-4" />
        <AnimatePresence initial={false}>
          {inbox.unread ? (
            <motion.span
              key="unread"
              initial={reduce ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.16 }}
              aria-hidden
              className="absolute top-0 right-0 flex h-4 min-w-4 items-center justify-center rounded-md bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
            >
              {inbox.unread > 99 ? "99+" : inbox.unread}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(23rem,calc(100vw-2rem))] gap-0 p-2"
        aria-label="Уведомления"
      >
        <div className="flex flex-wrap items-center justify-between gap-1 px-1 pb-2">
          <InboxFilter value={filter} onChange={setFilter} />
          <Button
            variant="ghost"
            size="sm"
            disabled={!inbox.unread || inbox.reading}
            aria-label="Прочитать все уведомления"
            title="Прочитать все"
            onClick={() => void inbox.read()}
          >
            <CheckCheck />
            <span className="hidden text-xs sm:inline">Прочитать все</span>
          </Button>
        </div>
        <ScrollArea
          className="h-[min(22rem,50dvh,var(--inbox-height))]"
          style={
            {
              "--inbox-height": `${Math.max(144, inbox.items.length * 72 + (inbox.next ? 44 : 0))}px`,
            } as React.CSSProperties
          }
        >
          <InboxItems inbox={inbox} compact onSelect={() => setOpen(false)} />
          {inbox.next ? (
            <Button
              className="mt-1 w-full"
              size="sm"
              variant="ghost"
              disabled={inbox.moreLoading}
              onClick={() => void inbox.more()}
            >
              {inbox.moreLoading ? "Загружаем…" : "Показать ещё"}
            </Button>
          ) : null}
        </ScrollArea>
        <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
          <Button
            nativeButton={false}
            className="min-w-0 flex-1"
            size="sm"
            variant="outline"
            onClick={() => setOpen(false)}
            render={<Link href="/notifications" />}
          >
            <Inbox />
            Центр уведомлений
          </Button>
          <Button
            nativeButton={false}
            size="icon-sm"
            variant="ghost"
            aria-label="Настройки уведомлений"
            onClick={() => setOpen(false)}
            render={<Link href="/profile/notifications" />}
          >
            <Settings2 />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
export function NotificationsInboxContent() {
  const [filter, setFilter] = React.useState("all")
  const inbox = useInbox(filter === "unread")
  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InboxFilter value={filter} onChange={setFilter} />
        <Button
          variant="outline"
          disabled={!inbox.unread || inbox.reading}
          onClick={() => void inbox.read()}
        >
          <CheckCheck />
          Прочитать все
        </Button>
      </div>
      <InboxItems inbox={inbox} />
      {inbox.next ? (
        <Button
          variant="outline"
          disabled={inbox.moreLoading}
          onClick={() => void inbox.more()}
        >
          {inbox.moreLoading ? "Загружаем…" : "Показать ещё"}
        </Button>
      ) : null}
    </div>
  )
}
