"use client"
// Activity timeline extracted from React Bits Pro billing-8.
// Demo invoice data and actions are replaced by tenant-scoped recorded events.
import { Badge } from "@/components/ui/badge"
import { formatEntityDate } from "@/lib/entity-columns"

export type EntityActivityEvent = {
  action: string
  actor: string
  kind: string
  createdAt: string
}

export default function EntityActivityTimeline({
  events,
  timezone,
}: {
  events: EntityActivityEvent[]
  timezone: string
}) {
  if (!events.length)
    return (
      <p className="text-sm text-muted-foreground">
        Действий пока не зарегистрировано.
      </p>
    )
  return (
    <ol className="space-y-3.5">
      {events.map((event, index) => (
        <li
          key={`${event.createdAt}:${event.action}:${index}`}
          className="flex gap-3"
        >
          <span aria-hidden className="relative flex flex-col items-center">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            {index < events.length - 1 && (
              <span className="mt-1 w-px flex-1 bg-border" />
            )}
          </span>
          <div className="min-w-0 pb-0.5 [overflow-wrap:anywhere]">
            <p className="text-sm font-medium">
              {event.action === "public_booking_created"
                ? "Бронирование создано на сайте"
                : event.action.replaceAll("_", " ")}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{event.actor}</span>
              {event.kind === "system" && (
                <Badge variant="secondary" className="text-xs">
                  Автоматизация
                </Badge>
              )}
            </div>
            <time
              dateTime={event.createdAt}
              className="mt-1 block text-xs text-muted-foreground tabular-nums"
            >
              {formatEntityDate(event.createdAt, timezone)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  )
}
