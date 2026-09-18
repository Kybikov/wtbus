"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Calendar01Icon,
} from "@hugeicons/core-free-icons"

import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"

type RequestStatus = "new" | "in_progress" | "closed" | "cancelled"

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
}

type RequestCollection = { items: TransferRequest[]; timezone: string }

const statusLabels: Record<RequestStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  closed: "Закрыта",
  cancelled: "Отклонена",
}

function isCollection(value: unknown): value is RequestCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items) &&
    "timezone" in value &&
    typeof value.timezone === "string"
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

function formatBirthDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value
}

function statusClass(status: RequestStatus) {
  return {
    new: "status-gold",
    in_progress: "status-sky",
    closed: "status-violet",
    cancelled: "status-slate",
  }[status]
}

export function IndividualTransferRequests() {
  const [items, setItems] = React.useState<TransferRequest[]>([])
  const [timezone, setTimezone] = React.useState("Europe/Berlin")
  const [status, setStatus] = React.useState<"" | RequestStatus>("")
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [updatingID, setUpdatingID] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState<Record<string, string>>({})

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: "100" })
      if (status) params.set("status", status)
      if (query.trim()) params.set("q", query.trim())
      const response = await sessionFetch(
        `/api/individual-transfer-requests?${params.toString()}`,
        { cache: "no-store" }
      )
      const payload: unknown = await response.json()
      if (!response.ok || !isCollection(payload))
        throw new Error(errorFrom(payload, "Не удалось загрузить заявки."))
      setItems(payload.items)
      setTimezone(payload.timezone)
      setNotes(
        Object.fromEntries(
          payload.items.map((item) => [item.id, item.operatorNote ?? ""])
        )
      )
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить заявки."
      )
    } finally {
      setLoading(false)
    }
  }, [query, status])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180)
    return () => window.clearTimeout(timer)
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
      setNotice(
        `Статус заявки изменён: ${statusLabels[nextStatus].toLowerCase()}.`
      )
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось обновить заявку."
      )
    } finally {
      setUpdatingID(null)
    }
  }

  return (
    <AppShell
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
        {error ? (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
            {notice}
          </div>
        ) : null}

        <section className="surface-card p-4">
          <div className="grid gap-3 md:grid-cols-[13rem]">
            <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
              Статус
              <FieldSelect
                onValueChange={(value) =>
                  setStatus(value as "" | RequestStatus)
                }
                options={[
                  { value: "", label: "Все статусы" },
                  ...(Object.keys(statusLabels) as RequestStatus[]).map(
                    (item) => ({ value: item, label: statusLabels[item] })
                  ),
                ]}
                value={status}
              />
            </label>
          </div>
        </section>

        <section className="space-y-3" aria-live="polite">
          {loading ? (
            <div className="surface-card p-6 text-sm text-muted-foreground">
              Загружаем индивидуальные заявки…
            </div>
          ) : null}
          {!loading && items.length === 0 ? (
            <div className="surface-card p-8 text-center">
              <p className="font-semibold">Заявок пока нет</p>
              <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
                Новые обращения появятся здесь после подтверждения клиентом
                индивидуального трансфера в Telegram.
              </p>
            </div>
          ) : null}
          {items.map((item) => {
            const isUpdating = updatingID === item.id
            const editable =
              item.status === "new" || item.status === "in_progress"
            return (
              <article className="surface-card p-4 sm:p-5" key={item.id}>
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(16rem,.85fr)_minmax(19rem,.9fr)] xl:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(item.status)}`}
                      >
                        {statusLabels[item.status]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Получена {formatDate(item.createdAt, timezone)}
                      </span>
                    </div>
                    <p className="mt-3 text-lg font-bold tracking-[-.02em] sm:text-xl">
                      {item.origin} → {item.destination}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <HugeiconsIcon icon={Calendar01Icon} size={16} />
                      {formatDate(item.requestedDepartureAt, timezone)}
                    </p>
                    {item.comment ? (
                      <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-sm leading-6 text-muted-foreground">
                        {item.comment}
                      </p>
                    ) : null}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div className="col-span-2">
                      <dt className="text-xs font-semibold text-muted-foreground">
                        Пассажир
                      </dt>
                      <dd className="mt-0.5 font-semibold">
                        {item.passengerName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-muted-foreground">
                        Телефон
                      </dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {item.passengerPhone}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-muted-foreground">
                        Пассажиров
                      </dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {item.seats}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs font-semibold text-muted-foreground">
                        Дата рождения
                      </dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {formatBirthDate(item.passengerBirthDate)}
                      </dd>
                    </div>
                  </dl>

                  <div className="min-w-0 border-t border-border pt-4 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-5">
                    <label className="grid gap-2 text-sm font-semibold">
                      Комментарий диспетчера
                      <textarea
                        className="min-h-20 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!editable || isUpdating}
                        maxLength={2000}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        placeholder="Например: перезвонить до 18:00"
                        value={notes[item.id] ?? ""}
                      />
                    </label>
                    {editable ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.status === "new" ? (
                          <Button
                            disabled={isUpdating}
                            onClick={() =>
                              void updateRequest(item, "in_progress")
                            }
                            size="sm"
                          >
                            {isUpdating ? "Сохраняем…" : "Взять в работу"}
                          </Button>
                        ) : (
                          <Button
                            disabled={isUpdating}
                            onClick={() => void updateRequest(item, "closed")}
                            size="sm"
                          >
                            {isUpdating ? "Сохраняем…" : "Закрыть заявку"}
                          </Button>
                        )}
                        <Button
                          disabled={isUpdating}
                          onClick={() => void updateRequest(item, "cancelled")}
                          size="sm"
                          variant="outline"
                        >
                          Отклонить
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Заявка закрыта для изменений.
                      </p>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      </div>
    </AppShell>
  )
}
