"use client"

import * as React from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  DashboardSquare01Icon,
  Edit02Icon,
} from "@hugeicons/core-free-icons"

import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
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

function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100)
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

function toForm(route: Route): RouteForm {
  return {
    name: route.name,
    origin: route.origin,
    destination: route.destination,
    currency: route.currency,
    price: (route.defaultPriceMinor / 100).toFixed(2),
    defaultPricingMode: route.defaultPricingMode,
    isActive: route.isActive,
  }
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

  const isEditing = editingID !== null

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/routes", { cache: "no-store" })
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

  function startEdit(route: Route) {
    setError(null)
    setEditingID(route.id)
    setForm(toForm(route))
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
      const response = await fetch(endpoint, {
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
      const response = await fetch(
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
    <AppShell pageTitle="Маршруты" utilities={<ThemeCustomizer />}>
      <section className="mx-auto max-w-[1200px] space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link
                aria-label="На главную"
                className="hover:text-foreground"
                href="/"
              >
                <HugeiconsIcon icon={DashboardSquare01Icon} size={16} />
              </Link>
              <span>/</span>
              <span>Маршруты</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-[-.035em] sm:text-3xl">
              Каталог регулярных маршрутов
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Неактивный шаблон остаётся в истории, но не предлагается при
              создании рейса.
            </p>
          </div>
          <Button onClick={startCreate} size="lg">
            <HugeiconsIcon icon={Add01Icon} size={18} />
            Новый маршрут
          </Button>
        </div>

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
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                maxLength={160}
                onChange={(event) => updateForm("name", event.target.value)}
                required
                value={form.name}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Валюта
              <input
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
              <input
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
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                maxLength={120}
                onChange={(event) => updateForm("origin", event.target.value)}
                required
                value={form.origin}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Куда
              <input
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

        <div className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">
              Загружаем маршруты…
            </p>
          ) : null}
          {!loading && routes.length === 0 ? (
            <div className="p-6">
              <p className="font-semibold">Регулярных маршрутов пока нет</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Создайте первый шаблон для планирования рейсов.
              </p>
            </div>
          ) : null}
          {!loading
            ? routes.map((route) => (
                <article
                  className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  key={route.id}
                >
                  <div>
                    <p className="font-bold">{route.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {route.origin} → {route.destination} ·{" "}
                      {formatMoney(route.defaultPriceMinor, route.currency)}
                      {route.defaultPricingMode === "per_booking"
                        ? " за бронь"
                        : " за пассажира"}
                      {!route.isActive ? " · Неактивен" : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={saving}
                      onClick={() => startEdit(route)}
                      size="sm"
                      variant="outline"
                    >
                      <HugeiconsIcon icon={Edit02Icon} size={16} />
                      Изменить
                    </Button>
                    <Button
                      disabled={saving}
                      onClick={() => void toggle(route)}
                      size="sm"
                      variant={route.isActive ? "outline" : "secondary"}
                    >
                      {route.isActive ? "Выключить" : "Включить"}
                    </Button>
                  </div>
                </article>
              ))
            : null}
        </div>
      </section>
    </AppShell>
  )
}
