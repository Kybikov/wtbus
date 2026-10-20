"use client"
import { useActionConfirmation } from "@/components/action-confirmation"

import * as React from "react"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { Plus, Settings2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { DeliverySwitch } from "@/components/ui/delivery-switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"
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

const toneOptions = [
  { value: "success", label: "Зелёный" },
  { value: "warning", label: "Жёлтый" },
  { value: "danger", label: "Красный" },
  { value: "info", label: "Синий" },
  { value: "neutral", label: "Нейтральный" },
  { value: "violet", label: "Фиолетовый" },
]

const entityLabels: Record<WorkflowEntity, string> = {
  routes: "маршрутов",
  vehicles: "автомобилей",
  drivers: "водителей",
  trips: "рейсов",
  requests: "заявок",
  bookings: "бронирований",
  payments: "оплат",
}

const phaseOptions: Record<WorkflowEntity, { value: string; label: string }[]> =
  {
    routes: ["active", "unavailable", "inactive", "archived"].map((value) => ({
      value,
      label: value,
    })),
    vehicles: [
      "ready",
      "on_route",
      "reserved",
      "maintenance",
      "repair",
      "unavailable",
      "archived",
    ].map((value) => ({ value, label: value })),
    drivers: [
      "ready",
      "assigned",
      "on_route",
      "rest",
      "unavailable",
      "inactive",
    ].map((value) => ({ value, label: value })),
    trips: [
      "draft",
      "planned",
      "assigned",
      "in_progress",
      "completed",
      "cancelled",
    ].map((value) => ({ value, label: value })),
    requests: [
      "new",
      "in_progress",
      "awaiting_trip",
      "booking_created",
      "closed",
      "cancelled",
    ].map((value) => ({ value, label: value })),
    bookings: [
      "pending",
      "awaiting_payment",
      "confirmed",
      "completed",
      "cancelled",
    ].map((value) => ({ value, label: value })),
    payments: [
      "pending",
      "authorized",
      "paid",
      "failed",
      "cancelled",
      "refunded",
    ].map((value) => ({ value, label: value })),
  }

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
        if (!response.ok || !isStatuses(payload)) return
        setStatuses(payload.items)
      })
      .catch(() => undefined)
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
    window.addEventListener(eventName, syncStatus)
    return () => {
      controller.abort()
      window.removeEventListener(eventName, syncStatus)
    }
  }, [entity])

  return { statuses, setStatuses, load }
}

export function useRouteStatuses() {
  return useWorkflowStatuses("routes")
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
  const { statuses, setStatuses } = useWorkflowStatuses(entity)
  const confirmAction = useActionConfirmation()
  async function chooseStatus(key: string) {
    if (
      key !== value &&
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
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [selectedKey, setSelectedKey] = React.useState<string | undefined>()
  const [label, setLabel] = React.useState("")
  const [tone, setTone] = React.useState<WorkflowStatus["tone"]>("neutral")
  const [isAvailable, setIsAvailable] = React.useState(false)
  const [isTerminal, setIsTerminal] = React.useState(false)
  const [semanticPhase, setSemanticPhase] = React.useState(
    phaseOptions[entity][0].value
  )

  function openSettings() {
    const selected =
      statuses.find((status) => status.key === value) ?? statuses[0]
    if (selected) {
      autosave.initialize({
        label: selected.label,
        tone: selected.tone,
        semanticPhase: selected.semanticPhase,
        isAvailable: selected.isAvailable,
        isTerminal: selected.isTerminal,
      })
      setSelectedKey(selected.key)
      setLabel(selected.label)
      setTone(selected.tone)
      setIsAvailable(selected.isAvailable)
      setIsTerminal(selected.isTerminal)
      setSemanticPhase(selected.semanticPhase)
    } else {
      beginCreate()
    }
    setOpen(true)
  }

  type StatusForm = Pick<
    WorkflowStatus,
    "label" | "tone" | "semanticPhase" | "isAvailable" | "isTerminal"
  >
  const autosave = useFieldAutosave<StatusForm>(async (next) => {
    if (!selectedKey || !next.label.trim())
      throw Error("Укажите название статуса.")
    const response = await sessionFetch(
      `/api/workflow-statuses/${encodeURIComponent(selectedKey)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, ...next }),
      }
    )
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.item)
      throw Error(messageFrom(payload, "Не удалось сохранить статус."))
    const item = payload.item as WorkflowStatus
    setStatuses((current) =>
      current.map((status) => (status.key === item.key ? item : status))
    )
    window.dispatchEvent(
      new CustomEvent(`workflow-statuses-changed:${entity}`, { detail: item })
    )
    return next
  })
  function selectStatus(key: string) {
    const selected = statuses.find((status) => status.key === key)
    if (!selected) return
    autosave.initialize({
      label: selected.label,
      tone: selected.tone,
      semanticPhase: selected.semanticPhase,
      isAvailable: selected.isAvailable,
      isTerminal: selected.isTerminal,
    })
    setSelectedKey(selected.key)
    setLabel(selected.label)
    setTone(selected.tone)
    setIsAvailable(selected.isAvailable)
    setIsTerminal(selected.isTerminal)
    setSemanticPhase(selected.semanticPhase)
  }

  function beginCreate() {
    setSelectedKey("")
    setLabel("")
    setTone("neutral")
    setIsAvailable(false)
    setIsTerminal(false)
    setSemanticPhase(phaseOptions[entity][0].value)
  }

  async function saveStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!label.trim()) return
    setSaving(true)
    try {
      const editing = Boolean(selectedKey)
      const response = await sessionFetch(
        editing
          ? `/api/workflow-statuses/${encodeURIComponent(selectedKey ?? "")}`
          : "/api/workflow-statuses",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity,
            label,
            tone,
            semanticPhase,
            isAvailable,
            isTerminal,
          }),
        }
      )
      const payload: unknown = await response.json().catch(() => null)
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("item" in payload)
      )
        throw new Error(messageFrom(payload, "Не удалось добавить статус."))
      const item = payload.item as WorkflowStatus
      setStatuses((current) =>
        editing
          ? current.map((status) => (status.key === item.key ? item : status))
          : [...current, item]
      )
      window.dispatchEvent(
        new CustomEvent(`workflow-statuses-changed:${entity}`, { detail: item })
      )
      if (
        item.semanticPhase !== "archived" ||
        (await confirmAction({
          title: "Переместить в архив?",
          label: "В архив",
          tone: "archive",
        }))
      )
        onValueChange(item.key)
      setOpen(false)
      toast.success(editing ? "Статус обновлён" : "Статус добавлен", {
        description: item.label,
      })
    } catch (reason) {
      toast.error(
        selectedKey
          ? "Не удалось обновить статус"
          : "Не удалось добавить статус",
        {
          description: reason instanceof Error ? reason.message : undefined,
        }
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="flex w-full max-w-md items-center gap-2">
        <FieldSelect
          aria-label="Статус маршрута"
          triggerClassName="min-w-0 flex-1"
          options={statuses.map((status) => ({
            value: status.key,
            label: status.label,
          }))}
          value={value}
          onValueChange={(key) => void chooseStatus(key)}
        />
        <Button
          aria-label="Настроить статусы"
          className="size-10 shrink-0 rounded-xl"
          onClick={openSettings}
          size="icon"
          type="button"
          variant="outline"
        >
          <Settings2 />
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSelectedKey(undefined)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Статусы {entityLabels[entity]}</DialogTitle>
            <DialogDescription>
              Измените существующий статус или добавьте новый. Изменения сразу
              применятся к записям, фильтрам и канбану.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <FieldSelect
              aria-label="Статус для настройки"
              triggerClassName="min-w-0 flex-1"
              options={statuses.map((status) => ({
                value: status.key,
                label: status.label,
              }))}
              value={selectedKey ?? ""}
              onValueChange={selectStatus}
            />
            <Button
              aria-label="Добавить новый статус"
              className="shrink-0"
              onClick={beginCreate}
              type="button"
              variant={selectedKey === "" ? "secondary" : "outline"}
            >
              <Plus />
              Новый
            </Button>
          </div>
          <form
            className="grid gap-4"
            id="route-status-form"
            onSubmit={(event) => {
              if (selectedKey) event.preventDefault()
              else void saveStatus(event)
            }}
          >
            <label className="grid gap-2 text-sm font-medium">
              Название
              <Input
                autoFocus
                maxLength={80}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Например, На обслуживании"
                required
                onBlur={() => {
                  if (selectedKey) autosave.commit({ label })
                }}
                value={label}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Цвет
              <FieldSelect
                options={toneOptions}
                value={tone}
                onValueChange={(next) => {
                  setTone(next as WorkflowStatus["tone"])
                  if (selectedKey)
                    autosave.commit({ tone: next as WorkflowStatus["tone"] })
                }}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Системная фаза
              <FieldSelect
                disabled={Boolean(selectedKey)}
                options={phaseOptions[entity]}
                value={semanticPhase}
                onValueChange={setSemanticPhase}
              />
              <span className="text-xs font-normal text-muted-foreground">
                Определяет бизнес-логику. После создания не изменяется.
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
              <DeliverySwitch
                label="Доступен для планирования"
                checked={isAvailable}
                onChange={(checked) => {
                  setIsAvailable(Boolean(checked))
                  if (selectedKey)
                    autosave.commit({ isAvailable: Boolean(checked) })
                }}
              />
              <span>
                <span className="block font-medium">
                  Доступен для планирования
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Маршруты с этим статусом можно использовать в новых рейсах.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
              <DeliverySwitch
                label="Финальный статус"
                checked={isTerminal}
                disabled={Boolean(selectedKey)}
                onChange={(checked) => setIsTerminal(Boolean(checked))}
              />
              <span>
                <span className="block font-medium">Фінальний статус</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Запис вважається завершеним і не рухається далі автоматично.
                </span>
              </span>
            </label>
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {selectedKey ? "Готово" : "Отмена"}
            </Button>
            {!selectedKey && (
              <Button
                disabled={saving || !label.trim()}
                form="route-status-form"
                type="submit"
              >
                {saving
                  ? "Сохраняем…"
                  : selectedKey
                    ? "Сохранить статус"
                    : "Добавить статус"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function RouteStatusField(props: {
  value: string
  onValueChange: (value: string) => void
}) {
  return <WorkflowStatusField entity="routes" {...props} />
}
