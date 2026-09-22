"use client"

import * as React from "react"
import { Plus, Settings2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

export type RouteStatus = {
  key: string
  label: string
  tone: "success" | "warning" | "danger" | "info" | "neutral"
  isAvailable: boolean
  isSystem: boolean
}

const toneOptions = [
  { value: "success", label: "Зелёный" },
  { value: "warning", label: "Жёлтый" },
  { value: "danger", label: "Красный" },
  { value: "info", label: "Синий" },
  { value: "neutral", label: "Нейтральный" },
]

function isStatuses(value: unknown): value is { items: RouteStatus[] } {
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

export function useRouteStatuses() {
  const [statuses, setStatuses] = React.useState<RouteStatus[]>([])

  const load = React.useCallback(async () => {
    const response = await sessionFetch("/api/route-statuses", {
      cache: "no-store",
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok || !isStatuses(payload))
      throw new Error(messageFrom(payload, "Не удалось загрузить статусы."))
    setStatuses(payload.items)
    return payload.items
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/route-statuses", {
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
      const item = (event as CustomEvent<RouteStatus>).detail
      if (!item) return
      setStatuses((current) => {
        const exists = current.some((status) => status.key === item.key)
        return exists
          ? current.map((status) => (status.key === item.key ? item : status))
          : [...current, item]
      })
    }
    window.addEventListener("route-statuses-changed", syncStatus)
    return () => {
      controller.abort()
      window.removeEventListener("route-statuses-changed", syncStatus)
    }
  }, [])

  return { statuses, setStatuses, load }
}

export function RouteStatusField({
  value,
  onValueChange,
}: {
  value: string
  onValueChange: (value: string) => void
}) {
  const { statuses, setStatuses } = useRouteStatuses()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [selectedKey, setSelectedKey] = React.useState<string | undefined>()
  const [label, setLabel] = React.useState("")
  const [tone, setTone] = React.useState<RouteStatus["tone"]>("neutral")
  const [isAvailable, setIsAvailable] = React.useState(false)

  function openSettings() {
    const selected =
      statuses.find((status) => status.key === value) ?? statuses[0]
    if (selected) {
      setSelectedKey(selected.key)
      setLabel(selected.label)
      setTone(selected.tone)
      setIsAvailable(selected.isAvailable)
    } else {
      beginCreate()
    }
    setOpen(true)
  }

  function selectStatus(key: string) {
    const selected = statuses.find((status) => status.key === key)
    if (!selected) return
    setSelectedKey(selected.key)
    setLabel(selected.label)
    setTone(selected.tone)
    setIsAvailable(selected.isAvailable)
  }

  function beginCreate() {
    setSelectedKey("")
    setLabel("")
    setTone("neutral")
    setIsAvailable(false)
  }

  async function saveStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!label.trim()) return
    setSaving(true)
    try {
      const editing = Boolean(selectedKey)
      const response = await sessionFetch(
        editing
          ? `/api/route-statuses/${encodeURIComponent(selectedKey ?? "")}`
          : "/api/route-statuses",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label, tone, isAvailable }),
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
      const item = payload.item as RouteStatus
      setStatuses((current) =>
        editing
          ? current.map((status) => (status.key === item.key ? item : status))
          : [...current, item]
      )
      window.dispatchEvent(
        new CustomEvent("route-statuses-changed", { detail: item })
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
          triggerClassName="h-9 min-w-0 flex-1 bg-background"
          options={statuses.map((status) => ({
            value: status.key,
            label: status.label,
          }))}
          value={value}
          onValueChange={onValueChange}
        />
        <Button
          aria-label="Настроить статусы"
          className="size-9 shrink-0 rounded-xl"
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
            <DialogTitle>Статусы маршрутов</DialogTitle>
            <DialogDescription>
              Измените существующий статус или добавьте новый. Изменения сразу
              применятся к маршрутам и фильтрам.
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
            onSubmit={saveStatus}
          >
            <label className="grid gap-2 text-sm font-medium">
              Название
              <Input
                autoFocus
                maxLength={80}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Например, На обслуживании"
                required
                value={label}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Цвет
              <FieldSelect
                options={toneOptions}
                value={tone}
                onValueChange={(next) => setTone(next as RouteStatus["tone"])}
              />
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
              <Checkbox
                checked={isAvailable}
                onCheckedChange={(checked) => setIsAvailable(Boolean(checked))}
              />
              <span>
                <span className="block font-medium">Доступен для продаж</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Маршруты с этим статусом можно использовать в новых рейсах.
                </span>
              </span>
            </label>
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
