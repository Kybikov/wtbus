"use client"

import { metricValue } from "@/lib/entity-metrics"
import { sessionFetch } from "@/lib/session-navigation"
import { usePageSearch } from "@/hooks/use-page-search"

import * as React from "react"

import { AppShell } from "@/components/app-shell"
import {
  EntityDataView,
  type EntityColumn,
} from "@/components/entity-data-view"
import { ThemeCustomizer } from "@/components/operations-dashboard"
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
import { Textarea } from "@/components/ui/textarea"

type Customer = {
  id: string
  fullName: string
  phone: string
  email?: string
  telegramId?: number
  notes?: string
  customData?: Record<string, unknown>
  tripCount: number
  lifetimeValue: CustomerRevenue[]
}

type CustomerRevenue = {
  currency: string
  amountMinor: number
}

type CustomerBookingHistory = {
  id: string
  status: string
  origin: string
  destination: string
  startsAt: string
  seats: number
  priceMinor: number
  currency: string
}

type CustomField = {
  id: string
  key: string
  label: string
  fieldType: "text" | "number" | "date" | "boolean" | "select"
  options: string[]
  isRequired: boolean
  isActive: boolean
}

type CustomerForm = {
  fullName: string
  phone: string
  email: string
  telegramId: string
  notes: string
  customData: Record<string, string | boolean>
}

const emptyForm: CustomerForm = {
  fullName: "",
  phone: "",
  email: "",
  telegramId: "",
  notes: "",
  customData: {},
}

function isCustomerCollection(
  value: unknown
): value is { items: Customer[]; total: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
}

function isCustomFieldCollection(
  value: unknown
): value is { items: CustomField[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
}

function isCustomerDetails(
  value: unknown
): value is { bookingHistory: CustomerBookingHistory[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "bookingHistory" in value &&
    Array.isArray(value.bookingHistory)
  )
}

function customValueToText(value: unknown) {
  if (typeof value === "boolean") return value ? "Да" : "Нет"
  if (typeof value === "number" || typeof value === "string")
    return String(value)
  return ""
}

function formatCustomerMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100)
}

function formatCustomerLifetimeValue(values: CustomerRevenue[]) {
  if (!values.length) return "Нет подтверждённых оплат"
  return values
    .map((value) => formatCustomerMoney(value.amountMinor, value.currency))
    .join(" · ")
}

function formatTripCount(count: number) {
  const remainder = Math.abs(count) % 100
  const lastDigit = remainder % 10
  if (remainder > 10 && remainder < 20) return `${count} поездок`
  if (lastDigit === 1) return `${count} поездка`
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} поездки`
  return `${count} поездок`
}

function bookingStatusLabel(status: string) {
  const labels: Record<string, string> = {
    awaiting_payment: "Ожидает оплаты",
    cash_on_boarding: "Наличными при посадке",
    cancelled: "Отменено",
    completed: "Завершено",
    confirmed: "Подтверждено",
    expired: "Истекло",
    pending: "Новая бронь",
  }
  return labels[status] ?? status
}

function buildCustomData(
  fields: CustomField[],
  values: CustomerForm["customData"]
) {
  const result: Record<string, string | number | boolean> = {}
  for (const field of fields) {
    const value = values[field.key]
    if (field.fieldType === "boolean") {
      result[field.key] = value === true
      continue
    }
    if (typeof value !== "string" || value.trim() === "") continue
    result[field.key] =
      field.fieldType === "number" ? Number(value) : value.trim()
  }
  return result
}

function formFromCustomer(customer: Customer): CustomerForm {
  const customData: CustomerForm["customData"] = {}
  for (const [key, value] of Object.entries(customer.customData ?? {})) {
    if (typeof value === "boolean" || typeof value === "string")
      customData[key] = value
    else if (typeof value === "number") customData[key] = String(value)
  }
  return {
    fullName: customer.fullName,
    phone: customer.phone,
    email: customer.email ?? "",
    telegramId: customer.telegramId?.toString() ?? "",
    notes: customer.notes ?? "",
    customData,
  }
}

export function CustomerDirectory() {
  const [query, setQuery] = usePageSearch()
  const [appliedQuery, setAppliedQuery] = React.useState("")
  const [customers, setCustomers] = React.useState<Customer[]>([])
  const [customFields, setCustomFields] = React.useState<CustomField[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)
  const [editingID, setEditingID] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<CustomerForm>(emptyForm)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const importInput = React.useRef<HTMLInputElement>(null)
  const [importing, setImporting] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [expandedHistoryID, setExpandedHistoryID] = React.useState<
    string | null
  >(null)
  const [historyByCustomer, setHistoryByCustomer] = React.useState<
    Record<string, CustomerBookingHistory[]>
  >({})
  const [historyLoadingID, setHistoryLoadingID] = React.useState<string | null>(
    null
  )
  const [historyError, setHistoryError] = React.useState<string | null>(null)
  const [importResult, setImportResult] = React.useState<{
    created: number
    updated: number
    skipped: number
    issues: { row: number; message: string }[]
  } | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const loadController = React.useRef<AbortController | null>(null)
  const load = React.useCallback(async () => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setLoading(true)
    setError(null)
    try {
      const [response, fieldsResponse] = await Promise.all([
        sessionFetch(
          `/api/customers?q=${encodeURIComponent(appliedQuery)}&limit=50`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10_000),
            ]),
          }
        ),
        sessionFetch("/api/custom-fields", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10_000),
          ]),
        }),
      ])
      const [payload, fieldsPayload]: [unknown, unknown] = await Promise.all([
        response.json(),
        fieldsResponse.json(),
      ])
      if (
        !response.ok ||
        !isCustomerCollection(payload) ||
        !fieldsResponse.ok ||
        !isCustomFieldCollection(fieldsPayload)
      )
        throw new Error("Не удалось загрузить клиентов.")
      if (controller.signal.aborted) return
      setCustomers(payload.items)
      setTotal(payload.total)
      setCustomFields(fieldsPayload.items.filter((field) => field.isActive))
    } catch (reason) {
      if (controller.signal.aborted) return
      setCustomers([])
      setCustomFields([])
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить клиентов."
      )
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [appliedQuery])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      loadController.current?.abort()
    }
  }, [load])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const telegramId = form.telegramId.trim()
        ? Number(form.telegramId)
        : undefined
      const customData = buildCustomData(customFields, form.customData)
      const isEditing = editingID !== null
      const response = await sessionFetch(
        isEditing
          ? `/api/customers?id=${encodeURIComponent(editingID)}`
          : "/api/customers",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, telegramId, customData }),
        }
      )
      const payload: unknown = await response.json()
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : isEditing
              ? "Не удалось обновить клиента."
              : "Не удалось создать клиента."
        throw new Error(message)
      }
      setOpen(false)
      setEditingID(null)
      setForm(emptyForm)
      await load()
    } catch (reason) {
      setFormError(
        reason instanceof Error
          ? reason.message
          : editingID
            ? "Не удалось обновить клиента."
            : "Не удалось создать клиента."
      )
    } finally {
      setSaving(false)
    }
  }

  async function importFile(file: File) {
    setImporting(true)
    setError(null)
    setImportResult(null)
    try {
      const body = new FormData()
      body.set("file", file)
      const response = await sessionFetch("/api/customers/import", {
        method: "POST",
        body,
      })
      const payload: unknown = await response.json()
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("created" in payload)
      )
        throw new Error(
          typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : "Не удалось импортировать клиентов."
        )
      setImportResult(
        payload as {
          created: number
          updated: number
          skipped: number
          issues: { row: number; message: string }[]
        }
      )
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось импортировать клиентов."
      )
    } finally {
      setImporting(false)
    }
  }

  async function exportCustomers() {
    setExporting(true)
    setError(null)
    try {
      const response = await sessionFetch("/api/customers?export=xlsx", {
        cache: "no-store",
      })
      if (!response.ok) throw new Error("Не удалось выгрузить базу клиентов.")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "vivat-customers.xlsx"
      link.click()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось выгрузить базу клиентов."
      )
    } finally {
      setExporting(false)
    }
  }

  async function toggleHistory(customerID: string) {
    if (expandedHistoryID === customerID) {
      setExpandedHistoryID(null)
      setHistoryError(null)
      return
    }
    setExpandedHistoryID(customerID)
    setHistoryError(null)
    if (historyByCustomer[customerID]) return

    setHistoryLoadingID(customerID)
    try {
      const response = await sessionFetch(
        `/api/customers/${encodeURIComponent(customerID)}`,
        { cache: "no-store" }
      )
      const payload: unknown = await response.json()
      if (!response.ok || !isCustomerDetails(payload))
        throw new Error("Не удалось загрузить историю бронирований.")
      setHistoryByCustomer((current) => ({
        ...current,
        [customerID]: payload.bookingHistory,
      }))
    } catch (reason) {
      setHistoryError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить историю бронирований."
      )
    } finally {
      setHistoryLoadingID(null)
    }
  }

  const columns: EntityColumn<Customer>[] = [
    {
      id: "name",
      label: "Клиент",
      value: (customer) => (
        <span className="font-semibold">
          {customer.fullName || "Без имени"}
        </span>
      ),
      text: (customer) => customer.fullName,
    },
    {
      id: "phone",
      label: "Телефон",
      value: (customer) => customer.phone,
      text: (customer) => customer.phone,
    },
    {
      id: "email",
      label: "Email",
      value: (customer) => customer.email || "—",
      text: (customer) => customer.email ?? "",
    },
    {
      id: "trips",
      metric: { kind: "number", getValue: (customer) => customer.tripCount },
      label: "Поездки",
      value: (customer) => (
        <span className="tabular-nums">
          {formatTripCount(customer.tripCount)}
        </span>
      ),
    },
    {
      id: "ltv",
      metric: {
        kind: "money",
        getValue: (customer) =>
          customer.lifetimeValue.map((value) => ({
            amountMinor: value.amountMinor,
            currency: value.currency,
          })),
      },
      label: "LTV",
      value: (customer) => (
        <span className="tabular-nums">
          {formatCustomerLifetimeValue(customer.lifetimeValue)}
        </span>
      ),
    },
    {
      id: "telegram",
      metric: { kind: "text", getValue: (customer) => customer.telegramId },
      label: "Telegram",
      defaultVisible: false,
      value: (customer) =>
        customer.telegramId ? String(customer.telegramId) : "Не привязан",
    },
    {
      id: "notes",
      metric: { kind: "text", getValue: (customer) => customer.notes },
      label: "Комментарий",
      defaultVisible: false,
      value: (customer) => customer.notes || "—",
    },
    {
      id: "id",
      metric: { kind: "text", getValue: (customer) => customer.id },
      label: "ID",
      defaultVisible: false,
      value: (customer) => <code className="text-xs">{customer.id}</code>,
    },
    ...customFields.map<EntityColumn<Customer>>((field) => ({
      id: `custom-${field.key}`,
      metric: {
        kind: field.fieldType === "select" ? "enum" : field.fieldType,
        getValue: (customer) => metricValue(customer.customData?.[field.key]),
        options:
          field.fieldType === "select"
            ? field.options.map((value) => ({ value, label: value }))
            : field.fieldType === "boolean"
              ? [
                  { value: "true", label: "Да" },
                  { value: "false", label: "Нет" },
                ]
              : undefined,
      },
      label: field.label,
      defaultVisible: false,
      value: (customer) =>
        customValueToText(customer.customData?.[field.key]) || "—",
    })),
  ]

  const openEditor = (customer: Customer) => {
    setForm(formFromCustomer(customer))
    setEditingID(customer.id)
    setFormError(null)
    setOpen(true)
  }

  return (
    <>
      <AppShell
        collectionFooter
        onRefresh={load}
        refreshing={loading}
        localSearch={{
          value: query,
          onChange: setQuery,
          placeholder: "Имя, телефон или email",
          label: "Поиск клиентов",
        }}
        onCreate={() => {
          setForm(emptyForm)
          setEditingID(null)
          setFormError(null)
          setOpen(true)
        }}
        dataActions={{
          onImport: () => importInput.current?.click(),
          onExport: exportCustomers,
          importing,
          exporting,
        }}
        pageDescription="Контакты, поездки и история обращений"
        pageTitle="Клиенты"
        utilities={<ThemeCustomizer />}
      >
        <input
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importFile(file)
            event.currentTarget.value = ""
          }}
          ref={importInput}
          type="file"
        />
        <div className="w-full min-w-0 space-y-5">
          {error ? (
            <div
              className="rounded-xl border border-destructive/35 bg-destructive/10 p-3 text-sm"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {importResult ? (
            <div className="rounded-2xl border border-primary/35 bg-primary/10 p-4 text-sm">
              <p className="font-bold">
                Импорт завершен: создано {importResult.created}, обновлено{" "}
                {importResult.updated}, пропущено {importResult.skipped}.
              </p>
              {importResult.issues.length ? (
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                  {importResult.issues.map((issue) => (
                    <li key={`${issue.row}-${issue.message}`}>
                      Строка {issue.row}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <EntityDataView
            collection="customers"
            totalCount={total}
            filters={[
              {
                id: "telegram",
                label: "Telegram",
                options: [
                  { value: "linked", label: "Привязан" },
                  { value: "unlinked", label: "Не привязан" },
                ],
                matches: (customer, value) =>
                  Boolean(customer.telegramId) === (value === "linked"),
              },
              {
                id: "trips",
                label: "Поездки",
                options: [
                  { value: "with", label: "Есть поездки" },
                  { value: "without", label: "Без поездок" },
                ],
                matches: (customer, value) =>
                  customer.tripCount > 0 === (value === "with"),
              },
            ]}
            actions={[
              { label: "Редактировать", onSelect: openEditor },
              {
                label: expandedHistoryID
                  ? "Скрыть историю"
                  : "Показать историю",
                onSelect: (customer) => void toggleHistory(customer.id),
              },
            ]}
            columns={columns}
            emptyText="Клиентов не найдено."
            getId={(customer) => customer.id}
            getLabel={(customer) => customer.fullName || customer.phone}
            items={customers}
            loading={loading}
            loadingText="Загружаем клиентов…"
            modes={["table", "list", "gallery"]}
            onSelectedChange={setSelected}
            renderCard={(customer) => (
              <div className="space-y-3">
                <div>
                  <p className="font-semibold">
                    {customer.fullName || "Без имени"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {customer.phone}
                  </p>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {formatTripCount(customer.tripCount)}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCustomerLifetimeValue(customer.lifetimeValue)}
                  </span>
                </div>
              </div>
            )}
            selected={selected}
          />
          {customers.map((customer) =>
            expandedHistoryID === customer.id ? (
              <section
                className="surface-card p-4"
                key={`history-${customer.id}`}
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">
                    История: {customer.fullName || customer.phone}
                  </h2>
                  <Button
                    onClick={() => void toggleHistory(customer.id)}
                    size="sm"
                    variant="ghost"
                  >
                    Закрыть
                  </Button>
                </div>
                {expandedHistoryID === customer.id ? (
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="text-sm font-semibold">
                      История бронирований
                    </p>
                    {historyLoadingID === customer.id ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Загружаем историю…
                      </p>
                    ) : historyError ? (
                      <p className="mt-2 text-sm text-destructive" role="alert">
                        {historyError}
                      </p>
                    ) : historyByCustomer[customer.id]?.length ? (
                      <ul className="mt-2 divide-y divide-border">
                        {historyByCustomer[customer.id].map((booking) => (
                          <li
                            className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                            key={booking.id}
                          >
                            <span className="font-medium">
                              {booking.origin} → {booking.destination}
                            </span>
                            <span className="text-muted-foreground tabular-nums">
                              {new Date(booking.startsAt).toLocaleString(
                                "ru-RU",
                                {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                              {` · ${booking.seats} мест · ${formatCustomerMoney(booking.priceMinor, booking.currency)} · ${bookingStatusLabel(booking.status)}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        У клиента пока нет бронирований.
                      </p>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null
          )}
        </div>
      </AppShell>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>
                {editingID ? "Изменить клиента" : "Новый клиент"}
              </DialogTitle>
              <DialogDescription>
                Контактные данные и поля клиентской базы.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 grid gap-3">
              <Input
                className="h-11"
                maxLength={160}
                onChange={(e) =>
                  setForm((v) => ({ ...v, fullName: e.target.value }))
                }
                placeholder="Имя клиента"
                value={form.fullName}
              />
              <Input
                className="h-11"
                onChange={(e) =>
                  setForm((v) => ({ ...v, phone: e.target.value }))
                }
                placeholder="Телефон в международном формате, +380…"
                required
                value={form.phone}
              />
              <Input
                className="h-11"
                onChange={(e) =>
                  setForm((v) => ({ ...v, email: e.target.value }))
                }
                placeholder="Email (необязательно)"
                type="email"
                value={form.email}
              />
              <Input
                className="h-11"
                inputMode="numeric"
                onChange={(e) =>
                  setForm((v) => ({ ...v, telegramId: e.target.value }))
                }
                placeholder="Telegram ID (необязательно)"
                value={form.telegramId}
              />
              <Textarea
                className="min-h-20"
                onChange={(e) =>
                  setForm((v) => ({ ...v, notes: e.target.value }))
                }
                placeholder="Комментарий"
                value={form.notes}
              />
              {customFields.map((field) => (
                <label
                  className="grid gap-2 text-sm font-semibold"
                  key={field.id}
                >
                  {field.label}
                  {field.isRequired ? (
                    <span className="text-primary"> *</span>
                  ) : null}
                  {field.fieldType === "select" ? (
                    <FieldSelect
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          customData: {
                            ...current.customData,
                            [field.key]: value,
                          },
                        }))
                      }
                      options={[
                        { value: "", label: "Выберите вариант" },
                        ...field.options.map((option) => ({
                          value: option,
                          label: option,
                        })),
                      ]}
                      value={
                        typeof form.customData[field.key] === "string"
                          ? (form.customData[field.key] as string)
                          : ""
                      }
                    />
                  ) : field.fieldType === "boolean" ? (
                    <span className="flex h-11 items-center gap-3 rounded-xl border border-border bg-background px-3 font-normal">
                      <Checkbox
                        checked={form.customData[field.key] === true}
                        onCheckedChange={(checked) =>
                          setForm((current) => ({
                            ...current,
                            customData: {
                              ...current.customData,
                              [field.key]: checked === true,
                            },
                          }))
                        }
                      />
                      Да
                    </span>
                  ) : (
                    <Input
                      className="h-11"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          customData: {
                            ...current.customData,
                            [field.key]: event.target.value,
                          },
                        }))
                      }
                      required={field.isRequired}
                      type={
                        field.fieldType === "date"
                          ? "date"
                          : field.fieldType === "number"
                            ? "number"
                            : "text"
                      }
                      value={
                        typeof form.customData[field.key] === "string"
                          ? (form.customData[field.key] as string)
                          : ""
                      }
                    />
                  )}
                </label>
              ))}
            </div>
            {formError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <DialogFooter className="mt-5">
              <Button
                disabled={saving}
                onClick={() => {
                  setOpen(false)
                  setEditingID(null)
                }}
                type="button"
                variant="outline"
              >
                Отмена
              </Button>
              <Button disabled={saving} type="submit">
                {saving
                  ? "Сохраняем…"
                  : editingID
                    ? "Сохранить изменения"
                    : "Создать клиента"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
