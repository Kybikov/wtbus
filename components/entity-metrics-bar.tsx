"use client"

import { Activity, Info, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { adminControlClassName } from "@/lib/admin-ui"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"
import {
  calculateMetric,
  metricKey,
  metricLabels,
  metricOperations,
  MAX_VIEW_METRICS,
  type EntityMetric,
  type MetricField,
} from "@/lib/entity-metrics"

type Props<T> = {
  items: T[]
  total: number
  loadedCount: number
  selectedCount: number
  fields: MetricField<T>[]
  metrics: EntityMetric[]
  onChange: (metrics: EntityMetric[]) => void
  loading: boolean
}
const numberFormat = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
})
const tones = {
  success: "text-emerald-500",
  warning: "text-amber-500",
  danger: "text-red-500",
  info: "text-sky-500",
  violet: "text-violet-500",
  neutral: "text-muted-foreground",
}
export function EntityMetricsBar<T>({
  items,
  total,
  loadedCount,
  selectedCount,
  fields,
  metrics,
  onChange,
  loading,
}: Props<T>) {
  const partial = loadedCount < total
  function add(metric: EntityMetric) {
    if (
      metrics.length < MAX_VIEW_METRICS &&
      !metrics.some((item) => metricKey(item) === metricKey(metric))
    )
      onChange([...metrics, metric])
  }
  const count = (label: string, value: number) => (
    <div className="flex h-8 shrink-0 items-center gap-2 px-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <strong className="text-sm tabular-nums">
        {loading ? "—" : numberFormat.format(value)}
      </strong>
    </div>
  )
  return (
    <footer
      role="region"
      aria-label="Метрики вида"
      aria-busy={loading}
      className="workspace-panel flex items-center gap-1 px-2 py-2"
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <Activity className="size-4" />
      </span>
      <div className="flex min-w-0 [scrollbar-width:thin] items-center gap-1 overflow-x-auto">
        {count("Всего", total)}
        {items.length !== total ? count("Показано", items.length) : null}
        {selectedCount ? count("Выбрано", selectedCount) : null}
        {metrics.map((metric, index) => {
          const field = fields.find((field) => field.id === metric.field)
          if (!field) return null
          const option = field.options?.find(
            (option) => option.value === metric.value
          )
          const label =
            metric.operation === "equals"
              ? `${field.label}: ${option?.label ?? metric.value}`
              : `${field.label} · ${metricLabels[metric.operation].toLocaleLowerCase("ru-RU")}`
          const values = calculateMetric(items, field, metric)
          const formatted = loading
            ? "—"
            : values.length
              ? values
                  .map(({ value, currency }) =>
                    currency
                      ? new Intl.NumberFormat("ru-RU", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 2,
                        }).format(value)
                      : numberFormat.format(value)
                  )
                  .join(" / ")
              : "—"
          return (
            <DropdownMenu key={metricKey(metric)}>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 gap-2 rounded-lg px-2 text-xs"
                    aria-label={`Настроить метрику: ${label}, ${formatted}`}
                    title={`${label}: ${formatted}`}
                  />
                }
              >
                <span
                  className={`max-w-52 truncate ${option?.tone ? tones[option.tone] : "text-muted-foreground"}`}
                >
                  {label}
                </span>
                <strong className="max-w-64 truncate text-sm tabular-nums">
                  {formatted}
                </strong>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-popover">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{label}</DropdownMenuLabel>
                  <DropdownMenuItem
                    disabled={index === 0}
                    onClick={() => {
                      const next = [...metrics]
                      ;[next[index - 1], next[index]] = [
                        next[index],
                        next[index - 1],
                      ]
                      onChange(next)
                    }}
                  >
                    Переместить влево
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === metrics.length - 1}
                    onClick={() => {
                      const next = [...metrics]
                      ;[next[index + 1], next[index]] = [
                        next[index],
                        next[index + 1],
                      ]
                      onChange(next)
                    }}
                  >
                    Переместить вправо
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      onChange(
                        metrics.filter(
                          (item) => metricKey(item) !== metricKey(metric)
                        )
                      )
                    }
                  >
                    Удалить метрику
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className={adminControlClassName}
              disabled={!fields.length || metrics.length >= MAX_VIEW_METRICS}
            />
          }
        >
          <Plus className="size-4" />
          Метрика
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-56 max-w-[calc(100vw-2rem)] bg-popover"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>Добавить метрику</DropdownMenuLabel>
            {fields.map((field) => (
              <DropdownMenuSub key={field.id}>
                <DropdownMenuSubTrigger>{field.label}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56 max-w-[calc(100vw-2rem)] bg-popover">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{field.label}</DropdownMenuLabel>
                    {field.options?.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        disabled={metrics.some(
                          (metric) =>
                            metricKey(metric) ===
                            metricKey({
                              field: field.id,
                              operation: "equals",
                              value: option.value,
                            })
                        )}
                        onClick={() =>
                          add({
                            field: field.id,
                            operation: "equals",
                            value: option.value,
                          })
                        }
                      >
                        {option.tone ? (
                          <span
                            aria-hidden="true"
                            className={`size-2 shrink-0 rounded-full border-2 border-current ${tones[option.tone]}`}
                          />
                        ) : null}
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                    {field.options?.length ? <DropdownMenuSeparator /> : null}
                    {metricOperations(field.kind).map((operation) => (
                      <DropdownMenuItem
                        key={operation}
                        disabled={metrics.some(
                          (metric) =>
                            metricKey(metric) ===
                            metricKey({ field: field.id, operation })
                        )}
                        onClick={() => add({ field: field.id, operation })}
                      >
                        {metricLabels[operation]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto size-8 shrink-0 rounded-lg text-muted-foreground"
              aria-label="Как считаются метрики"
            />
          }
        >
          <Info className="size-4" />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          aria-label="Как считаются метрики"
          className="max-w-[calc(100vw-2rem)] rounded-xl bg-popover"
        >
          Всего — результат поиска. Добавленные метрики — по показанным записям
          с учётом фильтров вида.
          {partial
            ? ` Загружено ${loadedCount} из ${total}; это не итог всей базы.`
            : ""}{" "}
          Валюты считаются отдельно. Набор метрик сохраняется вместе с видом.
        </PopoverContent>
      </Popover>
    </footer>
  )
}
