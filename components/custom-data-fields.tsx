"use client"

import { FieldSelect } from "@/components/ui/field-select"

export type CustomFieldType = "text" | "number" | "date" | "boolean" | "select"

export type CustomDataField = {
  id: string
  key: string
  label: string
  fieldType: CustomFieldType
  options: string[]
  isRequired: boolean
  isActive: boolean
}

export type CustomDataValues = Record<string, string | boolean>

export function serializeCustomData(
  fields: CustomDataField[],
  values: CustomDataValues
) {
  const result: Record<string, string | number | boolean> = {}
  for (const field of fields) {
    const value = values[field.key]
    if (field.fieldType === "boolean") {
      if (value === true) result[field.key] = true
      continue
    }
    if (typeof value !== "string" || value.trim() === "") continue
    result[field.key] =
      field.fieldType === "number" ? Number(value) : value.trim()
  }
  return result
}

export function CustomDataFields({
  fields,
  values,
  onChange,
  disabled,
}: {
  fields: CustomDataField[]
  values: CustomDataValues
  onChange: (values: CustomDataValues) => void
  disabled?: boolean
}) {
  const activeFields = fields.filter((field) => field.isActive)
  if (activeFields.length === 0) return null

  return (
    <fieldset className="mt-5 border-t border-border pt-5">
      <legend className="px-0 text-sm font-bold">Дополнительные данные</legend>
      <p className="mt-1 text-sm text-muted-foreground">
        Поля, которые настроены для этой сущности.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {activeFields.map((field) => {
          const value = values[field.key]
          const common = {
            disabled,
            required: field.isRequired,
            name: `custom-${field.key}`,
          }
          if (field.fieldType === "boolean") {
            return (
              <label
                className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-background px-3 text-sm font-semibold sm:col-span-2"
                key={field.id}
              >
                <input
                  {...common}
                  checked={value === true}
                  onChange={(event) =>
                    onChange({ ...values, [field.key]: event.target.checked })
                  }
                  type="checkbox"
                />
                {field.label}
                {field.isRequired ? (
                  <span className="text-primary" aria-hidden="true">
                    *
                  </span>
                ) : null}
              </label>
            )
          }
          if (field.fieldType === "select") {
            return (
              <label
                className="grid gap-2 text-sm font-semibold"
                key={field.id}
              >
                {field.label}
                {field.isRequired ? (
                  <span className="text-primary" aria-hidden="true">
                    {" "}
                    *
                  </span>
                ) : null}
                <FieldSelect
                  disabled={common.disabled}
                  onValueChange={(nextValue) =>
                    onChange({ ...values, [field.key]: nextValue })
                  }
                  options={[
                    { value: "", label: "Выберите значение" },
                    ...field.options.map((option) => ({
                      value: option,
                      label: option,
                    })),
                  ]}
                  value={typeof value === "string" ? value : ""}
                />
              </label>
            )
          }
          return (
            <label className="grid gap-2 text-sm font-semibold" key={field.id}>
              {field.label}
              {field.isRequired ? (
                <span className="text-primary" aria-hidden="true">
                  {" "}
                  *
                </span>
              ) : null}
              <input
                {...common}
                className="h-11 rounded-xl border border-border bg-background px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                maxLength={field.fieldType === "text" ? 4000 : undefined}
                min={field.fieldType === "number" ? "0" : undefined}
                onChange={(event) =>
                  onChange({ ...values, [field.key]: event.target.value })
                }
                type={
                  field.fieldType === "date"
                    ? "date"
                    : field.fieldType === "number"
                      ? "number"
                      : "text"
                }
                value={typeof value === "string" ? value : ""}
              />
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
