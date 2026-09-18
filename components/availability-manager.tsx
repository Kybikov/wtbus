"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  CalendarBlock01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons"

import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"

type Route = { id: string; name: string }
type Block = {
  id: string
  routeId?: string
  routeName?: string
  startsAt: string
  endsAt: string
  reason?: string
}
type BlockForm = {
  routeId: string
  startsAt: string
  endsAt: string
  reason: string
}

function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

function defaultBlockForm(): BlockForm {
  const start = new Date()
  start.setHours(start.getHours() + 1, 0, 0, 0)
  const end = new Date(start)
  end.setHours(end.getHours() + 2)
  return {
    routeId: "",
    startsAt: localDateTime(start),
    endsAt: localDateTime(end),
    reason: "",
  }
}

function isBlocks(
  value: unknown
): value is { items: Block[]; timezone: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
}

function isResources(value: unknown): value is { routes: Route[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "routes" in value &&
    Array.isArray(value.routes)
  )
}

function errorFrom(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

export function AvailabilityManager() {
  const [blocks, setBlocks] = React.useState<Block[]>([])
  const [routes, setRoutes] = React.useState<Route[]>([])
  const [timezone, setTimezone] = React.useState("")
  const [form, setForm] = React.useState<BlockForm>(defaultBlockForm)
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [blocksResponse, resourcesResponse] = await Promise.all([
        sessionFetch("/api/availability-blocks", { cache: "no-store" }),
        sessionFetch("/api/trip-resources", { cache: "no-store" }),
      ])
      const [blocksPayload, resourcesPayload]: [unknown, unknown] =
        await Promise.all([blocksResponse.json(), resourcesResponse.json()])
      if (
        !blocksResponse.ok ||
        !isBlocks(blocksPayload) ||
        !resourcesResponse.ok ||
        !isResources(resourcesPayload)
      ) {
        throw new Error("Не удалось загрузить доступность маршрутов.")
      }
      setBlocks(blocksPayload.items)
      setRoutes(resourcesPayload.routes)
      setTimezone(blocksPayload.timezone)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить доступность маршрутов."
      )
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await sessionFetch("/api/availability-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload: unknown = await response.json()
      if (!response.ok)
        throw new Error(errorFrom(payload, "Не удалось создать блокировку."))
      setOpen(false)
      setForm(defaultBlockForm())
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось создать блокировку."
      )
    } finally {
      setSaving(false)
    }
  }

  async function remove(block: Block) {
    setSaving(true)
    setError(null)
    try {
      const response = await sessionFetch(
        `/api/availability-blocks?id=${encodeURIComponent(block.id)}`,
        { method: "DELETE" }
      )
      const payload: unknown = await response.json()
      if (!response.ok)
        throw new Error(errorFrom(payload, "Не удалось снять блокировку."))
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось снять блокировку."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell
      onRefresh={load}
      refreshing={loading}
      pageActions={
        <Button
          onClick={() => {
            setForm(defaultBlockForm())
            setOpen(true)
          }}
        >
          <HugeiconsIcon icon={Add01Icon} size={18} />
          Добавить блокировку
        </Button>
      }
      pageDescription={`Блокировки продаж и планирования${timezone ? ` · ${timezone}` : ""}`}
      pageTitle="Недоступные даты"
      utilities={<ThemeCustomizer />}
    >
      <section className="w-full min-w-0 space-y-5">
        {error ? (
          <div
            className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {open ? (
          <form
            className="grid gap-3 rounded-[calc(var(--radius)*1.35)] border border-border bg-background/30 p-5 md:grid-cols-2"
            onSubmit={create}
          >
            <div className="md:col-span-2">
              <h2 className="text-base font-bold">Новая блокировка</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Оставьте маршрут пустым, чтобы остановить продажи и планирование
                для всех направлений.
              </p>
            </div>
            <label className="grid gap-2 text-sm font-semibold">
              Маршрут
              <FieldSelect
                disabled={saving}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    routeId: value,
                  }))
                }
                options={[
                  { value: "", label: "Все маршруты" },
                  ...routes.map((route) => ({
                    value: route.id,
                    label: route.name,
                  })),
                ]}
                value={form.routeId}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Причина (необязательно)
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                maxLength={500}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                placeholder="Например, техническое обслуживание"
                value={form.reason}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Начало
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    startsAt: event.target.value,
                  }))
                }
                required
                type="datetime-local"
                value={form.startsAt}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Окончание
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    endsAt: event.target.value,
                  }))
                }
                required
                type="datetime-local"
                value={form.endsAt}
              />
            </label>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button
                disabled={saving}
                onClick={() => setOpen(false)}
                type="button"
                variant="ghost"
              >
                Отмена
              </Button>
              <Button disabled={saving} type="submit">
                {saving ? "Сохраняем…" : "Заблокировать интервал"}
              </Button>
            </div>
          </form>
        ) : null}
        <div className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">
              Загружаем доступность…
            </p>
          ) : null}
          {!loading && blocks.length === 0 ? (
            <div className="p-6">
              <div className="flex items-center gap-2 font-semibold">
                <HugeiconsIcon
                  className="text-primary"
                  icon={CalendarBlock01Icon}
                  size={18}
                />
                Свободных ограничений нет
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Все активные маршруты доступны для планирования и бронирования.
              </p>
            </div>
          ) : null}
          {!loading
            ? blocks.map((block) => (
                <article
                  className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  key={block.id}
                >
                  <div>
                    <p className="font-bold">
                      {block.routeName || "Все маршруты"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {new Intl.DateTimeFormat("ru-RU", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(block.startsAt))}{" "}
                      —{" "}
                      {new Intl.DateTimeFormat("ru-RU", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(block.endsAt))}
                    </p>
                    {block.reason ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {block.reason}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    disabled={saving}
                    onClick={() => void remove(block)}
                    size="sm"
                    variant="outline"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={16} />
                    Снять
                  </Button>
                </article>
              ))
            : null}
        </div>
      </section>
    </AppShell>
  )
}
