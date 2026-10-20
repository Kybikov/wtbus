"use client"

import * as React from "react"
import { ChevronRight, Plus, Tags } from "lucide-react"
import { toast } from "sonner"
import { AdminNotice } from "@/components/admin-notice"
import { useFieldAutosave } from "@/components/use-field-autosave"
import {
  useWorkflowStatuses,
  WorkflowStatusBadge,
  type WorkflowEntity,
  type WorkflowStatus,
} from "@/components/route-status-field"
import { Badge } from "@/components/ui/badge"
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
import { Skeleton } from "@/components/ui/skeleton"
import { sessionFetch } from "@/lib/session-navigation"

const entities: { value: WorkflowEntity; label: string }[] = [
  { value: "routes", label: "Маршруты" },
  { value: "trips", label: "Рейсы" },
  { value: "vehicles", label: "Автомобили" },
  { value: "drivers", label: "Водители" },
  { value: "requests", label: "Заявки" },
  { value: "bookings", label: "Бронирования" },
  { value: "payments", label: "Оплаты" },
]
const phaseLabels: Record<string, string> = {
  active: "Активен",
  unavailable: "Недоступен",
  inactive: "Отключён",
  archived: "В архиве",
  ready: "Готов к назначению",
  on_route: "В пути",
  reserved: "Зарезервирован",
  maintenance: "На обслуживании",
  repair: "В ремонте",
  assigned: "Назначен",
  rest: "Отдыхает",
  draft: "Черновик",
  planned: "Запланирован",
  in_progress: "В работе",
  completed: "Завершён",
  cancelled: "Отменён",
  new: "Новый",
  awaiting_trip: "Подбор рейса",
  booking_created: "Бронь создана",
  closed: "Закрыт",
  pending: "Ожидание",
  awaiting_payment: "Ожидает оплаты",
  confirmed: "Подтверждён",
  authorized: "Средства зарезервированы",
  paid: "Оплачен",
  failed: "Ошибка оплаты",
  refunded: "Возвращён",
}
const phases: Record<WorkflowEntity, string[]> = {
  routes: ["active", "unavailable", "inactive", "archived"],
  vehicles: [
    "ready",
    "on_route",
    "reserved",
    "maintenance",
    "repair",
    "unavailable",
    "archived",
  ],
  drivers: ["ready", "assigned", "on_route", "rest", "unavailable", "inactive"],
  trips: [
    "draft",
    "planned",
    "assigned",
    "in_progress",
    "completed",
    "cancelled",
  ],
  requests: [
    "new",
    "in_progress",
    "awaiting_trip",
    "booking_created",
    "closed",
    "cancelled",
  ],
  bookings: [
    "pending",
    "awaiting_payment",
    "confirmed",
    "completed",
    "cancelled",
  ],
  payments: [
    "pending",
    "authorized",
    "paid",
    "failed",
    "cancelled",
    "refunded",
  ],
}
const tones: { value: WorkflowStatus["tone"]; label: string }[] = [
  { value: "success", label: "Зелёный" },
  { value: "warning", label: "Жёлтый" },
  { value: "danger", label: "Красный" },
  { value: "info", label: "Синий" },
  { value: "neutral", label: "Нейтральный" },
  { value: "violet", label: "Фиолетовый" },
]
type StatusForm = Pick<
  WorkflowStatus,
  "label" | "tone" | "semanticPhase" | "isAvailable" | "isTerminal"
>

function statusForm(status: WorkflowStatus): StatusForm {
  return {
    label: status.label,
    tone: status.tone,
    semanticPhase: status.semanticPhase,
    isAvailable: status.isAvailable,
    isTerminal: status.isTerminal,
  }
}

export function WorkflowStatusSettings({
  disabled = false,
}: {
  disabled?: boolean
}) {
  const [entity, setEntity] = React.useState<WorkflowEntity>("routes")
  return (
    <section className="settings-panel" aria-label="Статусы">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Tags className="size-4" />
          </span>
          <div>
            <h2 className="font-semibold">Статусы</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Названия и цвета для карточек, фильтров и канбана.
            </p>
          </div>
        </div>
        <FieldSelect
          aria-label="Раздел статусов"
          triggerClassName="w-full sm:w-48"
          options={entities}
          value={entity}
          onValueChange={(next) => setEntity(next as WorkflowEntity)}
        />
      </div>
      <StatusList key={entity} entity={entity} disabled={disabled} />
    </section>
  )
}

function StatusList({
  entity,
  disabled,
}: {
  entity: WorkflowEntity
  disabled: boolean
}) {
  const { statuses, loading, error, load, setStatuses } =
    useWorkflowStatuses(entity)
  const [selected, setSelected] = React.useState<
    WorkflowStatus | null | undefined
  >()
  const onSaved = (item: WorkflowStatus) => {
    setStatuses((current) =>
      current.some((status) => status.key === item.key)
        ? current.map((status) => (status.key === item.key ? item : status))
        : [...current, item]
    )
    window.dispatchEvent(
      new CustomEvent(`workflow-statuses-changed:${entity}`, { detail: item })
    )
  }
  return (
    <>
      <AdminNotice message={error} variant="error" />
      {error && (
        <Button
          variant="outline"
          onClick={() => void load().catch(() => undefined)}
        >
          Повторить загрузку
        </Button>
      )}
      {loading ? (
        <div className="grid gap-2" aria-label="Загрузка статусов">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-[1fr_auto] gap-3 bg-muted/40 px-4 py-3 text-xs text-muted-foreground sm:grid-cols-[1fr_1fr_1.2fr_1rem]">
            <span>Статус</span>
            <span className="hidden sm:block">Поведение</span>
            <span className="hidden sm:block">Доступность</span>
            <span className="sr-only">Изменить</span>
          </div>
          {statuses.map((status) => (
            <button
              type="button"
              key={status.key}
              disabled={disabled}
              onClick={() => setSelected(status)}
              aria-label={`Изменить статус: ${status.label}`}
              className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 sm:grid-cols-[1fr_1fr_1.2fr_1rem]"
            >
              <WorkflowStatusBadge status={status} />
              <span className="hidden text-sm text-muted-foreground sm:block">
                {phaseLabels[status.semanticPhase] ?? "Особый статус"}
              </span>
              <span className="hidden text-sm text-muted-foreground sm:block">
                {status.isTerminal
                  ? "Завершающий"
                  : status.isAvailable
                    ? "Доступен"
                    : "Недоступен"}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
          {!statuses.length && (
            <p className="p-5 text-sm text-muted-foreground">
              Пока нет статусов.
            </p>
          )}
        </div>
      )}
      <Button
        className="mt-4"
        variant="outline"
        disabled={disabled || loading || Boolean(error)}
        onClick={() => setSelected(null)}
      >
        <Plus />
        Добавить статус
      </Button>
      <Dialog
        open={selected !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined)
        }}
      >
        {selected !== undefined && (
          <StatusEditor
            key={selected?.key ?? "new"}
            entity={entity}
            status={selected}
            disabled={disabled}
            onSaved={onSaved}
            onClose={() => setSelected(undefined)}
          />
        )}
      </Dialog>
    </>
  )
}

// Each record owns its queue. Closing the editor must not reset queued writes.
function StatusEditor({
  entity,
  status,
  disabled,
  onSaved,
  onClose,
}: {
  entity: WorkflowEntity
  status: WorkflowStatus | null
  disabled: boolean
  onSaved: (status: WorkflowStatus) => void
  onClose: () => void
}) {
  const [form, setForm] = React.useState<StatusForm>(() =>
    status
      ? statusForm(status)
      : {
          label: "",
          tone: "neutral",
          semanticPhase: phases[entity][0],
          isAvailable: false,
          isTerminal: false,
        }
  )
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState<StatusForm | null>(null)
  async function persist(next: StatusForm) {
    if (!next.label.trim()) throw Error("Укажите название статуса.")
    const response = await sessionFetch(
      status
        ? `/api/workflow-statuses/${encodeURIComponent(status.key)}`
        : "/api/workflow-statuses",
      {
        method: status ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, ...next }),
      }
    )
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.item)
      throw Error(payload?.error ?? "Не удалось сохранить статус.")
    onSaved(payload.item)
    setSaved(next)
    return next
  }
  const autosave = useFieldAutosave<StatusForm>(persist)
  React.useEffect(() => {
    autosave.initialize(status ? statusForm(status) : null)
  }, [autosave, status])
  const change = <K extends keyof StatusForm>(
    key: K,
    value: StatusForm[K],
    commit = true
  ) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (status && commit) autosave.commit({ [key]: value })
  }
  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (status || disabled || saving) return
    setSaving(true)
    try {
      await persist(form)
      toast.success("Статус добавлен")
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось добавить статус."
      )
    } finally {
      setSaving(false)
    }
  }
  const preview = { key: "preview", ...form, isSystem: false }
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{status ? "Изменить статус" : "Новый статус"}</DialogTitle>
        <DialogDescription>
          {entities.find((item) => item.value === entity)?.label}
        </DialogDescription>
      </DialogHeader>
      <WorkflowStatusBadge status={preview} />
      <form
        id="workflow-status-form"
        className="grid gap-4"
        onSubmit={(event) => void create(event)}
      >
        <fieldset disabled={disabled || saving} className="grid min-w-0 gap-4">
          <label className="grid gap-2 text-sm font-medium">
            Название
            <Input
              autoFocus
              maxLength={80}
              required
              value={form.label}
              onChange={(event) => change("label", event.target.value, false)}
              onBlur={() => {
                if (status) autosave.commit({ label: form.label })
              }}
            />
          </label>
          <div className="grid gap-2 text-sm font-medium">
            <span id="status-color-label">Цвет</span>
            <FieldSelect
              aria-label="Цвет статуса"
              value={form.tone}
              options={tones.map((tone) => ({
                value: tone.value,
                label: (
                  <WorkflowStatusBadge
                    status={{ ...preview, tone: tone.value, label: tone.label }}
                  />
                ),
              }))}
              onValueChange={(next) =>
                change("tone", next as WorkflowStatus["tone"])
              }
            />
          </div>
          <div className="grid gap-2 text-sm font-medium">
            <span>Поведение</span>
            <FieldSelect
              aria-label="Поведение статуса"
              disabled={Boolean(status)}
              options={phases[entity].map((value) => ({
                value,
                label: phaseLabels[value],
              }))}
              value={form.semanticPhase}
              onValueChange={(next) => change("semanticPhase", next)}
            />
            {!status && (
              <p className="text-xs font-normal text-muted-foreground">
                После создания изменить поведение нельзя.
              </p>
            )}
          </div>
          {["routes", "vehicles", "drivers"].includes(entity) && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3 text-sm">
              <span>Доступен для назначения</span>
              <DeliverySwitch
                label="Доступен для назначения"
                checked={form.isAvailable}
                onChange={(next) => change("isAvailable", Boolean(next))}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3 text-sm">
            <span>Завершающий статус</span>
            <DeliverySwitch
              label="Завершающий статус"
              disabled={Boolean(status)}
              checked={form.isTerminal}
              onChange={(next) => change("isTerminal", Boolean(next))}
            />
          </div>
        </fieldset>
      </form>
      <DialogFooter>
        {status && saved && JSON.stringify(saved) === JSON.stringify(form) && (
          <Badge
            variant="secondary"
            className="mr-auto text-emerald-600"
            role="status"
          >
            Сохранено
          </Badge>
        )}
        <Button variant="ghost" onClick={onClose}>
          {status ? "Готово" : "Отмена"}
        </Button>
        {!status && (
          <Button
            type="submit"
            form="workflow-status-form"
            disabled={disabled || saving || !form.label.trim()}
          >
            {saving ? "Добавляем…" : "Добавить статус"}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  )
}
