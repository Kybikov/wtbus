"use client"
import { useRouter } from "next/navigation"
import { DeliverySwitch } from "@/components/ui/delivery-switch"
import { useActionConfirmation } from "@/components/action-confirmation"

import { sessionFetch } from "@/lib/session-navigation"
import { AdminNotice } from "@/components/admin-notice"

import * as React from "react"

import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RouteNavigationDraft } from "@/components/route-navigation-draft"
import type { RouteNavigation } from "@/components/route-navigation-editor"
import { EntityDataView } from "@/components/entity-data-view"
import {
  textColumn,
  moneyColumn,
  statusColumn,
  activeOptions,
} from "@/lib/entity-columns"
import { usePageSearch } from "@/hooks/use-page-search"
import { useEntitySelection } from "@/hooks/use-entity-selection"

import { FieldSelect } from "@/components/ui/field-select"
import {
  RouteStatusField,
  useRouteStatuses,
} from "@/components/route-status-field"

type Route = {
  defaultDriverId: string
  id: string
  name: string
  origin: string
  destination: string
  currency: string
  defaultPriceMinor: number
  driverPayMinor: number
  defaultPricingMode: "per_passenger" | "per_booking"
  isActive: boolean
  status: string
  tariffMode: "fixed" | "per_km"
  distanceKm: number
  vehicleClassRates: Record<string, number>
}

type RouteForm = Omit<
  Route,
  | "id"
  | "defaultPriceMinor"
  | "driverPayMinor"
  | "distanceKm"
  | "vehicleClassRates"
> & {
  price: string
  driverPay: string
  distance: string
  classRates: Record<string, string>
}

const emptyForm: RouteForm = {
  defaultDriverId: "",
  name: "",
  origin: "",
  destination: "",
  currency: "EUR",
  price: "",
  driverPay: "0",
  defaultPricingMode: "per_passenger",
  isActive: true,
  status: "active",
  tariffMode: "fixed",
  distance: "",
  classRates: { minivan: "", microbus: "", bus: "" },
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
  const router = useRouter()
  const confirmAction = useActionConfirmation()
  const { statuses } = useRouteStatuses()
  const [routes, setRoutes] = React.useState<Route[]>([])
  const [currency, setCurrency] = React.useState("EUR")
  const [form, setForm] = React.useState<RouteForm>(emptyForm)
  const [editingID, setEditingID] = React.useState<string | null>(null)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [navigation, setNavigation] = React.useState<RouteNavigation>({
    start: null,
    end: null,
  })
  const [roadBusy, setRoadBusy] = React.useState(false)
  const [driverChoices, setDriverChoices] = React.useState<
    { id: string; name: string }[]
  >([])
  const [driversLoading, setDriversLoading] = React.useState(true)
  const [driversError, setDriversError] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    void sessionFetch("/api/trip-resources", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error()
        if (!controller.signal.aborted) setDriverChoices(payload.drivers || [])
      })
      .catch(() => {
        if (!controller.signal.aborted) setDriversError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setDriversLoading(false)
      })
    return () => controller.abort()
  }, [])

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
    moneyColumn<Route>(
      "driverPay",
      "Зарплата водителя",
      (item) => item.driverPayMinor,
      (item) => item.currency
    ),
    statusColumn<Route>(
      "status",
      "Статус",
      (item) => item.status,
      statuses.length
        ? statuses.map((status) => ({
            value: status.key,
            label: status.label,
            tone: status.tone,
          }))
        : activeOptions
    ),
    textColumn<Route>("pricing", "Модель цены", (item) =>
      item.defaultPricingMode === "per_booking" ? "За бронь" : "За пассажира"
    ),
    textColumn<Route>("tariff", "Тариф", (item) =>
      item.tariffMode === "per_km"
        ? `${item.distanceKm} км · по классу`
        : "Фиксированный"
    ),
    textColumn<Route>("currency", "Валюта", (item) => item.currency, false),
    textColumn<Route>("id", "ID", (item) => item.id, false),
  ]
  async function bulkStatus(status: "active" | "inactive") {
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
              driverPayMinor: item.driverPayMinor,
              tariffMode: item.tariffMode,
              distanceKm: item.distanceKm,
              vehicleClassRates: item.vehicleClassRates,
              status,
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
    setNavigation({ start: null, end: null })
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
    if (
      !navigation.start ||
      !navigation.end ||
      !navigation.distanceMeters ||
      roadBusy
    ) {
      setError(
        "Выберите места отправления и прибытия и дождитесь построения дороги."
      )
      return
    }
    const defaultPriceMinor = parsePriceMinor(
      form.tariffMode === "per_km" ? "0" : form.price
    )
    const driverPayMinor = parsePriceMinor(form.driverPay)
    const distanceKm = Math.round(navigation.distanceMeters / 10) / 100
    const vehicleClassRates = Object.fromEntries(
      Object.entries(form.classRates)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => [key, parsePriceMinor(value)])
    )
    if (
      defaultPriceMinor === null ||
      driverPayMinor === null ||
      !Number.isFinite(distanceKm) ||
      distanceKm < 0 ||
      Object.values(vehicleClassRates).some((value) => value === null) ||
      (form.tariffMode === "per_km" &&
        (distanceKm <= 0 || Object.keys(vehicleClassRates).length === 0))
    ) {
      setError("Укажите цену и зарплату числом с точностью до двух знаков.")
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
          origin: form.origin.trim(),
          destination: form.destination.trim(),
          navigation: {
            start: navigation.start,
            end: navigation.end,
            startLabel: navigation.startLabel,
            endLabel: navigation.endLabel,
          },
          currency: form.currency,
          defaultPriceMinor,
          defaultPricingMode: form.defaultPricingMode,
          driverPayMinor,
          defaultDriverId: form.defaultDriverId,
          tariffMode: form.tariffMode,
          distanceKm,
          vehicleClassRates,
          status: form.status,
        }),
      })
      const payload: unknown = await response.json()

      if (!response.ok) {
        throw new Error(getError(payload, fallback))
      }

      closeEditor()
      await load()
      if (
        !isEditing &&
        typeof payload === "object" &&
        payload &&
        "item" in payload
      ) {
        const created = payload.item as Route
        if (created.id) router.push(`/routes/${created.id}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallback)
    } finally {
      setSaving(false)
    }
  }

  async function moveStatus(route: Route, status: string) {
    if (
      statuses.find((item) => item.key === status)?.semanticPhase ===
        "archived" &&
      !(await confirmAction({
        title: "Переместить в архив?",
        label: "В архив",
        tone: "archive",
      }))
    )
      return false
    if (route.status === status) return false
    setRoutes((current) =>
      current.map((item) =>
        item.id === route.id
          ? {
              ...item,
              status,
              isActive:
                statuses.find((option) => option.key === status)?.isAvailable ??
                item.isActive,
            }
          : item
      )
    )
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
            driverPayMinor: route.driverPayMinor,
            tariffMode: route.tariffMode,
            distanceKm: route.distanceKm,
            vehicleClassRates: route.vehicleClassRates,
            status,
          }),
        }
      )
      const payload: unknown = await response.json()
      if (!response.ok) {
        throw new Error(getError(payload, "Не удалось обновить маршрут."))
      }
      return true
    } catch (reason) {
      setRoutes((current) =>
        current.map((item) =>
          item.id === route.id && item.status === status
            ? { ...item, status: route.status, isActive: route.isActive }
            : item
        )
      )
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось обновить маршрут."
      )
      return false
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
    >
      <section className="space-y-4">
        <AdminNotice
          message={error}
          variant="error"
          title="Не удалось выполнить действие"
        />

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
                className="h-11 rounded-xl border border-border bg-control px-3 font-normal transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                maxLength={160}
                onChange={(event) => updateForm("name", event.target.value)}
                required
                value={form.name}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Зарплата водителя за маршрут
              <Input
                className="h-11 rounded-xl border border-border bg-control px-3 font-normal tabular-nums"
                inputMode="decimal"
                min="0"
                onChange={(event) =>
                  updateForm("driverPay", event.target.value)
                }
                step="0.01"
                type="number"
                value={form.driverPay}
              />
              <span className="text-xs font-normal text-muted-foreground">
                Сумма за один выполненный рейс в валюте маршрута.
              </span>
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-semibold">
              Основной водитель
              <FieldSelect
                aria-label="Основной водитель"
                value={form.defaultDriverId}
                onValueChange={(value) => updateForm("defaultDriverId", value)}
                disabled={driversLoading || driversError}
                disabledReason={
                  driversLoading
                    ? "Загружаем водителей. Дождитесь завершения."
                    : "Не удалось загрузить водителей. Обновите страницу."
                }
                options={[
                  { value: "", label: "Назначать в рейсе" },
                  ...driverChoices.map((driver) => ({
                    value: driver.id,
                    label: driver.name,
                  })),
                ]}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Валюта
              <FieldSelect
                aria-label="Валюта маршрута"
                value={form.currency}
                onValueChange={(value) => updateForm("currency", value)}
                options={[
                  ...new Set([currency, "EUR", "UAH", "PLN", "USD"]),
                ].map((value) => ({ value, label: value }))}
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
              Расчёт стоимости для клиента
              <FieldSelect
                onValueChange={(value) =>
                  updateForm("tariffMode", value as RouteForm["tariffMode"])
                }
                options={[
                  { value: "fixed", label: "Заданная цена" },
                  { value: "per_km", label: "По расстоянию и классу авто" },
                ]}
                value={form.tariffMode}
              />
            </label>
            {(
              [
                ["origin", "Город отправления"],
                ["destination", "Город прибытия"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="grid min-w-0 gap-2 text-sm font-semibold"
              >
                {label}
                <Input
                  required
                  maxLength={120}
                  value={form[key]}
                  onChange={(event) => updateForm(key, event.target.value)}
                />
              </label>
            ))}
            <RouteNavigationDraft
              value={navigation}
              onChange={setNavigation}
              onBusyChange={setRoadBusy}
            />
            <div className="grid gap-2 text-sm font-semibold">
              <span>Расстояние по дороге</span>
              <output
                className="text-sm font-normal text-muted-foreground"
                aria-live="polite"
              >
                {roadBusy
                  ? "Рассчитываем…"
                  : navigation.distanceMeters
                    ? `${(navigation.distanceMeters / 1000).toFixed(2)} км`
                    : "Выберите отправление и прибытие"}
              </output>
            </div>
            {form.tariffMode === "per_km" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3 md:col-span-2">
                  {(["minivan", "microbus", "bus"] as const).map(
                    (vehicleClass) => (
                      <label
                        className="grid gap-2 text-sm font-semibold"
                        key={vehicleClass}
                      >
                        Цена за км ·{" "}
                        {
                          {
                            minivan: "Минивэн",
                            microbus: "Микроавтобус",
                            bus: "Автобус",
                          }[vehicleClass]
                        }
                        <Input
                          inputMode="decimal"
                          min="0"
                          onChange={(event) =>
                            updateForm("classRates", {
                              ...form.classRates,
                              [vehicleClass]: event.target.value,
                            })
                          }
                          step="0.01"
                          type="number"
                          value={form.classRates[vehicleClass] ?? ""}
                        />
                      </label>
                    )
                  )}
                </div>
              </>
            ) : null}
            <div className="grid gap-2 text-sm font-semibold">
              <span>Статус</span>
              <RouteStatusField
                value={form.status}
                onValueChange={(value) => updateForm("status", value)}
              />
            </div>
            {form.tariffMode === "fixed" ? (
              <label className="grid gap-2 text-sm font-semibold">
                {form.defaultPricingMode === "per_booking"
                  ? "Цена за всю бронь"
                  : "Цена за пассажира"}
                <Input
                  className="h-11 rounded-xl border border-border bg-control px-3 font-normal tabular-nums transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                  inputMode="decimal"
                  min="0"
                  onChange={(event) => updateForm("price", event.target.value)}
                  placeholder="Укажите цену"
                  required
                  step="0.01"
                  type="number"
                  value={form.price}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Стоимость для клиента. Её можно изменить в рейсе.
                </span>
              </label>
            ) : null}
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button
                disabled={saving}
                disabledReason={"Данные сохраняются. Дождитесь завершения."}
                onClick={closeEditor}
                type="button"
                variant="ghost"
              >
                Отмена
              </Button>
              <Button
                disabled={
                  saving ||
                  roadBusy ||
                  !navigation.start ||
                  !navigation.end ||
                  !navigation.distanceMeters
                }
                disabledReason={
                  saving
                    ? "Создаём маршрут. Дождитесь завершения."
                    : roadBusy
                      ? "Строим дорогу. Дождитесь завершения."
                      : !navigation.start || !navigation.end
                        ? "Выберите отправление и прибытие на карте или по адресу."
                        : "Постройте дорогу между выбранными местами."
                }
                type="submit"
              >
                {saving
                  ? "Сохраняем…"
                  : isEditing
                    ? "Сохранить изменения"
                    : "Создать маршрут"}
              </Button>
            </div>
          </form>
        ) : null}

        <AdminNotice
          message={selection.error}
          variant="error"
          title="Не удалось обновить маршруты"
        />
        <EntityDataView
          collection="routes"
          columns={columns}
          items={filteredRoutes}
          getId={(item) => item.id}
          getLabel={(item) => item.name}
          loading={loading}
          selected={selection.selected}
          onSelectedChange={selection.setSelected}
          modes={["table", "list", "kanban", "gallery"]}
          groupBy={(item) => item.status}
          kanbanGroups={
            statuses.length
              ? statuses.map((status) => ({
                  id: status.key,
                  label: status.label,
                  tone: status.tone,
                }))
              : activeOptions.map((status) => ({
                  id: status.value,
                  label: status.label,
                  tone: status.tone,
                }))
          }
          onKanbanGroupChange={(item, status) => moveStatus(item, status)}
          filters={[
            {
              id: "status",
              label: "Статус",
              options: statuses.length
                ? statuses.map((status) => ({
                    value: status.key,
                    label: status.label,
                  }))
                : activeOptions,
              matches: (item, value) => item.status === value,
            },
          ]}
          renderRowActions={(item) => (
            <DeliverySwitch
              label={`Доступность маршрута ${item.name}`}
              checked={item.isActive}
              disabled={saving || selection.pending}
              onChange={(checked) =>
                void moveStatus(item, checked ? "active" : "inactive")
              }
            />
          )}
          bulkActions={
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={selection.pending || saving}
                disabledReason={"Дождитесь завершения текущей операции."}
                onClick={() => void bulkStatus("active")}
              >
                Включить
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={selection.pending || saving}
                disabledReason={"Дождитесь завершения текущей операции."}
                onClick={() => void bulkStatus("inactive")}
              >
                Отключить
              </Button>
            </>
          }
          emptyText="Маршрутов не найдено."
        />
      </section>
    </AppShell>
  )
}
