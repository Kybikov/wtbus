"use client"

import * as React from "react"
import { useActionConfirmation } from "@/components/action-confirmation"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { statusToneClass } from "@/lib/entity-columns"
import { valueLabels } from "@/lib/entity-details"
import { sessionFetch } from "@/lib/session-navigation"

export type WorkflowEntity =
  | "routes"
  | "vehicles"
  | "drivers"
  | "trips"
  | "requests"
  | "bookings"
  | "payments"

export type WorkflowStatus = {
  key: string
  label: string
  tone: "success" | "warning" | "danger" | "info" | "neutral" | "violet"
  semanticPhase: string
  isAvailable: boolean
  isTerminal: boolean
  isSystem: boolean
}

export type RouteStatus = WorkflowStatus

function isStatuses(value: unknown): value is { items: WorkflowStatus[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
}

function messageFrom(value: unknown, fallback: string) {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback
}

export function useWorkflowStatuses(entity: WorkflowEntity) {
  const [statuses, setStatuses] = React.useState<WorkflowStatus[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    const response = await sessionFetch(
      `/api/workflow-statuses?entity=${entity}`,
      {
        cache: "no-store",
      }
    )
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok || !isStatuses(payload))
      throw new Error(messageFrom(payload, "Не удалось загрузить статусы."))
    setStatuses(payload.items)
    setError(null)
    setLoading(false)
    return payload.items
  }, [entity])

  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch(`/api/workflow-statuses?entity=${entity}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok || !isStatuses(payload))
          throw new Error(messageFrom(payload, "Не удалось загрузить статусы."))
        setStatuses(payload.items)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить статусы."
          )
          setLoading(false)
        }
      })
    const syncStatus = (event: Event) => {
      const item = (event as CustomEvent<WorkflowStatus>).detail
      if (!item) return
      setStatuses((current) => {
        const exists = current.some((status) => status.key === item.key)
        return exists
          ? current.map((status) => (status.key === item.key ? item : status))
          : [...current, item]
      })
    }
    const eventName = `workflow-statuses-changed:${entity}`
    const refresh = () => {
      void load().catch(() => undefined)
    }
    window.addEventListener(eventName, syncStatus)
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    window.addEventListener("vivat-settings-refresh", refresh)
    return () => {
      controller.abort()
      window.removeEventListener(eventName, syncStatus)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("online", refresh)
      window.removeEventListener("vivat-settings-refresh", refresh)
    }
  }, [entity, load])

  return { statuses, setStatuses, load, loading, error }
}

export function useRouteStatuses() {
  return useWorkflowStatuses("routes")
}

export function WorkflowStatusBadge({ status }: { status: WorkflowStatus }) {
  return (
    <Badge variant="secondary" className={statusToneClass(status.tone)}>
      {status.label}
    </Badge>
  )
}

export function WorkflowStatusField({
  entity,
  value,
  onValueChange,
}: {
  entity: WorkflowEntity
  value: string
  onValueChange: (value: string) => void
}) {
  const { statuses, loading, error, load } = useWorkflowStatuses(entity)
  const selected = statuses.find((status) => status.key === value)
  const confirmAction = useActionConfirmation()
  async function chooseStatus(key: string) {
    if (!key || key === value) return
    if (
      statuses.find((item) => item.key === key)?.semanticPhase === "archived" &&
      !(await confirmAction({
        title: "Переместить в архив?",
        label: "В архив",
        tone: "archive",
      }))
    )
      return
    onValueChange(key)
  }
  if (error && !statuses.length)
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Повторить загрузку статусов"
        title={error}
        onClick={() => void load().catch(() => undefined)}
      >
        <RefreshCw className="size-3.5" />
        Статусы недоступны
      </Button>
    )
  return (
    <Select
      value={value}
      onValueChange={(key) => void chooseStatus(key ?? "")}
      onOpenChange={(open) => {
        if (open && error) void load().catch(() => undefined)
      }}
    >
      <SelectTrigger
        aria-label="Статус"
        disabled={loading || !statuses.length}
        className={`h-8 max-w-full rounded-full border-0 px-3 text-xs font-semibold [&_svg]:text-current ${statusToneClass(selected?.tone)}`}
      >
        <SelectValue>
          {selected?.label ??
            valueLabels[value] ??
            (loading ? "Загрузка…" : "Выберите статус")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="min-w-52"
      >
        {statuses.map((status) => (
          <SelectItem key={status.key} value={status.key}>
            <WorkflowStatusBadge status={status} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function RouteStatusField(props: {
  value: string
  onValueChange: (value: string) => void
}) {
  return <WorkflowStatusField entity="routes" {...props} />
}
