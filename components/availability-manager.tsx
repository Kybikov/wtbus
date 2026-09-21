"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"

import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"
import { EntityDataView } from "@/components/entity-data-view"
import { textColumn, dateColumn } from "@/lib/entity-columns"
import { usePageSearch } from "@/hooks/use-page-search"
import { useEntitySelection } from "@/hooks/use-entity-selection"

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

export function AvailabilityManager({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const [pageQuery, setPageQuery] = usePageSearch()
  const [embeddedQuery] = React.useState("")
  const query = embedded ? embeddedQuery : pageQuery
  const selection = useEntitySelection<Block>((item) => item.id)
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

  React.useEffect(() => {
    if (!embedded) return
    if (
      new URLSearchParams(window.location.search).get("availability") !==
      "create"
    )
      return
    const timer = window.setTimeout(() => {
      setForm(defaultBlockForm())
      setOpen(true)
      const url = new URL(window.location.href)
      url.searchParams.delete("availability")
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [embedded])

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

  const filteredBlocks = blocks.filter((item) =>
    [item.routeName, item.reason, item.id]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  const columns = [
    textColumn<Block>(
      "name",
      "Маршрут",
      (item) => item.routeName || "Все маршруты"
    ),
    dateColumn<Block>(
      "start",
      "Начало",
      (item) => item.startsAt,
      timezone || "Europe/Warsaw"
    ),
    dateColumn<Block>(
      "end",
      "Окончание",
      (item) => item.endsAt,
      timezone || "Europe/Warsaw"
    ),
    textColumn<Block>("reason", "Причина", (item) => item.reason),
    textColumn<Block>("routeId", "ID маршрута", (item) => item.routeId, false),
    textColumn<Block>("id", "ID", (item) => item.id, false),
  ]
  async function bulkRemove() {
    await selection.run(
      blocks,
      async (item) => {
        const response = await sessionFetch(
          `/api/availability-blocks?id=${encodeURIComponent(item.id)}`,
          { method: "DELETE" }
        )
        const payload = await response.json()
        if (!response.ok)
          throw new Error(payload.error ?? "Не удалось снять блокировку.")
      },
      load
    )
  }
  const openCreate = () => {
    setForm(defaultBlockForm())
    setOpen(true)
  }
  const content = (
    <section
      className={
        embedded
          ? "workspace-panel w-full min-w-0 space-y-4 p-4 sm:p-5"
          : "w-full min-w-0 space-y-5"
      }
      id="availability"
    >
      {embedded ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
          <div>
            <h2 className="text-base font-bold">Недоступные даты</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Остановите продажи и планирование для маршрута или всей сети.
            </p>
          </div>
          <Button onClick={openCreate} size="sm" type="button">
            Добавить блокировку
          </Button>
        </header>
      ) : null}
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
            <Input
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
            <Input
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
            <Input
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
      {selection.error ? (
        <p role="alert" className="text-sm text-destructive">
          {selection.error}
        </p>
      ) : null}
      <EntityDataView
        collection="availability"
        columns={columns}
        items={filteredBlocks}
        getId={(item) => item.id}
        getLabel={(item) => item.routeName || "Все маршруты"}
        loading={loading}
        showMetrics={!embedded}
        selected={selection.selected}
        onSelectedChange={selection.setSelected}
        modes={["table", "list", "calendar", "gallery"]}
        dateValue={(item) =>
          new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone || "Europe/Warsaw",
          }).format(new Date(item.startsAt))
        }
        filters={[
          {
            id: "scope",
            label: "Область",
            options: [
              { value: "all", label: "Все маршруты" },
              { value: "route", label: "Конкретный маршрут" },
            ],
            matches: (item, value) =>
              value === "all" ? !item.routeId : !!item.routeId,
          },
        ]}
        actions={[
          {
            label: "Снять блокировку",
            onSelect: (item) => void remove(item),
            destructive: true,
            disabled: () => saving || selection.pending,
          },
        ]}
        bulkActions={
          <Button
            variant="destructive"
            size="sm"
            disabled={saving || selection.pending}
            onClick={() => void bulkRemove()}
          >
            Снять блокировки
          </Button>
        }
        emptyText="Блокировок не найдено."
      />
    </section>
  )
  if (embedded) return content
  return (
    <AppShell
      collectionFooter
      localSearch={{
        value: pageQuery,
        onChange: setPageQuery,
        placeholder: "Маршрут, причина или ID",
        label: "Поиск блокировок",
      }}
      onRefresh={load}
      refreshing={loading}
      onCreate={openCreate}
      pageDescription={`Блокировки продаж и планирования${timezone ? ` · ${timezone}` : ""}`}
      pageTitle="Недоступные даты"
      utilities={<ThemeCustomizer />}
    >
      {content}
    </AppShell>
  )
}
