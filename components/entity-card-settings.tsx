"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, Columns2, Plus, Square, Type, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldSelect } from "@/components/ui/field-select"
import {
  defaultCardLayout,
  type CardLayout,
  type CardLayoutKind,
  type CardRow,
  type CardSize,
} from "@/lib/entity-views"

const layouts: { value: CardLayoutKind; label: React.ReactNode }[] = [
  {
    value: "title",
    label: (
      <span className="flex items-center gap-2">
        <Type className="size-3.5" /> Показать название
      </span>
    ),
  },
  {
    value: "one",
    label: (
      <span className="flex items-center gap-2">
        <Square className="size-3.5" /> Одна колонка
      </span>
    ),
  },
  {
    value: "two",
    label: (
      <span className="flex items-center gap-2">
        <Columns2 className="size-3.5" /> Две колонки
      </span>
    ),
  },
]
const sizes: { value: CardSize; label: string }[] = [
  { value: "xs", label: "Очень маленький" },
  { value: "sm", label: "Маленький" },
  { value: "md", label: "Обычный" },
]

function CardSettingsForm({
  columns,
  initial,
  onApply,
  onCancel,
}: {
  columns: { id: string; label: string }[]
  initial: CardLayout
  onApply: (layout: CardLayout) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = React.useState<CardLayout>(initial)
  const options = columns.map((column) => ({
    value: column.id,
    label: column.label,
  }))
  const layoutOptions = layouts.map((layout) => ({
    ...layout,
    disabled: layout.value === "two" && columns.length < 2,
  }))

  function updateRow(index: number, row: CardRow) {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((item, itemIndex) =>
        itemIndex === index ? row : item
      ),
    }))
  }

  function moveRow(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const next = [...current.rows]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return { ...current, rows: next }
    })
  }

  return (
    <>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        <div className="space-y-2 rounded-xl border bg-muted/20 p-2">
          {draft.rows.map((row, index) => {
            const secondOptions = options.filter(
              (option) => option.value !== row.fields[0]
            )
            return (
              <div
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
                key={`${index}-${row.layout}-${row.fields.join(":")}`}
              >
                <div className="flex flex-col">
                  <Button
                    aria-label="Выше"
                    disabled={index === 0}
                    onClick={() => moveRow(index, -1)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    aria-label="Ниже"
                    disabled={index === draft.rows.length - 1}
                    onClick={() => moveRow(index, 1)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronDown />
                  </Button>
                </div>
                <div className="grid items-center gap-2 md:grid-cols-[minmax(0,1fr)_11rem]">
                  <div
                    className={
                      row.layout === "two"
                        ? "grid gap-2 sm:grid-cols-2"
                        : "min-w-0"
                    }
                  >
                    <FieldSelect
                      aria-label="Поле"
                      onValueChange={(field) => {
                        const second =
                          row.fields[1] && row.fields[1] !== field
                            ? row.fields[1]
                            : (secondOptions.find(
                                (option) => option.value !== field
                              )?.value ?? field)
                        updateRow(index, {
                          ...row,
                          fields:
                            row.layout === "two" ? [field, second] : [field],
                        })
                      }}
                      options={options}
                      value={row.fields[0] ?? ""}
                    />
                    {row.layout === "two" ? (
                      <FieldSelect
                        aria-label="Второе поле"
                        onValueChange={(field) =>
                          updateRow(index, {
                            ...row,
                            fields: [row.fields[0] ?? field, field],
                          })
                        }
                        options={secondOptions}
                        value={row.fields[1] ?? ""}
                      />
                    ) : null}
                  </div>
                  <FieldSelect
                    aria-label="Тип отображения"
                    onValueChange={(layout) => {
                      const kind = layout as CardLayoutKind
                      if (kind === "two" && columns.length < 2) return
                      const first = row.fields[0] ?? columns[0]?.id ?? ""
                      const second =
                        columns.find((column) => column.id !== first)?.id ??
                        first
                      updateRow(index, {
                        layout: kind,
                        fields: kind === "two" ? [first, second] : [first],
                      })
                    }}
                    options={layoutOptions}
                    value={row.layout}
                  />
                </div>
                <Button
                  aria-label="Убрать строку"
                  disabled={draft.rows.length === 1}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      rows: current.rows.filter(
                        (_, itemIndex) => itemIndex !== index
                      ),
                    }))
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <X />
                </Button>
              </div>
            )
          })}
          <Button
            disabled={draft.rows.length >= 12 || columns.length === 0}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                rows: [
                  ...current.rows,
                  {
                    fields: [columns[0]?.id ?? ""],
                    layout: "one",
                  },
                ],
              }))
            }
            size="sm"
            type="button"
            variant="link"
          >
            <Plus />
            Добавить поле
          </Button>
        </div>
        <label className="grid gap-1.5 text-sm">
          Размер карточки
          <FieldSelect
            onValueChange={(size) =>
              setDraft((current) => ({
                ...current,
                size: size as CardSize,
              }))
            }
            options={sizes}
            value={draft.size}
          />
        </label>
      </div>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="outline">
          Отмена
        </Button>
        <Button onClick={() => onApply(draft)} type="button">
          Применить
        </Button>
      </DialogFooter>
    </>
  )
}

export function EntityCardSettings({
  open,
  columns,
  value,
  onOpenChange,
  onApply,
}: {
  open: boolean
  columns: { id: string; label: string }[]
  value?: CardLayout
  onOpenChange: (open: boolean) => void
  onApply: (layout: CardLayout) => void
}) {
  const initial =
    value ?? defaultCardLayout(columns.map((column) => column.id))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Настройка карточки</DialogTitle>
          <DialogDescription>Настроить карточный вид</DialogDescription>
        </DialogHeader>
        {open ? (
          <CardSettingsForm
            columns={columns}
            initial={initial}
            key={JSON.stringify(initial)}
            onApply={onApply}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
