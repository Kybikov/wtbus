"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Edit02Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { FieldSelect } from "@/components/ui/field-select"

type FieldType = "text" | "number" | "date" | "boolean" | "select"
type EntityType = "customer" | "trip" | "booking"

type CustomField = {
  id: string
  entityType: EntityType
  key: string
  label: string
  fieldType: FieldType
  options: string[]
  isRequired: boolean
  isActive: boolean
  position: number
}

type FieldForm = Omit<CustomField, "id" | "position"> & { optionsText: string }

function emptyFieldForm(entityType: EntityType): FieldForm {
  return {
    entityType,
    key: "",
    label: "",
    fieldType: "text",
    options: [],
    optionsText: "",
    isRequired: false,
    isActive: true,
  }
}

const entityOptions: {
  value: EntityType
  label: string
  singular: string
  description: string
}[] = [
  {
    value: "customer",
    label: "Клиенты",
    singular: "клиента",
    description: "Данные, которые нужны о пассажире.",
  },
  {
    value: "trip",
    label: "Рейсы",
    singular: "рейса",
    description: "Операционные детали конкретного рейса.",
  },
  {
    value: "booking",
    label: "Брони",
    singular: "брони",
    description: "Дополнительные сведения к бронированию.",
  },
]

function entityMeta(entity: EntityType) {
  return (
    entityOptions.find((option) => option.value === entity) ?? entityOptions[0]
  )
}

const fieldTypeLabels: Record<FieldType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  boolean: "Да / нет",
  select: "Список",
}

function isCollection(value: unknown): value is { items: CustomField[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
}

function slugifyKey(label: string) {
  const transliteration: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "c",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ы: "y",
    э: "e",
    ю: "yu",
    я: "ya",
    і: "i",
    ї: "yi",
    є: "ye",
    ґ: "g",
  }
  return Array.from(label.toLowerCase())
    .map((character) => transliteration[character] ?? character)
    .join("")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 63)
}

function errorFrom(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : fallback
}

export function CustomFieldManager({ disabled }: { disabled: boolean }) {
  const [fields, setFields] = React.useState<CustomField[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [entity, setEntity] = React.useState<EntityType>("customer")
  const [form, setForm] = React.useState<FieldForm>(() =>
    emptyFieldForm("customer")
  )
  const [editingID, setEditingID] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(
        `/api/custom-fields?entity=${encodeURIComponent(entity)}`,
        { cache: "no-store" }
      )
      const payload: unknown = await response.json()
      if (!response.ok || !isCollection(payload))
        throw new Error(
          `Не удалось загрузить поля: ${entityMeta(entity).label.toLowerCase()}.`
        )
      setFields(payload.items)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось загрузить поля."
      )
    } finally {
      setLoading(false)
    }
  }, [entity])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function close() {
    setEditingID(null)
    setForm(emptyFieldForm(entity))
    setOpen(false)
  }

  function startCreate() {
    setError(null)
    setEditingID(null)
    setForm(emptyFieldForm(entity))
    setOpen(true)
  }

  function startEdit(field: CustomField) {
    setError(null)
    setEditingID(field.id)
    setForm({ ...field, optionsText: field.options.join(", ") })
    setOpen(true)
  }

  function chooseEntity(nextEntity: EntityType) {
    if (nextEntity === entity) return
    setEntity(nextEntity)
    setError(null)
    setEditingID(null)
    setForm(emptyFieldForm(nextEntity))
    setOpen(false)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const { optionsText, ...field } = form
    const payload = {
      ...field,
      options:
        form.fieldType === "select"
          ? optionsText
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
    }
    try {
      const response = await fetch(
        editingID
          ? `/api/custom-fields?id=${encodeURIComponent(editingID)}`
          : "/api/custom-fields",
        {
          method: editingID ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
      const body: unknown = await response.json()
      if (!response.ok)
        throw new Error(errorFrom(body, "Не удалось сохранить поле."))
      close()
      await load()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось сохранить поле."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background/25 p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h2 className="font-bold">Дополнительные поля</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Настройте данные отдельно для клиентов, рейсов и бронирований.
          </p>
        </div>
        <Button
          disabled={disabled}
          onClick={startCreate}
          size="sm"
          variant="outline"
        >
          <HugeiconsIcon icon={Add01Icon} size={16} />
          Добавить поле {entityMeta(entity).singular}
        </Button>
      </div>

      <div
        aria-label="Сущность дополнительных полей"
        className="mt-5 inline-flex max-w-full rounded-xl border border-border bg-background p-1"
        role="group"
      >
        {entityOptions.map((option) => (
          <button
            aria-pressed={entity === option.value}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${entity === option.value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            key={option.value}
            onClick={() => chooseEntity(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {entityMeta(entity).description}
      </p>

      {error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {open ? (
        <form
          className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-2"
          onSubmit={submit}
        >
          <div className="sm:col-span-2">
            <h3 className="font-semibold">
              {editingID ? "Изменить поле" : "Новое поле"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Ключ используется для надёжного хранения данных и после создания
              не меняется.
            </p>
          </div>
          <label className="grid gap-2 text-sm font-semibold">
            Название
            <input
              className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              disabled={saving}
              maxLength={120}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  label: event.target.value,
                  key: editingID ? current.key : slugifyKey(event.target.value),
                }))
              }
              required
              value={form.label}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Ключ
            <input
              className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              disabled={saving || editingID !== null}
              maxLength={63}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  key: event.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, ""),
                }))
              }
              pattern="[a-z][a-z0-9_]{1,62}"
              required
              value={form.key}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Тип
            <FieldSelect
              disabled={saving || editingID !== null}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  fieldType: value as FieldType,
                  optionsText: value === "select" ? current.optionsText : "",
                }))
              }
              options={(Object.keys(fieldTypeLabels) as FieldType[]).map(
                (type) => ({ value: type, label: fieldTypeLabels[type] })
              )}
              value={form.fieldType}
            />
          </label>
          <label className="flex items-center gap-3 self-end pb-3 text-sm font-semibold">
            <input
              checked={form.isRequired}
              disabled={saving}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isRequired: event.target.checked,
                }))
              }
              type="checkbox"
            />
            Обязательное поле
          </label>
          {form.fieldType === "select" ? (
            <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
              Варианты через запятую
              <input
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={saving}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    optionsText: event.target.value,
                  }))
                }
                placeholder="Например, Новый, Постоянный, VIP"
                required
                value={form.optionsText}
              />
            </label>
          ) : null}
          {editingID ? (
            <label className="flex items-center gap-3 text-sm font-semibold sm:col-span-2">
              <input
                checked={form.isActive}
                disabled={saving}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Показывать это поле сотрудникам
            </label>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button
              disabled={saving}
              onClick={close}
              type="button"
              variant="ghost"
            >
              Отмена
            </Button>
            <Button disabled={saving} type="submit">
              {saving ? "Сохраняем…" : editingID ? "Сохранить" : "Создать поле"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-5 divide-y divide-border border-t border-border">
        {loading ? (
          <p className="py-4 text-sm text-muted-foreground">Загружаем поля…</p>
        ) : null}
        {!loading && fields.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Дополнительных полей для этой сущности пока нет.
          </p>
        ) : null}
        {!loading
          ? fields.map((field) => (
              <div
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                key={field.id}
              >
                <div>
                  <p className="font-semibold">
                    {field.label}
                    {field.isRequired ? (
                      <span className="text-primary"> *</span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {field.key} · {fieldTypeLabels[field.fieldType]}
                    {!field.isActive ? " · скрыто" : ""}
                  </p>
                </div>
                <Button
                  disabled={disabled}
                  onClick={() => startEdit(field)}
                  size="sm"
                  variant="ghost"
                >
                  <HugeiconsIcon icon={Edit02Icon} size={16} />
                  Изменить
                </Button>
              </div>
            ))
          : null}
      </div>
    </section>
  )
}
