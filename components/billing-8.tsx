"use client"
// Activity timeline adapted from React Bits Pro billing-8 for recorded tenant events.
import {
  Bot,
  CircleCheck,
  FilePlus2,
  GitBranch,
  Link2,
  LogIn,
  LogOut,
  Mail,
  Pencil,
  Trash2,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { activityActions, activityFieldNames } from "@/lib/activity-labels"
import { entityNames } from "@/lib/entity-details"
import type { EntityCollection } from "@/lib/entity-views"
import { formatEntityDate } from "@/lib/entity-columns"

export type EntityActivityEvent = {
  action: string
  actor: string
  kind: string
  changedFields?: string[]
  createdAt: string
}

function presentation(
  event: EntityActivityEvent,
  entity?: EntityCollection
): { title: string; icon: LucideIcon; color: string } {
  const fields = event.changedFields ?? []
  if (event.action === "record_created")
    return {
      title: entity
        ? `${entityNames[entity]} создан${["bookings"].includes(entity) ? "о" : ["requests", "availability"].includes(entity) ? "а" : ""}`
        : "Создана запись",
      icon: FilePlus2,
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    }
  if (event.action === "record_deleted")
    return {
      title: "Запись удалена",
      icon: Trash2,
      color: "bg-red-500/10 text-red-600 dark:text-red-400",
    }
  if (event.action === "record_updated" && fields.includes("status"))
    return {
      title: "Статус изменён",
      icon: GitBranch,
      color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    }
  if (
    event.action === "record_updated" &&
    fields.some((key) => ["route_id", "vehicle_id", "driver_id"].includes(key))
  )
    return {
      title: "Назначение изменено",
      icon: Link2,
      color: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    }
  if (event.action.startsWith("payment"))
    return {
      title: activityActions[event.action] ?? "Действие с оплатой",
      icon: Wallet,
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    }
  if (event.action.includes("notification"))
    return {
      title: activityActions[event.action] ?? "Уведомление",
      icon: Mail,
      color: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    }
  if (event.action === "session_started" || event.action === "session_ended")
    return {
      title: activityActions[event.action],
      icon: event.action === "session_started" ? LogIn : LogOut,
      color: "bg-muted text-muted-foreground",
    }
  if (event.action.includes("checked") || event.action.includes("reconciled"))
    return {
      title: activityActions[event.action] ?? "Проверка выполнена",
      icon: CircleCheck,
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    }
  return {
    title: activityActions[event.action] ?? "Действие с записью",
    icon: Pencil,
    color: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  }
}

export default function EntityActivityTimeline({
  events,
  timezone,
  entity,
}: {
  events: EntityActivityEvent[]
  timezone: string
  entity?: EntityCollection
}) {
  if (!events.length)
    return (
      <p className="py-3 text-sm text-muted-foreground">
        Действий пока не зарегистрировано.
      </p>
    )
  const date = (value: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(value))
  const time = (value: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value))
  return (
    <ol className="min-w-0">
      {events.map((event, index) => {
        const day = date(event.createdAt)
        const { title, icon: Icon, color } = presentation(event, entity)
        const ActorIcon = event.kind === "system" ? Bot : UserRound
        return (
          <li
            key={`${event.createdAt}:${event.action}:${index}`}
            className="min-w-0"
          >
            {(index === 0 || day !== date(events[index - 1].createdAt)) && (
              <p className="py-3 text-xs font-medium text-muted-foreground first:pt-0">
                {day}
              </p>
            )}
            <div className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t border-border/70 py-3.5 @min-[30rem]:grid-cols-[2rem_minmax(7rem,0.85fr)_minmax(0,1.15fr)_auto]">
              <span
                aria-hidden
                className={`row-span-2 grid size-8 shrink-0 place-items-center rounded-lg ${color}`}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p className="text-sm leading-5 font-medium">{title}</p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ActorIcon aria-hidden className="size-3 shrink-0" />
                  {event.actor}
                </p>
              </div>
              <p className="col-start-2 row-start-2 min-w-0 text-xs leading-5 [overflow-wrap:anywhere] text-muted-foreground @min-[30rem]:col-start-3 @min-[30rem]:row-start-1">
                {activityFieldNames(event.changedFields)}
              </p>
              <time
                dateTime={event.createdAt}
                title={formatEntityDate(event.createdAt, timezone)}
                className="col-start-3 row-start-1 text-xs leading-5 whitespace-nowrap text-muted-foreground tabular-nums @min-[30rem]:col-start-4"
              >
                {time(event.createdAt)}
              </time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
