"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { ActivityChanges } from "@/components/activity-changes"
import type { ActivityChange } from "@/lib/activity-changes"
import { InfiniteSentinel } from "@/components/infinite-sentinel"
import { History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { sessionFetch } from "@/lib/session-navigation"
import { realtimeEvent, type RealtimeMessage } from "@/lib/realtime"
import {
  activityActions,
  activityEntities,
  activityFieldNames,
} from "@/lib/activity-labels"
type Entry = {
  id: string
  actor: string
  action: string
  entity: string
  entityId?: string
  createdAt: string
  changedFields?: string[]
  changes?: ActivityChange[]
  submittedFields?: string[]
  status?: number
  durationMs?: number
  requestId?: string
}
const linked = new Set([
  "routes",
  "trips",
  "bookings",
  "customers",
  "team",
  "fleet",
  "requests",
])
export function ActivityHistory({ role }: { role?: string }) {
  const [kind, setKind] = useState("activity")
  const [before, setBefore] = useState<string>()
  const [data, setData] = useState<{ items: Entry[]; hasMore: boolean }>({
    items: [],
    hasMore: false,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const query = new URLSearchParams({ kind })
        if (before) query.set("before", before)
        const response = await sessionFetch(`/api/activity?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        })
        const payload = await response.json()
        if (!response.ok || !Array.isArray(payload?.items))
          throw Error(payload?.error ?? "Не удалось загрузить журнал.")
        if (!controller.signal.aborted) {
          setData((current) =>
            before
              ? {
                  ...payload,
                  items: [
                    ...current.items,
                    ...payload.items.filter(
                      (item: Entry) =>
                        !current.items.some((old) => old.id === item.id)
                    ),
                  ],
                }
              : payload
          )
          setError(undefined)
        }
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить журнал."
          )
      } finally {
        busy = false
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    const refresh = () => {
      if (!before && document.visibilityState === "visible") {
        clearTimeout(timer)
        timer = setTimeout(() => void load(), 400)
      }
    }
    const realtime = (event: Event) => {
      const message = (event as CustomEvent<RealtimeMessage>).detail
      if (message?.type === "ready" || message?.entity === "activity_events")
        refresh()
    }
    void load()
    const interval = setInterval(refresh, 30_000)
    window.addEventListener(realtimeEvent, realtime)
    window.addEventListener("focus", refresh)
    const forceRefresh = () => {
      setBefore(undefined)
      if (!before) refresh()
    }
    window.addEventListener("vivat-settings-refresh", forceRefresh)
    return () => {
      controller.abort()
      clearTimeout(timer)
      clearInterval(interval)
      window.removeEventListener(realtimeEvent, realtime)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("vivat-settings-refresh", forceRefresh)
    }
  }, [kind, before])
  function select(next: string) {
    setKind(next)
    setBefore(undefined)
    setData({ items: [], hasMore: false })
    setLoading(true)
  }
  return (
    <section className="settings-panel min-w-0" aria-busy={loading}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <History className="size-4 text-primary" />
          Журнал действий
        </h2>
        {(role === "owner" || role === "developer") && (
          <div
            className="flex gap-1 rounded-xl bg-control p-1"
            aria-label="Тип журнала"
          >
            <Button
              size="sm"
              variant={kind === "activity" ? "secondary" : "ghost"}
              onClick={() => select("activity")}
            >
              Действия
            </Button>
            <Button
              size="sm"
              variant={kind === "requests" ? "secondary" : "ghost"}
              onClick={() => select("requests")}
            >
              Запросы API
            </Button>
          </div>
        )}
      </header>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-5 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-normal">Сотрудник</th>
              <th className="px-4 py-3 font-normal">
                {kind === "requests" ? "Запрос" : "Действие"}
              </th>
              <th className="px-4 py-3 font-normal">
                {kind === "requests" ? "Результат" : "Раздел"}
              </th>
              <th className="px-4 py-3 font-normal whitespace-nowrap">
                Дата и время
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.items.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-3 align-top">{entry.actor}</td>
                <td className="max-w-md px-4 py-3 align-top">
                  <p
                    className={
                      kind === "requests"
                        ? "font-mono text-xs break-all"
                        : "font-medium"
                    }
                  >
                    {kind === "requests"
                      ? `${entry.action} ${entry.entity.replace(/^[A-Z]+ /, "")}`
                      : (activityActions[entry.action] ?? "Действие с записью")}
                  </p>
                  {kind === "activity" && !!entry.changes?.length && (
                    <div className="mt-2">
                      <ActivityChanges
                        changes={entry.changes}
                        timezone={
                          Intl.DateTimeFormat().resolvedOptions().timeZone
                        }
                      />
                    </div>
                  )}
                  {kind === "activity" &&
                    !!(
                      entry.changedFields?.length ||
                      entry.submittedFields?.length
                    ) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {activityFieldNames(
                          (
                            entry.changedFields ??
                            entry.submittedFields ??
                            []
                          ).filter(
                            (field) =>
                              !entry.changes?.some(
                                (change) => change.field === field
                              )
                          )
                        )}
                      </p>
                    )}
                </td>
                <td className="px-4 py-3 align-top">
                  {kind === "requests" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          (entry.status ?? 0) >= 400
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {entry.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {entry.durationMs} мс
                      </span>
                    </div>
                  ) : entry.entityId && linked.has(entry.entity) ? (
                    <Link
                      href={`/${entry.entity}/${entry.entityId}`}
                      className="underline decoration-border underline-offset-4 hover:text-primary"
                    >
                      {activityEntities[entry.entity] ?? "Запись"}
                    </Link>
                  ) : (
                    (activityEntities[entry.entity] ?? "Компания")
                  )}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString("ru-RU")}
                  </time>
                </td>
              </tr>
            ))}
            {!data.items.length && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  {loading ? "Загружаем…" : "Записей пока нет."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <InfiniteSentinel
        hasMore={data.hasMore}
        loading={loading}
        version={data.items.length}
        onMore={() => {
          setBefore(data.items.at(-1)?.id)
          setLoading(true)
        }}
      />
    </section>
  )
}
