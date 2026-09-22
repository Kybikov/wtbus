"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarDays, MapPin, TicketCheck, Users } from "lucide-react"
import { AdminNotice } from "@/components/admin-notice"
import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { EntityDataView } from "@/components/entity-data-view"
import {
  textColumn,
  numberColumn,
  dateColumn,
  statusColumn,
} from "@/lib/entity-columns"
import { usePageSearch } from "@/hooks/use-page-search"
import { useEntitySelection } from "@/hooks/use-entity-selection"

type RequestStatus =
  | "new"
  | "in_progress"
  | "awaiting_trip"
  | "booking_created"
  | "closed"
  | "cancelled"

type TransferRequest = {
  id: string
  customerId: string
  telegramId?: number
  status: RequestStatus
  origin: string
  destination: string
  requestedDepartureAt: string
  passengerName: string
  passengerPhone: string
  passengerBirthDate: string
  seats: number
  comment?: string
  operatorNote?: string
  createdAt: string
  updatedAt: string
  bookingId?: string
}

type RequestCollection = {
  items: TransferRequest[]
  timezone: string
  total: number
}

const statusLabels: Record<RequestStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  awaiting_trip: "Подбор рейса",
  booking_created: "Бронь создана",
  closed: "Закрыта без брони",
  cancelled: "Отклонена",
}

const requestTones: Record<
  RequestStatus,
  "neutral" | "info" | "warning" | "success" | "danger" | "violet"
> = {
  new: "info",
  in_progress: "warning",
  awaiting_trip: "violet",
  booking_created: "success",
  closed: "neutral",
  cancelled: "danger",
}

const requestDescriptions: Record<RequestStatus, string> = {
  new: "Новые обращения, которые ещё не взял диспетчер",
  in_progress: "Диспетчер уточняет детали поездки",
  awaiting_trip: "Нужно подобрать подходящий рейс",
  booking_created: "Заявка уже связана с бронированием",
  closed: "Обращение закрыто без создания брони",
  cancelled: "Клиент отказался или заявка отклонена",
}

const requestBadgeClasses: Record<RequestStatus, string> = {
  new: "status-sky",
  in_progress: "status-gold",
  awaiting_trip: "status-violet",
  booking_created: "bg-emerald-500/15 text-emerald-400",
  closed: "status-slate",
  cancelled: "bg-destructive/15 text-destructive",
}

function canMoveRequest(current: RequestStatus, next: RequestStatus) {
  if (current === next) return true
  if (current === "new") return next === "in_progress" || next === "cancelled"
  if (current === "in_progress")
    return ["awaiting_trip", "closed", "cancelled"].includes(next)
  if (current === "awaiting_trip")
    return ["in_progress", "closed", "cancelled"].includes(next)
  return false
}

function isCollection(value: unknown): value is RequestCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items) &&
    "timezone" in value &&
    typeof value.timezone === "string" &&
    "total" in value &&
    typeof value.total === "number"
  )
}

function errorFrom(value: unknown, fallback: string) {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback
}

function formatDate(
  value: string,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions
) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Дата не указана"
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
    ...options,
  }).format(date)
}

export function IndividualTransferRequests() {
  const router = useRouter()
  const [items, setItems] = React.useState<TransferRequest[]>([])
  const [total, setTotal] = React.useState(0)
  const requestController = React.useRef<AbortController | null>(null)
  const [timezone, setTimezone] = React.useState("Europe/Berlin")
  const [status, setStatus] = React.useState<"" | RequestStatus>("")
  const [query, setQuery] = usePageSearch()
  const selection = useEntitySelection<TransferRequest>((item) => item.id)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [updatingID, setUpdatingID] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState<Record<string, string>>({})

  const load = React.useCallback(async () => {
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: "100" })
      if (status) params.set("status", status)
      if (query.trim()) params.set("q", query.trim())
      const response = await sessionFetch(
        `/api/individual-transfer-requests?${params.toString()}`,
        { cache: "no-store", signal: controller.signal }
      )
      const payload: unknown = await response.json()
      if (!response.ok || !isCollection(payload))
        throw new Error(errorFrom(payload, "Не удалось загрузить заявки."))
      if (controller.signal.aborted) return
      setItems(payload.items)
      setTotal(payload.total)
      setTimezone(payload.timezone)
      setNotes(
        Object.fromEntries(
          payload.items.map((item) => [item.id, item.operatorNote ?? ""])
        )
      )
    } catch (reason) {
      if (controller.signal.aborted) return
      setItems([])
      setTotal(0)
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить заявки."
      )
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [query, status])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180)
    return () => {
      window.clearTimeout(timer)
      requestController.current?.abort()
    }
  }, [load])

  async function updateRequest(
    item: TransferRequest,
    nextStatus: RequestStatus
  ) {
    setUpdatingID(item.id)
    setError(null)
    setNotice(null)
    try {
      const response = await sessionFetch(
        `/api/individual-transfer-requests?id=${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: nextStatus,
            operatorNote: notes[item.id] ?? "",
          }),
        }
      )
      const payload: unknown = await response.json()
      if (!response.ok)
        throw new Error(errorFrom(payload, "Не удалось обновить заявку."))
      if (
        typeof payload === "object" &&
        payload !== null &&
        "item" in payload &&
        typeof payload.item === "object" &&
        payload.item !== null
      ) {
        const updated = payload.item as TransferRequest
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === updated.id ? updated : candidate
          )
        )
      }
      setNotice(
        `Статус заявки изменён: ${statusLabels[nextStatus].toLowerCase()}.`
      )
      return true
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось обновить заявку."
      )
    } finally {
      setUpdatingID(null)
    }
    return false
  }

  const requestOptions = (Object.keys(statusLabels) as RequestStatus[]).map(
    (value) => ({
      value,
      label: statusLabels[value],
      tone: requestTones[value] === "violet" ? "info" : requestTones[value],
    })
  )
  const columns = [
    textColumn<TransferRequest>(
      "name",
      "Пассажир",
      (item) => item.passengerName
    ),
    textColumn<TransferRequest>(
      "phone",
      "Телефон",
      (item) => item.passengerPhone
    ),
    textColumn<TransferRequest>(
      "route",
      "Направление",
      (item) => `${item.origin} → ${item.destination}`
    ),
    dateColumn<TransferRequest>(
      "departure",
      "Отправление",
      (item) => item.requestedDepartureAt,
      timezone
    ),
    statusColumn<TransferRequest>(
      "status",
      "Статус",
      (item) => item.status,
      requestOptions
    ),
    {
      id: "booking",
      label: "Бронирование",
      value: (item: TransferRequest) =>
        item.bookingId ? (
          <Link
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            href={`/bookings/${encodeURIComponent(item.bookingId)}`}
          >
            <TicketCheck className="h-4 w-4" />
            Открыть бронь
          </Link>
        ) : (
          <span className="text-muted-foreground">Не создано</span>
        ),
      metric: {
        kind: "text" as const,
        getValue: (item: TransferRequest) => item.bookingId,
      },
    },
    numberColumn<TransferRequest>("seats", "Пассажиров", (item) => item.seats),
    textColumn<TransferRequest>(
      "comment",
      "Комментарий клиента",
      (item) => item.comment,
      false
    ),
    dateColumn<TransferRequest>(
      "birthDate",
      "Дата рождения",
      (item) => item.passengerBirthDate,
      timezone,
      false
    ),
    dateColumn<TransferRequest>(
      "createdAt",
      "Создано",
      (item) => item.createdAt,
      timezone,
      false
    ),
    dateColumn<TransferRequest>(
      "updatedAt",
      "Обновлено",
      (item) => item.updatedAt,
      timezone,
      false
    ),
    textColumn<TransferRequest>(
      "customerId",
      "ID клиента",
      (item) => item.customerId,
      false
    ),
    numberColumn<TransferRequest>(
      "telegramId",
      "Telegram ID",
      (item) => item.telegramId,
      false
    ),
    textColumn<TransferRequest>("id", "ID", (item) => item.id, false),
    {
      id: "operatorNote",
      label: "Комментарий диспетчера",
      value: (item: TransferRequest) => (
        <Textarea
          aria-label={`Комментарий: ${item.passengerName}`}
          className="min-h-16 min-w-48"
          maxLength={2000}
          value={notes[item.id] ?? ""}
          disabled={
            !["new", "in_progress", "awaiting_trip"].includes(item.status) ||
            !!updatingID ||
            selection.pending
          }
          onChange={(event) =>
            setNotes((current) => ({
              ...current,
              [item.id]: event.target.value,
            }))
          }
        />
      ),
      metric: {
        kind: "text" as const,
        getValue: (item: TransferRequest) => item.operatorNote,
      },
    },
  ]
  async function bulkStatus(next: RequestStatus) {
    await selection.run(
      items.filter((item) => canMoveRequest(item.status, next)),
      async (item) => {
        const response = await sessionFetch(
          `/api/individual-transfer-requests?id=${encodeURIComponent(item.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: next,
              operatorNote: notes[item.id] ?? "",
            }),
          }
        )
        const payload = await response.json()
        if (!response.ok)
          throw new Error(payload.error ?? "Не удалось изменить заявку.")
      },
      load
    )
  }
  return (
    <AppShell
      collectionFooter
      onRefresh={load}
      refreshing={loading}
      localSearch={{
        value: query,
        onChange: setQuery,
        placeholder: "Пассажир, телефон или маршрут",
      }}
      pageDescription="Запросы из Telegram на индивидуальный маршрут"
      pageTitle="Индивидуальные заявки"
      utilities={<ThemeCustomizer />}
    >
      <div className="w-full min-w-0 space-y-5">
        <AdminNotice message={error} variant="error" />
        <AdminNotice message={notice} />

        {selection.error ? (
          <p role="alert" className="text-sm text-destructive">
            {selection.error}
          </p>
        ) : null}
        <EntityDataView
          collection="requests"
          totalCount={total}
          columns={columns}
          items={items}
          getId={(item) => item.id}
          getLabel={(item) => item.passengerName}
          loading={loading}
          selected={selection.selected}
          onSelectedChange={selection.setSelected}
          isSelectable={(item) =>
            ["new", "in_progress", "awaiting_trip"].includes(item.status)
          }
          modes={["table", "list", "kanban", "calendar", "gallery"]}
          dateValue={(item) =>
            new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
              new Date(item.requestedDepartureAt)
            )
          }
          groupBy={(item) => item.status}
          kanbanGroups={requestOptions.map((option) => ({
            id: option.value,
            label: option.label,
            tone: requestTones[option.value],
            description: requestDescriptions[option.value],
          }))}
          onKanbanGroupChange={(item, next) =>
            updateRequest(item, next as RequestStatus)
          }
          canMoveInKanban={(item) =>
            !["booking_created", "closed", "cancelled"].includes(item.status)
          }
          canMoveToKanbanGroup={(item, next) =>
            canMoveRequest(item.status, next as RequestStatus)
          }
          filterValues={{ status }}
          onFiltersChange={(values) =>
            setStatus((values.status ?? "") as "" | RequestStatus)
          }
          filters={[{ id: "status", label: "Статус", options: requestOptions }]}
          actions={[
            {
              label: "Взять в работу",
              onSelect: (item) => void updateRequest(item, "in_progress"),
              disabled: (item) =>
                item.status !== "new" || !!updatingID || selection.pending,
            },
            {
              label: "Подобрать рейс",
              onSelect: (item) => void updateRequest(item, "awaiting_trip"),
              disabled: (item) =>
                item.status !== "in_progress" ||
                !!updatingID ||
                selection.pending,
            },
            {
              label: "Создать бронирование",
              onSelect: (item) =>
                router.push(
                  `/bookings?from_request=${encodeURIComponent(item.id)}`
                ),
              disabled: (item) =>
                !["in_progress", "awaiting_trip"].includes(item.status) ||
                !!item.bookingId ||
                !!updatingID ||
                selection.pending,
            },
            {
              label: "Сохранить комментарий",
              onSelect: (item) => void updateRequest(item, item.status),
              disabled: (item) =>
                !["new", "in_progress", "awaiting_trip"].includes(
                  item.status
                ) ||
                !!updatingID ||
                selection.pending,
            },
            {
              label: "Закрыть без брони",
              onSelect: (item) => void updateRequest(item, "closed"),
              disabled: (item) =>
                !["in_progress", "awaiting_trip"].includes(item.status) ||
                !!updatingID ||
                selection.pending,
            },
            {
              label: "Отклонить",
              onSelect: (item) => void updateRequest(item, "cancelled"),
              destructive: true,
              disabled: (item) =>
                !["new", "in_progress", "awaiting_trip"].includes(
                  item.status
                ) ||
                !!updatingID ||
                selection.pending,
            },
          ]}
          renderCard={(item) => (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{item.passengerName}</p>
                <span
                  className={`rounded-full px-2 py-1 text-[11px] font-semibold ${requestBadgeClasses[item.status]}`}
                >
                  {statusLabels[item.status]}
                </span>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 text-sm text-foreground">
                  <MapPin className="h-3.5 w-3.5 text-primary" />
                  {item.origin} → {item.destination}
                </p>
                <p className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatDate(item.requestedDepartureAt, timezone)}
                </p>
                <p className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {item.seats} пассажиров
                </p>
              </div>
              {item.operatorNote ? (
                <p className="line-clamp-2 rounded-md bg-muted/55 px-2.5 py-2 text-xs text-muted-foreground">
                  {item.operatorNote}
                </p>
              ) : null}
              {item.bookingId ? (
                <Button
                  className="w-full"
                  render={
                    <Link
                      href={`/bookings/${encodeURIComponent(item.bookingId)}`}
                    />
                  }
                  size="sm"
                  variant="outline"
                >
                  <TicketCheck className="h-4 w-4" />
                  Открыть бронирование
                </Button>
              ) : ["in_progress", "awaiting_trip"].includes(item.status) ? (
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() =>
                    router.push(
                      `/bookings?from_request=${encodeURIComponent(item.id)}`
                    )
                  }
                >
                  <TicketCheck className="h-4 w-4" />
                  Создать бронь
                </Button>
              ) : null}
            </div>
          )}
          bulkActions={
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={!!updatingID || selection.pending}
                onClick={() => void bulkStatus("in_progress")}
              >
                В работу
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!!updatingID || selection.pending}
                onClick={() => void bulkStatus("closed")}
              >
                Закрыть
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={!!updatingID || selection.pending}
                onClick={() => void bulkStatus("cancelled")}
              >
                Отклонить
              </Button>
            </>
          }
          emptyText="Заявок не найдено."
        />
      </div>
    </AppShell>
  )
}
