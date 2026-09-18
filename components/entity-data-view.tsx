"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { entityDetailHref } from "@/lib/entity-details"
import { createPortal } from "react-dom"
import { serializeViewCsv } from "@/lib/admin-actions"
import { EntityExportContext } from "@/components/entity-export-context"
import { EntityFooterContext } from "@/components/entity-footer-context"

import ReactBitsKanban, {
  type ReactBitsKanbanColumn,
} from "@/components/kanban-3"
import FadeContent from "@/components/react-bits/FadeContent/FadeContent"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EntityViewToolbar } from "@/components/entity-view-toolbar"
import { EntityMetricsBar } from "@/components/entity-metrics-bar"
import {
  normalizeMetrics,
  type EntityMetric,
  type MetricField,
} from "@/lib/entity-metrics"
import {
  normalizeViewConfig,
  type EntityCollection,
  type EntityFilter,
  type EntityViewConfig,
  type EntityViewMode,
} from "@/lib/entity-views"
import { cn } from "@/lib/utils"

export type { EntityViewMode } from "@/lib/entity-views"

export type EntityColumn<T> = {
  id: string
  label: string
  value: (item: T) => React.ReactNode
  text?: (item: T) => string
  defaultVisible?: boolean
  className?: string
  metric?: Omit<MetricField<T>, "id" | "label">
}

export type EntityAction<T> = {
  label: string
  onSelect: (item: T) => void
  destructive?: boolean
  disabled?: (item: T) => boolean
}

type Props<T> = {
  collection: EntityCollection
  filters?: EntityFilter<T>[]
  filterValues?: Record<string, string>
  onFiltersChange?: (filters: Record<string, string>) => void
  items: T[]
  renderSchedule?: (items: T[]) => React.ReactNode
  toolbarExtras?: React.ReactNode
  totalCount?: number
  getId: (item: T) => string
  getLabel: (item: T) => string
  columns: EntityColumn<T>[]
  actions?: EntityAction<T>[]
  selected: Set<string>
  onSelectedChange: (next: Set<string>) => void
  emptyText: string
  loading?: boolean
  loadingText?: string
  modes?: EntityViewMode[]
  defaultMode?: EntityViewMode
  renderCard?: (item: T) => React.ReactNode
  groupBy?: (item: T) => string
  kanbanGroups?: ReactBitsKanbanColumn[]
  canMoveInKanban?: (item: T) => boolean
  canMoveToKanbanGroup?: (item: T, group: string) => boolean
  onKanbanGroupChange?: (
    item: T,
    group: string
  ) => boolean | void | Promise<boolean | void>
  dateValue?: (item: T) => string | undefined
  bulkActions?: React.ReactNode
  className?: string
  isSelectable?: (item: T) => boolean
}

function EntityMenu<T>({
  item,
  label,
  actions = [],
}: {
  item: T
  label: string
  actions?: EntityAction<T>[]
}) {
  if (!actions.length) return null
  return (
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuLabel>{label}</ContextMenuLabel>
        <ContextMenuSeparator />
        {actions.map((action) => (
          <ContextMenuItem
            disabled={action.disabled?.(item)}
            key={action.label}
            onClick={() => action.onSelect(item)}
            variant={action.destructive ? "destructive" : "default"}
          >
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuGroup>
    </ContextMenuContent>
  )
}

export function EntityDataView<T>({
  collection,
  filters = [],
  filterValues,
  onFiltersChange,
  items: sourceItems,
  totalCount,
  getId,
  getLabel,
  columns,
  actions: sourceActions,
  selected,
  onSelectedChange,
  emptyText,
  loading = false,
  loadingText = "Загружаем данные…",
  modes = ["table"],
  defaultMode = "table",
  renderCard,
  groupBy,
  kanbanGroups,
  canMoveInKanban,
  canMoveToKanbanGroup,
  onKanbanGroupChange,
  dateValue,
  bulkActions,
  className,
  isSelectable = () => true,
  renderSchedule,
  toolbarExtras,
}: Props<T>) {
  const router = useRouter()
  const detailEnabled = collection !== "cash-balances"
  const actions: EntityAction<T>[] = [
    ...(detailEnabled
      ? [
          {
            label: "Открыть детали",
            onSelect: (item: T) =>
              router.push(entityDetailHref(collection, getId(item))),
          },
        ]
      : []),
    ...(sourceActions ?? []),
  ]
  const footerContext = React.useContext(EntityFooterContext)
  const [mode, setMode] = React.useState<EntityViewMode>(
    modes.includes(defaultMode) ? defaultMode : modes[0]
  )
  const [visible, setVisible] = React.useState<Set<string>>(
    () =>
      new Set(
        columns
          .filter((column) => column.defaultVisible !== false)
          .map((column) => column.id)
      )
  )
  const [localFilters, setLocalFilters] = React.useState<
    Record<string, string>
  >({})
  const values = filterValues ?? localFilters
  const [metrics, setMetrics] = React.useState<EntityMetric[]>([])
  const metricFields: MetricField<T>[] = columns.flatMap((column) =>
    column.metric
      ? [{ ...column.metric, id: column.id, label: column.label }]
      : column.text
        ? [
            {
              id: column.id,
              label: column.label,
              kind: "text" as const,
              getValue: column.text,
            },
          ]
        : []
  )
  const items = sourceItems.filter((item) =>
    filters.every(
      (filter) =>
        !values[filter.id] ||
        !filter.matches ||
        filter.matches(item, values[filter.id])
    )
  )
  const defaultColumns = columns
    .filter((column) => column.defaultVisible !== false)
    .map((column) => column.id)
  const defaults: EntityViewConfig = {
    mode: modes.includes(defaultMode) ? defaultMode : modes[0],
    columns: defaultColumns,
    filters: {},
    metrics: [],
  }
  const config: EntityViewConfig = {
    mode,
    columns: columns
      .filter((column) => visible.has(column.id))
      .map((column) => column.id),
    filters: values,
    metrics,
  }
  function applyConfig(next: EntityViewConfig) {
    const safe = normalizeViewConfig(
      next,
      modes,
      columns.map((column) => column.id),
      defaultColumns,
      filters.map((filter) => filter.id)
    )
    setMode(safe.mode)
    setVisible(new Set(safe.columns))
    setMetrics(normalizeMetrics(safe.metrics, metricFields))
    if (onFiltersChange) onFiltersChange(safe.filters)
    else setLocalFilters(safe.filters)
    onSelectedChange(new Set())
  }
  const visibleColumns = columns.filter((column) => visible.has(column.id))
  const registerExport = React.useContext(EntityExportContext)
  const exportColumns = visibleColumns.filter(
    (column) => column.text || column.metric
  )
  const csv = serializeViewCsv(
    exportColumns.map((column) => column.label),
    items.map((item) =>
      exportColumns.map((column) =>
        column.text ? column.text(item) : column.metric?.getValue(item)
      )
    )
  )
  const rowCount = items.length
  const loadedCount = sourceItems.length
  const exportTotal = totalCount ?? loadedCount
  React.useEffect(() => {
    registerExport?.({
      csv,
      filename: `vivat-${collection}.csv`,
      rows: rowCount,
      loaded: loadedCount,
      total: exportTotal,
      loading: !!loading,
    })
    return () => registerExport?.(null)
  }, [
    registerExport,
    csv,
    collection,
    rowCount,
    loadedCount,
    exportTotal,
    loading,
  ])
  const selectableItems = items.filter(isSelectable)
  const allSelected =
    selectableItems.length > 0 &&
    selectableItems.every((item) => selected.has(getId(item)))
  React.useEffect(() => {
    const ids = new Set(sourceItems.map(getId))
    const next = new Set([...selected].filter((id) => ids.has(id)))
    if (next.size !== selected.size) onSelectedChange(next)
  }, [sourceItems, getId, selected, onSelectedChange])
  const toggleAll = (checked: boolean) =>
    onSelectedChange(checked ? new Set(selectableItems.map(getId)) : new Set())
  const toggleOne = (item: T, checked: boolean) => {
    if (!isSelectable(item)) return
    const id = getId(item)
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    onSelectedChange(next)
  }
  const cardContent = (item: T) =>
    renderCard?.(item) ?? (
      <div className="space-y-2">
        <p className="font-semibold">{getLabel(item)}</p>
        {visibleColumns.slice(1, 5).map((column) => (
          <div className="flex justify-between gap-4 text-sm" key={column.id}>
            <span className="text-muted-foreground">{column.label}</span>
            <span className="text-right">{column.value(item)}</span>
          </div>
        ))}
      </div>
    )

  const card = (item: T, withSelection = false) => (
    <div className="flex min-w-0 gap-3">
      {withSelection ? (
        <Checkbox
          aria-label={`Выбрать ${getLabel(item)}`}
          className="mt-1 shrink-0"
          checked={selected.has(getId(item))}
          disabled={!isSelectable(item)}
          onCheckedChange={(checked) => toggleOne(item, checked)}
          onKeyDown={(event) => event.stopPropagation()}
        />
      ) : null}
      <div className="min-w-0 flex-1 space-y-2">
        {cardContent(item)}
        {detailEnabled ? (
          <Button
            size="sm"
            variant="link"
            className="h-7 px-0"
            render={<Link href={entityDetailHref(collection, getId(item))} />}
          >
            Открыть детали
          </Button>
        ) : null}
      </div>
    </div>
  )
  return (
    <section className={cn("space-y-3", className)}>
      <EntityViewToolbar
        key={collection}
        ready={!loading}
        collection={collection}
        config={config}
        defaults={defaults}
        onChange={applyConfig}
        modes={modes}
        columns={columns}
        filters={filters}
        extras={toolbarExtras}
      />
      {selected.size ? (
        <div className="flex flex-wrap items-center gap-2">
          <>
            {bulkActions}
            <Button
              onClick={() => onSelectedChange(new Set())}
              size="sm"
              variant="ghost"
            >
              Снять выбор
            </Button>
          </>
        </div>
      ) : null}

      <FadeContent duration={240} initialOpacity={0.5} key={mode}>
        {loading ? (
          <div className="surface-card p-8 text-center text-sm text-muted-foreground">
            {loadingText}
          </div>
        ) : mode === "schedule" && renderSchedule ? (
          renderSchedule(items)
        ) : items.length === 0 ? (
          <div className="surface-card p-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : mode === "table" ? (
          <div className="surface-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      aria-label="Выбрать все записи"
                      checked={allSelected}
                      disabled={selectableItems.length === 0}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  {visibleColumns.map((column) => (
                    <TableHead className={column.className} key={column.id}>
                      {column.label}
                    </TableHead>
                  ))}
                  {actions?.length ? (
                    <TableHead className="w-24 text-right">Действия</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const id = getId(item)
                  return (
                    <ContextMenu key={id}>
                      <ContextMenuTrigger
                        render={
                          <TableRow
                            data-state={
                              selected.has(id) ? "selected" : undefined
                            }
                          />
                        }
                      >
                        <TableCell className="pl-4">
                          <Checkbox
                            aria-label={`Выбрать ${getLabel(item)}`}
                            checked={selected.has(id)}
                            disabled={!isSelectable(item)}
                            onCheckedChange={(checked) =>
                              toggleOne(item, checked)
                            }
                          />
                        </TableCell>
                        {visibleColumns.map((column) => (
                          <TableCell
                            className={column.className}
                            key={column.id}
                          >
                            {detailEnabled &&
                            column.id ===
                              (collection === "bookings"
                                ? "passenger"
                                : "name") ? (
                              <Link
                                href={entityDetailHref(collection, getId(item))}
                                className="block rounded-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                              >
                                {column.value(item)}
                              </Link>
                            ) : (
                              column.value(item)
                            )}
                          </TableCell>
                        ))}
                        {actions?.length ? (
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    aria-label={`Действия: ${getLabel(item)}`}
                                    size="sm"
                                    variant="ghost"
                                  />
                                }
                              >
                                •••
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                  <DropdownMenuLabel>
                                    {getLabel(item)}
                                  </DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  {actions.map((action) => (
                                    <DropdownMenuItem
                                      className={
                                        action.destructive
                                          ? "text-destructive focus:text-destructive"
                                          : undefined
                                      }
                                      disabled={action.disabled?.(item)}
                                      key={action.label}
                                      onClick={() => action.onSelect(item)}
                                    >
                                      {action.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        ) : null}
                      </ContextMenuTrigger>
                      <EntityMenu
                        actions={actions}
                        item={item}
                        label={getLabel(item)}
                      />
                    </ContextMenu>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : mode === "list" ? (
          <div className="surface-card divide-y">
            {items.map((item) => (
              <ContextMenu key={getId(item)}>
                <ContextMenuTrigger
                  render={<article className="flex items-start gap-4 p-4" />}
                >
                  <Checkbox
                    aria-label={`Выбрать ${getLabel(item)}`}
                    checked={selected.has(getId(item))}
                    disabled={!isSelectable(item)}
                    onCheckedChange={(checked) => toggleOne(item, checked)}
                  />
                  <div className="min-w-0 flex-1">{card(item)}</div>
                  {actions?.length ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Действия: ${getLabel(item)}`}
                          />
                        }
                      >
                        •••
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          {actions.map((action) => (
                            <DropdownMenuItem
                              key={action.label}
                              disabled={action.disabled?.(item)}
                              variant={
                                action.destructive ? "destructive" : "default"
                              }
                              onClick={() => action.onSelect(item)}
                            >
                              {action.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </ContextMenuTrigger>
                <EntityMenu
                  actions={actions}
                  item={item}
                  label={getLabel(item)}
                />
              </ContextMenu>
            ))}
          </div>
        ) : mode === "kanban" ? (
          <ReactBitsKanban
            canMove={canMoveInKanban}
            canMoveTo={canMoveToKanbanGroup}
            columns={
              kanbanGroups ??
              [
                ...new Set(
                  items.map((item) => groupBy?.(item) ?? "Без группы")
                ),
              ].map((group) => ({ id: group, label: group }))
            }
            emptyText="Нет записей"
            getGroup={(item) => groupBy?.(item) ?? "Без группы"}
            getId={getId}
            getLabel={getLabel}
            items={items}
            onMove={onKanbanGroupChange}
            renderCard={(item) => (
              <ContextMenu>
                <ContextMenuTrigger render={<div />}>
                  {card(item, true)}
                </ContextMenuTrigger>
                <EntityMenu
                  actions={actions}
                  item={item}
                  label={getLabel(item)}
                />
              </ContextMenu>
            )}
          />
        ) : mode === "calendar" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...new Set(items.map((item) => dateValue?.(item) ?? "Без даты"))]
              .sort()
              .map((date) => (
                <section className="surface-card p-4" key={date}>
                  <h3 className="mb-3 text-sm font-semibold">{date}</h3>
                  <div className="space-y-2">
                    {items
                      .filter(
                        (item) => (dateValue?.(item) ?? "Без даты") === date
                      )
                      .map((item) => (
                        <ContextMenu key={getId(item)}>
                          <ContextMenuTrigger
                            render={
                              <div className="rounded-xl bg-muted/60 p-3" />
                            }
                          >
                            {card(item, true)}
                          </ContextMenuTrigger>
                          <EntityMenu
                            actions={actions}
                            item={item}
                            label={getLabel(item)}
                          />
                        </ContextMenu>
                      ))}
                  </div>
                </section>
              ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <ContextMenu key={getId(item)}>
                <ContextMenuTrigger
                  render={<article className="surface-card p-4" />}
                >
                  {card(item, true)}
                </ContextMenuTrigger>
                <EntityMenu
                  actions={actions}
                  item={item}
                  label={getLabel(item)}
                />
              </ContextMenu>
            ))}
          </div>
        )}
      </FadeContent>
      {(() => {
        const bar = (
          <EntityMetricsBar
            items={items}
            total={totalCount ?? sourceItems.length}
            loadedCount={sourceItems.length}
            selectedCount={
              items.filter((item) => selected.has(getId(item))).length
            }
            fields={metricFields}
            metrics={metrics}
            onChange={setMetrics}
            loading={loading}
          />
        )
        return footerContext.enabled
          ? footerContext.target
            ? createPortal(bar, footerContext.target)
            : null
          : bar
      })()}
    </section>
  )
}
