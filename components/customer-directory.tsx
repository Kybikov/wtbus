"use client"

import { sessionFetch } from "@/lib/session-navigation"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Edit02Icon, Search01Icon } from "@hugeicons/core-free-icons"

import { AppShell } from "@/components/app-shell"
import { ThemeCustomizer } from "@/components/operations-dashboard"
import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"

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
  const [query, setQuery] = React.useState("")
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

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [response, fieldsResponse] = await Promise.all([
        sessionFetch(`/api/customers?q=${encodeURIComponent(appliedQuery)}&limit=50`),
        sessionFetch("/api/custom-fields", { cache: "no-store" }),
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
      setCustomers(payload.items)
      setTotal(payload.total)
      setCustomFields(fieldsPayload.items.filter((field) => field.isActive))
    } catch (reason) {
      setCustomers([])
      setCustomFields([])
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить клиентов."
      )
    } finally {
      setLoading(false)
    }
  }, [appliedQuery])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
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

  return (
    <>
      <AppShell pageTitle="Клиенты" utilities={<ThemeCustomizer />}>
        <div className="mx-auto max-w-[1600px] space-y-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-bold tracking-[-.035em] sm:text-3xl">
                Клиентская база
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {total} клиентов в CRM. Поиск работает по имени, телефону и
                email.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
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
              <Button
                disabled={importing}
                onClick={() => importInput.current?.click()}
                size="lg"
                variant="outline"
              >
                {importing ? "Импортируем…" : "Импорт CSV / XLSX"}
              </Button>
              <Button
                disabled={exporting}
                onClick={() => void exportCustomers()}
                size="lg"
                variant="outline"
              >
                {exporting ? "Выгружаем…" : "Экспорт XLSX"}
              </Button>
              <Button
                onClick={() => {
                  setForm(emptyForm)
                  setEditingID(null)
                  setFormError(null)
                  setOpen(true)
                }}
                size="lg"
              >
                <HugeiconsIcon icon={Add01Icon} size={18} />
                Добавить клиента
              </Button>
            </div>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setAppliedQuery(query)
            }}
          >
            <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3">
              <HugeiconsIcon icon={Search01Icon} size={17} />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Имя, телефон или email"
                value={query}
              />
            </div>
            <Button type="submit" variant="outline">
              Найти
            </Button>
          </form>
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
          <section className="surface-card divide-y divide-border">
            {loading ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Загружаем клиентов…
              </p>
            ) : customers.length ? (
              customers.map((customer) => (
                <article className="p-4" key={customer.id}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-bold">
                        {customer.fullName || "Без имени"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {customer.phone}
                        {customer.email ? ` · ${customer.email}` : ""}
                      </p>
                      {Object.entries(customer.customData ?? {}).length ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {Object.entries(customer.customData ?? {})
                            .map(
                              ([key, value]) =>
                                `${customFields.find((field) => field.key === key)?.label ?? key}: ${customValueToText(value)}`
                            )
                            .join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[11rem] text-sm tabular-nums">
                        <p className="font-semibold">
                          {formatTripCount(customer.tripCount)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          LTV:{" "}
                          {formatCustomerLifetimeValue(customer.lifetimeValue)}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {customer.telegramId
                          ? `Telegram ID: ${customer.telegramId}`
                          : "Telegram не привязан"}
                      </p>
                      <Button
                        onClick={() => void toggleHistory(customer.id)}
                        size="sm"
                        variant="outline"
                      >
                        {expandedHistoryID === customer.id
                          ? "Скрыть историю"
                          : "История"}
                      </Button>
                      <Button
                        onClick={() => {
                          setForm(formFromCustomer(customer))
                          setEditingID(customer.id)
                          setFormError(null)
                          setOpen(true)
                        }}
                        size="sm"
                        variant="outline"
                      >
                        <HugeiconsIcon icon={Edit02Icon} size={15} />
                        Изменить
                      </Button>
                    </div>
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
                        <p
                          className="mt-2 text-sm text-destructive"
                          role="alert"
                        >
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
                </article>
              ))
            ) : (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Клиентов не найдено.
              </p>
            )}
          </section>
        </div>
      </AppShell>
      {open ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6"
          role="dialog"
        >
          <form
            className="w-full rounded-t-[var(--app-radius)] border border-border bg-card p-5 sm:max-w-lg sm:rounded-[var(--app-radius)]"
            onSubmit={submit}
          >
            <h2 className="text-xl font-bold">
              {editingID ? "Изменить клиента" : "Новый клиент"}
            </h2>
            <div className="mt-5 grid gap-3">
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 text-sm"
                maxLength={160}
                onChange={(e) =>
                  setForm((v) => ({ ...v, fullName: e.target.value }))
                }
                placeholder="Имя клиента"
                value={form.fullName}
              />
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 text-sm"
                onChange={(e) =>
                  setForm((v) => ({ ...v, phone: e.target.value }))
                }
                placeholder="Телефон в международном формате, +380…"
                required
                value={form.phone}
              />
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 text-sm"
                onChange={(e) =>
                  setForm((v) => ({ ...v, email: e.target.value }))
                }
                placeholder="Email (необязательно)"
                type="email"
                value={form.email}
              />
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 text-sm"
                inputMode="numeric"
                onChange={(e) =>
                  setForm((v) => ({ ...v, telegramId: e.target.value }))
                }
                placeholder="Telegram ID (необязательно)"
                value={form.telegramId}
              />
              <textarea
                className="min-h-20 rounded-xl border border-border bg-background p-3 text-sm"
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
                      <input
                        checked={form.customData[field.key] === true}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            customData: {
                              ...current.customData,
                              [field.key]: event.target.checked,
                            },
                          }))
                        }
                        type="checkbox"
                      />
                      Да
                    </span>
                  ) : (
                    <input
                      className="h-11 rounded-xl border border-border bg-background px-3 font-normal"
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
            <div className="mt-5 flex justify-end gap-2">
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
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
