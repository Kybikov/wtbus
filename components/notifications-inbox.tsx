"use client"
import * as React from "react"
import Link from "next/link"
import { Bell } from "lucide-react"
import { sessionFetch } from "@/lib/session-navigation"
import { realtimeEvent } from "@/lib/realtime"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"

type Notice = {
  id: string
  title: string
  body: string
  url: string
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
])
function useInbox() {
  const [items, setItems] = React.useState<Notice[]>([])
  const [unread, setUnread] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [next, setNext] = React.useState("")
  const [moreLoading, setMoreLoading] = React.useState(false)
  const inFlight = React.useRef(false)
  const paginated = React.useRef(false)
  const loadPage = React.useCallback(async (cursor = "") => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const response = await sessionFetch(
        `/api/notifications${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(10_000) }
      )
      const payload = await response.json()
      if (
        !response.ok ||
        !Array.isArray(payload?.items) ||
        typeof payload.unread !== "number"
      )
        throw new Error()
      const valid = payload.items.filter(
        (item: Notice) =>
          typeof item?.id === "string" &&
          typeof item.title === "string" &&
          typeof item.body === "string" &&
          typeof item.createdAt === "string" &&
          paths.has(item.url)
      )
      if (cursor) paginated.current = true
      setItems((current) =>
        cursor
          ? [
              ...current,
              ...valid.filter(
                (item: Notice) => !current.some((old) => old.id === item.id)
              ),
            ]
          : paginated.current
            ? [
                ...valid,
                ...current.filter(
                  (item) => !valid.some((fresh: Notice) => fresh.id === item.id)
                ),
              ]
            : valid
      )
      setUnread(payload.unread)
      if (cursor || !paginated.current)
        setNext(typeof payload.next === "string" ? payload.next : "")
      setError(null)
    } catch {
      setError("Не удалось загрузить уведомления.")
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [])
  const load = React.useCallback(() => loadPage(), [loadPage])
  async function more() {
    setMoreLoading(true)
    try {
      await loadPage(next)
    } finally {
      setMoreLoading(false)
    }
  }
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void load(), 300)
    }
    refresh()
    window.addEventListener(realtimeEvent, refresh)
    window.addEventListener("vivat-notifications-changed", refresh)
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh()
    }, 60_000)
    return () => {
      clearTimeout(timer)
      clearInterval(poll)
      window.removeEventListener(realtimeEvent, refresh)
      window.removeEventListener("vivat-notifications-changed", refresh)
    }
  }, [load])
  async function read(id?: string) {
    const response = await sessionFetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : { all: true }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      setError("Не удалось отметить прочитанным.")
      return
    }
    setItems((current) =>
      current.map((item) =>
        !id || item.id === id
          ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
          : item
      )
    )
    window.dispatchEvent(new Event("vivat-notifications-changed"))
    await load()
  }
  return { items, unread, loading, error, load, read, next, more, moreLoading }
}
function InboxItems({ inbox }: { inbox: ReturnType<typeof useInbox> }) {
  return (
    <div className="space-y-1">
      {inbox.loading ? (
        <p className="p-3 text-sm text-muted-foreground">Загружаем…</p>
      ) : null}
      {inbox.error ? (
        <p role="status" className="p-3 text-sm text-destructive">
          {inbox.error}
        </p>
      ) : null}
      {!inbox.loading && !inbox.error && !inbox.items.length ? (
        <p className="p-3 text-sm text-muted-foreground">
          Уведомлений пока нет.
        </p>
      ) : null}
      {inbox.items.map((item) => (
        <Button
          key={item.id}
          render={<Link href={item.url} />}
          variant="ghost"
          onClick={() => void inbox.read(item.id).catch(() => {})}
          className={`h-auto w-full flex-col items-start gap-0 rounded-lg p-3 text-left whitespace-normal ${!item.readAt ? "bg-primary/5" : ""}`}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            {!item.readAt ? (
              <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            ) : null}
            {item.title}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {item.body}
          </span>
          <time
            dateTime={item.createdAt}
            className="mt-1 block text-[11px] text-muted-foreground"
          >
            {new Date(item.createdAt).toLocaleString("ru-RU", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </Button>
      ))}
    </div>
  )
}
export function NotificationsBell() {
  const inbox = useInbox()
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) void inbox.load()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            aria-label={`Уведомления${inbox.unread ? `: ${inbox.unread} непрочитанных` : ""}`}
            className="relative size-9 rounded-lg"
            size="icon-lg"
            variant="ghost"
          />
        }
      >
        <Bell className="size-4" />
        {inbox.unread ? (
          <span className="absolute top-0 right-0 flex min-w-4 items-center justify-center rounded-md bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {inbox.unread > 99 ? "99+" : inbox.unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-2rem))] p-2"
      >
        <div className="flex items-center justify-between gap-2 p-2">
          <span className="text-sm font-semibold">Уведомления</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={!inbox.unread}
            onClick={() => void inbox.read().catch(() => {})}
          >
            Прочитать все
          </Button>
        </div>
        <ScrollArea className="h-[min(24rem,55dvh)]">
          <InboxItems inbox={inbox} />
        </ScrollArea>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <Button
            size="sm"
            variant="ghost"
            render={<Link href="/notifications" />}
          >
            Вся история
          </Button>
          <Button size="sm" variant="ghost" render={<Link href="/profile" />}>
            Настроить push
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
export function NotificationsInboxContent() {
  const inbox = useInbox()
  return (
    <div className="space-y-3 p-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          disabled={!inbox.unread}
          onClick={() => void inbox.read().catch(() => {})}
        >
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
