"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"

import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EntityDataView } from "@/components/entity-data-view"
import { AvailabilityManager } from "@/components/availability-manager"
import {
  textColumn,
  moneyColumn,
  statusColumn,
  activeOptions,
  activeFilter,
} from "@/lib/entity-columns"
import { usePageSearch } from "@/hooks/use-page-search"
import { useEntitySelection } from "@/hooks/use-entity-selection"

import { FieldSelect } from "@/components/ui/field-select"

type Route = {
  id: string
  name: string
  origin: string
  destination: string
  currency: string
  defaultPriceMinor: number
  defaultPricingMode: "per_passenger" | "per_booking"
  isActive: boolean
}

type RouteForm = Omit<Route, "id" | "defaultPriceMinor"> & { price: string }

const emptyForm: RouteForm = {
  name: "",
  origin: "",
  destination: "",
  currency: "EUR",
  price: "79",
  defaultPricingMode: "per_passenger",
  isActive: true,
}

function parsePriceMinor(value: string) {
  const normalized = value.trim().replace(",", ".")
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const result = Math.round(Number(normalized) * 100)
  return Number.isSafeInteger(result) && result >= 0 && result <= 10_000_000_000
    ? result
    : null
}

function isRoutes(
  value: unknown
): value is { items: Route[]; currency: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items) &&
    "currency" in value &&
    typeof value.currency === "string"
  )
}

function getError(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

export function RouteCatalog() {
  const [routes, setRoutes] = React.useState<Route[]>([])
  const [currency, setCurrency] = React.useState("EUR")
  const [form, setForm] = React.useState<RouteForm>(emptyForm)
  const [editingID, setEditingID] = React.useState<string | null>(null)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [query, setQuery] = usePageSearch()
  const selection = useEntitySelection<Route>((item) => item.id)
  const filteredRoutes = routes.filter((item) =>
    [item.name, item.origin, item.destination, item.id]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  const columns = [
    textColumn<Route>("name", "Маршрут", (item) => item.name),
    textColumn<Route>("origin", "Откуда", (item) => item.origin),
    textColumn<Route>("destination", "Куда", (item) => item.destination),
    moneyColumn<Route>(
      "price",
      "Базовая цена",
      (item) => item.defaultPriceMinor,
      (item) => item.currency
    ),
    statusColumn<Route>(
      "active",
      "Активность",
      (item) => (item.isActive ? "active" : "inactive"),
      activeOptions
    ),
    textColumn<Route>("pricing", "Модель цены", (item) =>
      item.defaultPricingMode === "per_booking" ? "За бронь" : "За пассажира"
    ),
    textColumn<Route>("currency", "Валюта", (item) => item.currency, false),
    textColumn<Route>("id", "ID", (item) => item.id, false),
  ]
  async function bulkActive(active: boolean) {
    await selection.run(
      routes,
      async (item) => {
        const response = await sessionFetch(
          `/api/routes?id=${encodeURIComponent(item.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: item.name,
              origin: item.origin,
              destination: item.destination,
              currency: item.currency,
              defaultPriceMinor: item.defaultPriceMinor,
              defaultPricingMode: item.defaultPricingMode,
              isActive: active,
            }),
          }
        )
        const payload = await response.json()
        if (!response.ok)
          throw new Error(payload.error ?? "Не удалось изменить маршрут.")
      },
      load
    )
  }
  const isEditing = editingID !== null

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await sessionFetch("/api/routes", { cache: "no-store" })
      const payload: unknown = await response.json()

      if (!response.ok || !isRoutes(payload)) {
        throw new Error("Не удалось загрузить маршруты.")
      }

      setRoutes(payload.items)
      setCurrency(payload.currency)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить маршруты."
      )
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function closeEditor() {
    setEditorOpen(false)
    setEditingID(null)
    setForm({ ...emptyForm, currency })
  }

  function startCreate() {
    setError(null)
    setEditingID(null)
    setForm({ ...emptyForm, currency })
    setEditorOpen(true)
  }

  function updateForm<Key extends keyof RouteForm>(
    key: Key,
    value: RouteForm[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const defaultPriceMinor = parsePriceMinor(form.price)
    if (defaultPriceMinor === null) {
      setError("Укажите базовую цену числом с точностью до двух знаков.")
      return
    }
    setSaving(true)

    const endpoint = isEditing
      ? `/api/routes?id=${encodeURIComponent(editingID)}`
      : "/api/routes"
    const method = isEditing ? "PATCH" : "POST"
    const fallback = isEditing
      ? "Не удалось обновить маршрут."
      : "Не удалось создать маршрут."

    try {
      const response = await sessionFetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          origin: form.origin,
          destination: form.destination,
          currency: form.currency,
          defaultPriceMinor,
          defaultPricingMode: form.defaultPricingMode,
          isActive: form.isActive,
        }),
      })
      const payload: unknown = await response.json()

      if (!response.ok) {
        throw new Error(getError(payload, fallback))
      }

      closeEditor()
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallback)
    } finally {
      setSaving(false)
    }
  }

  async function toggle(route: Route) {
    setSaving(true)
    setError(null)

    try {
      const response = await sessionFetch(
        `/api/routes?id=${encodeURIComponent(route.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: route.name,
            origin: route.origin,
            destination: route.destination,
            currency: route.currency,
            defaultPriceMinor: route.defaultPriceMinor,
            defaultPricingMode: route.defaultPricingMode,
            isActive: !route.isActive,
          }),
        }
      )
      const payload: unknown = await response.json()

      if (!response.ok) {
        throw new Error(getError(payload, "Не удалось обновить маршрут."))
      }

      await load()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось обновить маршрут."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell
      collectionFooter
      localSearch={{
        value: query,
        onChange: setQuery,
        placeholder: "Название, города или ID",
        label: "Поиск маршрутов",
      }}
      onRefresh={load}
      refreshing={loading}
      onCreate={startCreate}
      pageDescription="Регулярные направления, цены и активность"
      pageTitle="Каталог маршрутов"
      utilities={<ThemeCustomizer />}
    >
      <section className="space-y-4">
        {error ? (
          <div
            className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {editorOpen ? (
          <form
            className="grid gap-3 rounded-[calc(var(--radius)*1.35)] border border-border bg-background/30 p-5 md:grid-cols-2"
            onSubmit={save}
          >
            <div className="md:col-span-2">
              <h2 className="text-base font-bold">
                {isEditing ? "Изменить маршрут" : "Новый маршрут"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isEditing
                  ? "Изменения сразу будут доступны при планировании регулярных рейсов."
                  : "Создайте шаблон, чтобы не вводить точки отправления и прибытия вручную."}
              </p>
            </div>
            <label className="grid gap-2 text-sm font-semibold">
              Название
              <Input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                maxLength={160}
                onChange={(event) => updateForm("name", event.target.value)}
                required
                value={form.name}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Валюта
              <Input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal uppercase transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                maxLength={3}
                onChange={(event) =>
                  updateForm("currency", event.target.value.toUpperCase())
                }
                required
                value={form.currency}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Модель цены
              <FieldSelect
                onValueChange={(value) =>
                  updateForm(
                    "defaultPricingMode",
                    value as RouteForm["defaultPricingMode"]
                  )
                }
                options={[
                  { value: "per_passenger", label: "За пассажира" },
                  { value: "per_booking", label: "За всю бронь" },
                ]}
                value={form.defaultPricingMode}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              {form.defaultPricingMode === "per_booking"
                ? "Цена за всю бронь"
                : "Цена за пассажира"}
              <Input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal tabular-nums transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                inputMode="decimal"
                min="0"
                onChange={(event) => updateForm("price", event.target.value)}
                placeholder="Например, 79"
                required
                step="0.01"
                type="number"
                value={form.price}
              />
              <span className="text-xs font-normal text-muted-foreground">
                Подставляется в регулярный рейс, но её можно изменить для
                конкретного выезда.
              </span>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Откуда
              <Input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                maxLength={120}
                onChange={(event) => updateForm("origin", event.target.value)}
                required
                value={form.origin}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Куда
              <Input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                maxLength={120}
                onChange={(event) =>
                  updateForm("destination", event.target.value)
                }
                required
                value={form.destination}
              />
            </label>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button
                disabled={saving}
                onClick={closeEditor}
                type="button"
                variant="ghost"
              >
                Отмена
              </Button>
              <Button disabled={saving} type="submit">
                {saving
                  ? "Сохраняем…"
                  : isEditing
                    ? "Сохранить изменения"
                    : "Создать маршрут"}
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
          collection="routes"
          columns={columns}
          items={filteredRoutes}
          getId={(item) => item.id}
          getLabel={(item) => item.name}
          loading={loading}
          selected={selection.selected}
          onSelectedChange={selection.setSelected}
          modes={["table", "list", "gallery"]}
          filters={[activeFilter<Route>((item) => item.isActive)]}
          actions={[
            {
              label: "Включить / выключить",
              onSelect: (item) => void toggle(item),
              disabled: () => saving || selection.pending,
            },
          ]}
          bulkActions={
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={selection.pending || saving}
                onClick={() => void bulkActive(true)}
              >
                Включить
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={selection.pending || saving}
                onClick={() => void bulkActive(false)}
              >
                Отключить
              </Button>
            </>
          }
          emptyText="Маршрутов не найдено."
        />
        <AvailabilityManager embedded />
      </section>
    </AppShell>
  )
}
