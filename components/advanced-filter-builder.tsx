"use client"
import { useState } from "react"
import { Check, ChevronsUpDown, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command"
import {
  countQuery,
  fieldOperators,
  fieldOperatorLabel,
  type FilterGroup,
  type FilterRule,
  type QueryFieldChoice,
} from "@/lib/entity-query"
const id = () => crypto.randomUUID()
export function newFilterGroup(): FilterGroup {
  return { id: id(), combinator: "and", rules: [] }
}
export function QueryChoice({
  label,
  options,
  values,
  onChange,
  multiple = false,
}: {
  label: string
  options: { value: string; label: string }[]
  values: string[]
  onChange: (values: string[]) => void
  multiple?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            className="w-full min-w-0 justify-between font-normal"
          />
        }
      >
        <span className="truncate">
          {values.length
            ? options
                .filter((o) => values.includes(o.value))
                .map((o) => o.label)
                .join(", ") || values.join(", ")
            : label}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 max-w-[calc(100vw-3rem)] p-1"
      >
        <Command>
          <CommandInput placeholder="Найти…" aria-label={`Поиск: ${label}`} />
          <CommandList>
            <CommandEmpty>Ничего не найдено.</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={`${option.label} ${option.value}`}
                onSelect={() => {
                  onChange(
                    multiple
                      ? values.includes(option.value)
                        ? values.filter((v) => v !== option.value)
                        : [...values, option.value]
                      : [option.value]
                  )
                  if (!multiple) setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {values.includes(option.value) && (
                  <Check className="ml-auto text-emerald-500!" />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
export function AdvancedFilterBuilder({
  group,
  fields,
  onChange,
  depth = 0,
  total = countQuery(group),
}: {
  group: FilterGroup
  fields: QueryFieldChoice[]
  onChange: (next: FilterGroup) => void
  depth?: number
  total?: number
}) {
  const update = (node: FilterRule | FilterGroup) =>
    onChange({
      ...group,
      rules: group.rules.map((current) =>
        current.id === node.id ? node : current
      ),
    })
  const remove = (node: string) =>
    onChange({
      ...group,
      rules: group.rules.filter((current) => current.id !== node),
    })
  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-border bg-background/25 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-48">
          <FieldSelect
            aria-label="Объединение условий"
            value={group.combinator}
            onValueChange={(combinator) =>
              onChange({ ...group, combinator: combinator as "and" | "or" })
            }
            options={[
              { value: "and", label: "Все условия · И" },
              { value: "or", label: "Любое условие · ИЛИ" },
            ]}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {depth ? "в этой группе" : "между условиями и группами"}
        </span>
      </div>
      <div className="space-y-3">
        {group.rules.map((node) =>
          "rules" in node ? (
            <div key={node.id} className="relative min-w-0 pl-3">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Удалить группу"
                className="absolute top-2 right-2 z-10"
                onClick={() => remove(node.id)}
              >
                <X />
              </Button>
              <AdvancedFilterBuilder
                group={node}
                fields={fields}
                depth={depth + 1}
                total={total}
                onChange={update}
              />
            </div>
          ) : (
            <div
              key={node.id}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1fr)_2rem]"
            >
              <div className="min-w-0">
                <QueryChoice
                  label="Колонка"
                  options={fields.map((field) => ({
                    value: field.id,
                    label: field.label,
                  }))}
                  values={[node.field]}
                  onChange={([field]) => {
                    const selected = fields.find((f) => f.id === field)
                    update({
                      ...node,
                      field,
                      operator: fieldOperators(selected?.kind ?? "text")[0],
                      value: [],
                    })
                  }}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="sm:order-4"
                aria-label="Удалить условие"
                onClick={() => remove(node.id)}
              >
                <X />
              </Button>
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <FieldSelect
                  aria-label="Условие"
                  value={node.operator}
                  onValueChange={(operator) =>
                    update({
                      ...node,
                      operator: operator as FilterRule["operator"],
                      value:
                        operator === "between"
                          ? [node.value[0] ?? "", node.value[1] ?? ""]
                          : node.operator === "between"
                            ? node.value.slice(0, 1)
                            : node.value,
                    })
                  }
                  options={fieldOperators(
                    fields.find((f) => f.id === node.field)?.kind ?? "text"
                  ).map((value) => ({
                    value,
                    label: fieldOperatorLabel(
                      value,
                      fields.find((f) => f.id === node.field)?.kind
                    ),
                  }))}
                />
              </div>
              <div className="col-span-2 min-w-0 sm:col-span-1">
                {node.operator === "between" ? (
                  <div className="grid min-w-0 gap-2">
                    <Input
                      aria-label="Дата с"
                      type="date"
                      value={node.value[0] ?? ""}
                      max={node.value[1] || undefined}
                      onChange={(event) =>
                        update({
                          ...node,
                          value: [event.target.value, node.value[1] ?? ""],
                        })
                      }
                    />
                    <Input
                      aria-label="Дата по"
                      type="date"
                      value={node.value[1] ?? ""}
                      min={node.value[0] || undefined}
                      onChange={(event) =>
                        update({
                          ...node,
                          value: [node.value[0] ?? "", event.target.value],
                        })
                      }
                    />
                  </div>
                ) : ["empty", "notEmpty"].includes(node.operator) ? (
                  <span className="flex h-10 items-center px-3 text-sm text-muted-foreground">
                    Без значения
                  </span>
                ) : fields.find((f) => f.id === node.field)?.options?.length ? (
                  <QueryChoice
                    label="Значение"
                    multiple={
                      node.operator === "in" || node.operator === "notIn"
                    }
                    options={fields.find((f) => f.id === node.field)!.options!}
                    values={node.value}
                    onChange={(value) => update({ ...node, value })}
                  />
                ) : (
                  <Input
                    aria-label="Значение"
                    type={
                      fields.find((f) => f.id === node.field)?.kind === "number"
                        ? "number"
                        : fields.find((f) => f.id === node.field)?.kind ===
                            "date"
                          ? "date"
                          : "text"
                    }
                    value={node.value[0] ?? ""}
                    onChange={(event) =>
                      update({ ...node, value: [event.target.value] })
                    }
                  />
                )}
              </div>
            </div>
          )
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={total >= 30 || !fields.length}
          onClick={() =>
            onChange({
              ...group,
              rules: [
                ...group.rules,
                {
                  id: id(),
                  field: fields[0].id,
                  operator: fieldOperators(fields[0].kind)[0],
                  value: [],
                },
              ],
            })
          }
        >
          <Plus />
          Условие
        </Button>
        {depth < 2 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={total >= 30}
            onClick={() =>
              onChange({ ...group, rules: [...group.rules, newFilterGroup()] })
            }
          >
            <Plus />
            Группа
          </Button>
        )}
      </div>
    </div>
  )
}
