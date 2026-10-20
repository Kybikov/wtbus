"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { entityDetailHref } from "@/lib/entity-details"
import { mergeVisibleCardOrder } from "@/lib/kanban"
import { MobileSwipeActions } from "@/components/mobile-swipe-actions"
import { createPortal } from "react-dom"
import { serializeViewCsv } from "@/lib/admin-actions"
import { EntityExportContext } from "@/components/entity-export-context"
import { EntityFooterContext } from "@/components/entity-footer-context"
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Eye,
  Filter,
  GripVertical,
  PanelLeft,
  PanelRight,
  Pencil,
  PinOff,
  Settings2,
  Trash2,
  X,
} from "lucide-react"

import { EntityCalendar } from "@/components/entity-calendar"
import ReactBitsKanban, {
  type ReactBitsKanbanColumn,
} from "@/components/kanban-3"
import FadeContent from "@/components/react-bits/FadeContent/FadeContent"
import { EntityCardSettings } from "@/components/entity-card-settings"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
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
  arrangeBoardGroups,
  defaultCardLayout,
  normalizeViewConfig,
  type BoardLayout,
  type CardLayout,
  type EntityCollection,
  type EntityFilter,
  type EntityViewConfig,
  type EntityViewMode,
} from "@/lib/entity-views"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type { EntityViewMode } from "@/lib/entity-views"

export type EntityColumn<T> = {
  id: string
  label: string
  value: (item: T) => React.ReactNode
  text?: (item: T) => string
  defaultVisible?: boolean
  className?: string
  metric?: Omit<MetricField<T>, "id" | "label">
  sortValue?: (item: T) => string | number | Date | null | undefined
}

export type EntityAction<T> = {
  label: string
  onSelect: (item: T) => void
  destructive?: boolean
  disabled?: (item: T) => boolean
  icon?: React.ComponentType<{ className?: string }>
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
            {React.createElement(action.icon ?? actionIcon(action.label), {
              className: "size-4",
            })}
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuGroup>
    </ContextMenuContent>
  )
}

function actionIcon(label: string) {
  const value = label.toLocaleLowerCase("ru")
  if (value.includes("удал") || value.includes("отмен")) return Trash2
  if (value.includes("редакт") || value.includes("измен")) return Pencil
  if (value.includes("откры") || value.includes("детал")) return Eye
  return Settings2
}

function EntityActionButtons<T>({
  item,
  label,
  actions,
}: {
  item: T
  label: string
  actions: EntityAction<T>[]
}) {
  return (
    <TooltipProvider>
      <div className="flex items-center justify-end gap-1">
        {actions.map((action) => {
          const Icon = action.icon ?? actionIcon(action.label)
          return (
            <Tooltip key={action.label}>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`${action.label}: ${label}`}
                    className={cn(
                      "size-8",
                      action.destructive &&
                        "text-destructive hover:bg-destructive/10 hover:text-destructive"
                    )}
                    disabled={action.disabled?.(item)}
                    onClick={() => action.onSelect(item)}
                    size="icon"
                    variant="ghost"
                  />
                }
              >
                <Icon className="size-4" />
              </TooltipTrigger>
              <TooltipContent>{action.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
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
  const [columnOrder, setColumnOrder] = React.useState<string[]>(() =>
    columns.map((column) => column.id)
  )
  const [columnWidths, setColumnWidths] = React.useState<
    Record<string, number>
  >({})
  const [pinnedColumns, setPinnedColumns] = React.useState<{
    left: string[]
    right: string[]
  }>({ left: [], right: [] })
  const [sort, setSort] = React.useState<EntityViewConfig["sort"]>(null)
  const [cardLayout, setCardLayout] = React.useState<CardLayout | undefined>()
  const [board, setBoard] = React.useState<BoardLayout | undefined>()
  const [cardSettingsOpen, setCardSettingsOpen] = React.useState(false)
  const [filterRequest, setFilterRequest] = React.useState<string | null>(null)
  const dragColumn = React.useRef<string | null>(null)
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
  const items = sourceItems
    .filter((item) =>
      filters.every(
        (filter) =>
          !values[filter.id] ||
          !filter.matches ||
          filter.matches(item, values[filter.id])
      )
    )
    .sort((a, b) => {
      if (!sort) return 0
      const column = columns.find((candidate) => candidate.id === sort.columnId)
      if (!column) return 0
      const read = (item: T) =>
        column.sortValue?.(item) ??
        column.text?.(item) ??
        column.metric?.getValue(item)
      const left = read(a)
      const right = read(b)
      const normalize = (value: unknown) =>
        value instanceof Date
          ? value.getTime()
          : typeof value === "number"
            ? value
            : value &&
                typeof value === "object" &&
                "amountMinor" in value &&
                typeof value.amountMinor === "number"
              ? value.amountMinor
              : String(value ?? "")
      const normalizedLeft = normalize(left)
      const normalizedRight = normalize(right)
      const result =
        typeof normalizedLeft === "number" &&
        typeof normalizedRight === "number"
          ? normalizedLeft - normalizedRight
          : String(normalizedLeft).localeCompare(
              String(normalizedRight),
              "ru",
              {
                numeric: true,
                sensitivity: "base",
              }
            )
      return sort.direction === "asc" ? result : -result
    })
  const defaultColumns = columns
    .filter((column) => column.defaultVisible !== false)
    .map((column) => column.id)
  const defaults: EntityViewConfig = {
    mode: modes.includes(defaultMode) ? defaultMode : modes[0],
    columns: defaultColumns,
    filters: {},
    metrics: [],
    columnWidths: {},
    pinnedColumns: { left: [], right: [] },
    sort: null,
  }
  const config: EntityViewConfig = {
    mode,
    columns: columnOrder.filter((id) => visible.has(id)),
    filters: values,
    metrics,
    columnWidths,
    pinnedColumns,
    sort,
    ...(cardLayout ? { card: cardLayout } : {}),
    ...(board ? { board } : {}),
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
    setColumnOrder([
      ...safe.columns,
      ...columns
        .map((column) => column.id)
        .filter((id) => !safe.columns.includes(id)),
    ])
    setColumnWidths(safe.columnWidths ?? {})
    setPinnedColumns(safe.pinnedColumns ?? { left: [], right: [] })
    setSort(safe.sort ?? null)
    setCardLayout(safe.card)
    setBoard(safe.board)
    setMetrics(normalizeMetrics(safe.metrics, metricFields))
    if (onFiltersChange) onFiltersChange(safe.filters)
    else setLocalFilters(safe.filters)
    onSelectedChange(new Set())
  }
  const visibleColumns = columnOrder
    .map((id) => columns.find((column) => column.id === id))
    .filter((column): column is EntityColumn<T> =>
      Boolean(column && visible.has(column.id))
    )
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
  const columnWidth = (id: string) => columnWidths[id] ?? 180
  const pinColumn = (id: string, side: "left" | "right" | null) => {
    setPinnedColumns((current) => ({
      left:
        side === "left"
          ? [...current.left.filter((value) => value !== id), id]
          : current.left.filter((value) => value !== id),
      right:
        side === "right"
          ? [...current.right.filter((value) => value !== id), id]
          : current.right.filter((value) => value !== id),
    }))
  }
  const pinStyle = (id: string): React.CSSProperties => {
    if (pinnedColumns.left.includes(id)) {
      const index = pinnedColumns.left.indexOf(id)
      return {
        position: "sticky",
        left:
          48 +
          pinnedColumns.left
            .slice(0, index)
            .reduce((sum, value) => sum + columnWidth(value), 0),
        zIndex: 2,
      }
    }
    if (pinnedColumns.right.includes(id)) {
      const index = pinnedColumns.right.indexOf(id)
      return {
        position: "sticky",
        right:
          (actions.length ? 112 : 0) +
          pinnedColumns.right
            .slice(index + 1)
            .reduce((sum, value) => sum + columnWidth(value), 0),
        zIndex: 2,
      }
    }
    return {}
  }
  const moveColumn = (from: string, to: string) => {
    if (from === to) return
    setColumnOrder((current) => {
      const next = current.filter((id) => id !== from)
      next.splice(next.indexOf(to), 0, from)
      return next
    })
  }
  const startResize = (event: React.PointerEvent, id: string) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = columnWidth(id)
    const move = (pointer: PointerEvent) =>
      setColumnWidths((current) => ({
        ...current,
        [id]: Math.max(
          96,
          Math.min(720, startWidth + pointer.clientX - startX)
        ),
      }))
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
  }
  const activeCard =
    cardLayout ??
    defaultCardLayout(
      (visibleColumns.length ? visibleColumns : columns).map(
        (column) => column.id
      )
    )
  const cardPadding =
    activeCard.size === "xs"
      ? "gap-1 p-2 text-xs"
      : activeCard.size === "md"
        ? "gap-2 p-3.5 text-sm"
        : "gap-1.5 p-2.5 text-sm"
  const columnById = new Map(columns.map((column) => [column.id, column]))
  const card = (item: T, withSelection = false) => (
    <div className={cn("flex min-w-0", cardPadding)}>
      {withSelection ? (
        <div data-no-drag onPointerDown={(event) => event.stopPropagation()}>
          <Checkbox
            aria-label={`Выбрать ${getLabel(item)}`}
            className="mt-0.5 shrink-0"
            checked={selected.has(getId(item))}
            disabled={!isSelectable(item)}
            onCheckedChange={(checked) => toggleOne(item, checked)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1 space-y-1.5">
        {!cardLayout && renderCard
          ? renderCard(item)
          : activeCard.rows.map((row, index) => {
              const fields = row.fields
                .map((id) => columnById.get(id))
                .filter((column) => column != null)
              if (!fields.length) return null
              if (row.layout === "title") {
                return (
                  <p className="truncate font-semibold" key={index}>
                    {fields[0].value(item)}
                  </p>
                )
              }
              if (row.layout === "two") {
                return (
                  <div className="grid grid-cols-2 gap-2" key={index}>
                    {fields.slice(0, 2).map((column) => (
                      <div className="min-w-0" key={column.id}>
                        <div className="truncate text-muted-foreground">
                          {column.label}
                        </div>
                        <div className="truncate">{column.value(item)}</div>
                      </div>
                    ))}
                  </div>
                )
              }
              const column = fields[0]
              return (
                <div
                  className="flex items-baseline justify-between gap-3"
                  key={index}
                >
                  <span className="truncate text-muted-foreground">
                    {column.label}
                  </span>
                  <span className="truncate text-right">
                    {column.value(item)}
                  </span>
                </div>
              )
            })}
      </div>
    </div>
  )
  const openCard = (item: T, event: React.MouseEvent) => {
    if (!detailEnabled) return
    if (
      (event.target as HTMLElement).closest(
        "button,a,input,textarea,select,[role=checkbox],[data-no-drag]"
      )
    )
      return
    router.push(entityDetailHref(collection, getId(item)))
  }
  const groupOf = (item: T) => groupBy?.(item) ?? "Без группы"
  const boardGroups = (
    kanbanGroups ??
    [...new Set(items.map(groupOf))].map((group) => ({
      id: group,
      label: group,
    }))
  ).map((group) => ({
    ...group,
    count: items.filter((item) => groupOf(item) === group.id).length,
  }))
  const visibleBoardGroups = arrangeBoardGroups(boardGroups, board)
  const hiddenBoardGroups = new Set(board?.hidden ?? [])
  return (
    <section className={cn("space-y-3", className)} aria-busy={loading}>
      <EntityViewToolbar
        key={collection}
        ready={!loading}
        collection={collection}
        config={config}
        defaults={defaults}
        onChange={applyConfig}
        modes={modes}
        columns={columns}
        resultCount={items.length}
        loading={loading}
        filters={filters}
        extras={toolbarExtras}
        bulkActions={bulkActions}
        selectedCount={selected.size}
        onClearSelection={() => onSelectedChange(new Set())}
        filterRequest={filterRequest}
        onFilterRequestHandled={() => setFilterRequest(null)}
        onConfigureCard={
          mode === "kanban" ||
          mode === "list" ||
          mode === "gallery" ||
          mode === "calendar"
            ? () => setCardSettingsOpen(true)
            : undefined
        }
        groups={boardGroups}
      />
      <EntityCardSettings
        columns={columns.map((column) => ({
          id: column.id,
          label: column.label,
        }))}
        onApply={(layout) => {
          setCardLayout(layout)
          setCardSettingsOpen(false)
        }}
        onOpenChange={setCardSettingsOpen}
        open={cardSettingsOpen}
        value={activeCard}
      />
      <FadeContent duration={240} initialOpacity={0.5} key={mode}>
        {loading && items.length === 0 ? (
          <div className="surface-card p-8 text-center text-sm text-muted-foreground">
            {loadingText}
          </div>
        ) : mode === "schedule" && renderSchedule ? (
          renderSchedule(items)
        ) : items.length === 0 && mode !== "kanban" ? (
          <div className="surface-card p-8 text-center text-sm text-muted-foreground">
            <p>
              {Object.values(values).some(Boolean)
                ? "Нет записей по выбранным фильтрам."
                : emptyText}
            </p>
            {Object.values(values).some(Boolean) && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => applyConfig({ ...config, filters: {} })}
              >
                Сбросить фильтры
              </Button>
            )}
          </div>
        ) : mode === "table" ? (
          <>
            <div
              className="space-y-3 md:hidden"
              role="list"
              aria-label="Записи"
            >
              <label className="flex items-center gap-3 px-3 text-sm">
                <Checkbox
                  aria-label="Выбрать все записи"
                  checked={allSelected}
                  disabled={selectableItems.length === 0}
                  onCheckedChange={toggleAll}
                />
                Выбрать все
              </label>
              {items.map((item) => (
                <MobileSwipeActions
                  key={getId(item)}
                  label={getLabel(item)}
                  onOpen={
                    detailEnabled
                      ? () =>
                          router.push(entityDetailHref(collection, getId(item)))
                      : undefined
                  }
                  actions={sourceActions
                    ?.filter((action) => !action.disabled?.(item))
                    .map((action) => ({
                      ...action,
                      onSelect: () => action.onSelect(item),
                    }))}
                >
                  <Card
                    key={getId(item)}
                    role="listitem"
                    className={cn(
                      "workspace-panel gap-3 py-3",
                      selected.has(getId(item)) && "ring-1 ring-primary"
                    )}
                  >
                    <CardHeader className="flex flex-row items-start gap-2 px-3">
                      <label className="flex min-w-11 shrink-0 items-center justify-center">
                        <Checkbox
                          aria-label={`Выбрать ${getLabel(item)}`}
                          checked={selected.has(getId(item))}
                          disabled={!isSelectable(item)}
                          onCheckedChange={(checked) =>
                            toggleOne(item, checked)
                          }
                        />
                      </label>
                      <div className="flex min-h-11 min-w-0 flex-1 items-center">
                        {detailEnabled ? (
                          <Link
                            href={entityDetailHref(collection, getId(item))}
                            className="flex min-h-11 w-full items-center font-semibold break-words hover:text-primary"
                          >
                            {getLabel(item)}
                          </Link>
                        ) : (
                          <span className="font-semibold break-words">
                            {getLabel(item)}
                          </span>
                        )}
                      </div>
                      {actions?.length ? (
                        <EntityActionButtons
                          actions={actions}
                          item={item}
                          label={getLabel(item)}
                        />
                      ) : null}
                    </CardHeader>
                    <CardContent className="px-3">
                      <dl className="grid grid-cols-2 gap-3">
                        {visibleColumns.map((column) => (
                          <div
                            key={column.id}
                            className={cn(
                              "min-w-0",
                              [
                                "name",
                                "passenger",
                                "passengers",
                                "allPassengers",
                                "route",
                                "notes",
                              ].includes(column.id) && "col-span-2"
                            )}
                          >
                            <dt className="mb-1 text-xs text-muted-foreground">
                              {column.label}
                            </dt>
                            <dd className="min-w-0 text-sm break-words [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:whitespace-normal [&>*]:max-w-full [&>*]:min-w-0">
                              {column.value(item)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {detailEnabled ? (
                        <Link
                          className={buttonVariants({
                            variant: "outline",
                            className: "mt-3 w-full",
                          })}
                          href={entityDetailHref(collection, getId(item))}
                        >
                          Открыть детали
                        </Link>
                      ) : null}
                    </CardContent>
                  </Card>
                </MobileSwipeActions>
              ))}
            </div>
            <div className="surface-card hidden overflow-hidden md:block">
              <Table
                className="table-fixed"
                style={{
                  minWidth:
                    48 +
                    visibleColumns.reduce(
                      (sum, column) => sum + columnWidth(column.id),
                      0
                    ) +
                    (actions.length ? 112 : 0),
                }}
              >
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-[4] w-12 bg-card pl-4">
                      <Checkbox
                        aria-label="Выбрать все записи"
                        checked={allSelected}
                        disabled={selectableItems.length === 0}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    {visibleColumns.map((column) => {
                      const activeSort = sort?.columnId === column.id
                      const matchingFilter = filters.find(
                        (filter) => filter.id === column.id
                      )
                      return (
                        <ContextMenu key={column.id}>
                          <ContextMenuTrigger
                            render={
                              <TableHead
                                aria-sort={
                                  activeSort
                                    ? sort.direction === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                                className={cn(
                                  "group/header relative bg-card p-0",
                                  column.className,
                                  (pinnedColumns.left.includes(column.id) ||
                                    pinnedColumns.right.includes(column.id)) &&
                                    "shadow-[inset_-1px_0_hsl(var(--border))]"
                                )}
                                style={{
                                  width: columnWidth(column.id),
                                  minWidth: columnWidth(column.id),
                                  maxWidth: columnWidth(column.id),
                                  ...pinStyle(column.id),
                                }}
                              />
                            }
                          >
                            <button
                              aria-label={`${column.label}: сортировать и перетащить`}
                              className="flex h-10 w-full cursor-grab items-center gap-1.5 overflow-hidden px-2 text-left active:cursor-grabbing"
                              draggable
                              onClick={() =>
                                setSort((current) => ({
                                  columnId: column.id,
                                  direction:
                                    current?.columnId === column.id &&
                                    current.direction === "asc"
                                      ? "desc"
                                      : "asc",
                                }))
                              }
                              onDragStart={() =>
                                (dragColumn.current = column.id)
                              }
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => {
                                if (dragColumn.current)
                                  moveColumn(dragColumn.current, column.id)
                                dragColumn.current = null
                              }}
                              type="button"
                            >
                              <GripVertical className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/header:opacity-100" />
                              <span className="truncate">{column.label}</span>
                              {activeSort ? (
                                sort.direction === "asc" ? (
                                  <ArrowDownAZ className="size-3.5 shrink-0 text-primary" />
                                ) : (
                                  <ArrowUpAZ className="size-3.5 shrink-0 text-primary" />
                                )
                              ) : null}
                            </button>
                            <button
                              aria-label={`Изменить ширину колонки ${column.label}`}
                              className="absolute top-1/2 right-0 z-10 h-4 w-3 -translate-y-1/2 cursor-col-resize after:absolute after:top-0 after:left-1/2 after:h-4 after:w-px after:-translate-x-1/2 after:rounded-full after:bg-border after:content-[''] hover:after:w-0.5 hover:after:bg-primary focus-visible:after:w-0.5 focus-visible:after:bg-primary"
                              onPointerDown={(event) =>
                                startResize(event, column.id)
                              }
                              type="button"
                            />
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-56">
                            <ContextMenuGroup>
                              <ContextMenuLabel>
                                {column.label}
                              </ContextMenuLabel>
                              <ContextMenuItem
                                onClick={() =>
                                  setSort({
                                    columnId: column.id,
                                    direction: "asc",
                                  })
                                }
                              >
                                <ArrowDownAZ /> По возрастанию
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() =>
                                  setSort({
                                    columnId: column.id,
                                    direction: "desc",
                                  })
                                }
                              >
                                <ArrowUpAZ /> По убыванию
                              </ContextMenuItem>
                              {activeSort ? (
                                <ContextMenuItem onClick={() => setSort(null)}>
                                  <X /> Сбросить сортировку
                                </ContextMenuItem>
                              ) : null}
                              {matchingFilter ? (
                                <ContextMenuItem
                                  onClick={() => setFilterRequest(column.id)}
                                >
                                  <Filter /> Добавить фильтр
                                </ContextMenuItem>
                              ) : null}
                              <ContextMenuSeparator />
                              <ContextMenuSub>
                                <ContextMenuSubTrigger>
                                  <PanelLeft className="mr-2" /> Закрепить
                                </ContextMenuSubTrigger>
                                <ContextMenuSubContent>
                                  <ContextMenuGroup>
                                    <ContextMenuItem
                                      onClick={() =>
                                        pinColumn(column.id, "left")
                                      }
                                    >
                                      <PanelLeft /> Слева
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      onClick={() =>
                                        pinColumn(column.id, "right")
                                      }
                                    >
                                      <PanelRight /> Справа
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      onClick={() => pinColumn(column.id, null)}
                                    >
                                      <PinOff /> Открепить
                                    </ContextMenuItem>
                                  </ContextMenuGroup>
                                </ContextMenuSubContent>
                              </ContextMenuSub>
                              <ContextMenuItem
                                disabled={visibleColumns.length === 1}
                                onClick={() => {
                                  setVisible((current) => {
                                    const next = new Set(current)
                                    next.delete(column.id)
                                    return next
                                  })
                                  pinColumn(column.id, null)
                                  if (sort?.columnId === column.id)
                                    setSort(null)
                                }}
                              >
                                <Eye /> Скрыть колонку
                              </ContextMenuItem>
                            </ContextMenuGroup>
                          </ContextMenuContent>
                        </ContextMenu>
                      )
                    })}
                    {actions?.length ? (
                      <TableHead className="sticky right-0 z-[4] w-28 bg-card text-right">
                        Действия
                      </TableHead>
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
                          <TableCell className="sticky left-0 z-[3] w-12 bg-card pl-4">
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
                              className={cn(
                                "overflow-hidden bg-card",
                                column.className
                              )}
                              key={column.id}
                              style={{
                                width: columnWidth(column.id),
                                minWidth: columnWidth(column.id),
                                maxWidth: columnWidth(column.id),
                                ...pinStyle(column.id),
                              }}
                            >
                              {detailEnabled &&
                              column.id ===
                                (collection === "bookings"
                                  ? "passenger"
                                  : "name") ? (
                                <Link
                                  href={entityDetailHref(
                                    collection,
                                    getId(item)
                                  )}
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
                            <TableCell className="sticky right-0 z-[3] w-28 bg-card text-right">
                              <EntityActionButtons
                                actions={actions}
                                item={item}
                                label={getLabel(item)}
                              />
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
          </>
        ) : mode === "list" ? (
          <div className="surface-card divide-y">
            {items.map((item) => (
              <MobileSwipeActions
                key={getId(item)}
                label={getLabel(item)}
                onOpen={
                  detailEnabled
                    ? () =>
                        router.push(entityDetailHref(collection, getId(item)))
                    : undefined
                }
                actions={sourceActions
                  ?.filter((action) => !action.disabled?.(item))
                  .map((action) => ({
                    ...action,
                    onSelect: () => action.onSelect(item),
                  }))}
              >
                <ContextMenu>
                  <ContextMenuTrigger
                    render={
                      <article
                        className="flex cursor-pointer items-start gap-3 px-2 py-1"
                        onClick={(event) => openCard(item, event)}
                      />
                    }
                  >
                    <Checkbox
                      aria-label={`Выбрать ${getLabel(item)}`}
                      checked={selected.has(getId(item))}
                      disabled={!isSelectable(item)}
                      onCheckedChange={(checked) => toggleOne(item, checked)}
                    />
                    <div className="min-w-0 flex-1">{card(item)}</div>
                    {actions?.length ? (
                      <EntityActionButtons
                        actions={actions}
                        item={item}
                        label={getLabel(item)}
                      />
                    ) : null}
                  </ContextMenuTrigger>
                  <EntityMenu
                    actions={actions}
                    item={item}
                    label={getLabel(item)}
                  />
                </ContextMenu>
              </MobileSwipeActions>
            ))}
          </div>
        ) : mode === "kanban" ? (
          <ReactBitsKanban
            canMove={canMoveInKanban}
            canMoveTo={canMoveToKanbanGroup}
            columns={visibleBoardGroups}
            emptyText="Нет записей"
            getGroup={groupOf}
            getId={getId}
            getLabel={getLabel}
            items={items.filter(
              (item) => !hiddenBoardGroups.has(groupOf(item))
            )}
            cardOrder={sort ? items.map(getId) : (board?.cardOrder ?? [])}
            onOrderChange={(cardOrder) => {
              setSort(null)
              setBoard((current) => ({
                ...current,
                hidden: current?.hidden ?? [],
                order: current?.order ?? [],
                orderBy: current?.orderBy ?? "manual",
                cardOrder: mergeVisibleCardOrder(
                  current?.cardOrder ?? [],
                  cardOrder
                ),
              }))
            }}
            onMove={onKanbanGroupChange}
            onOpen={
              detailEnabled
                ? (item) =>
                    router.push(entityDetailHref(collection, getId(item)))
                : undefined
            }
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
        ) : mode === "calendar" && dateValue ? (
          <EntityCalendar
            dateValue={dateValue}
            getId={getId}
            getLabel={getLabel}
            items={items}
            renderItem={(item) => (
              <ContextMenu>
                <ContextMenuTrigger
                  render={
                    <div
                      className="cursor-pointer rounded-xl bg-muted/60"
                      onClick={(event) => openCard(item, event)}
                    />
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
            )}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <ContextMenu key={getId(item)}>
                <ContextMenuTrigger
                  render={
                    <article
                      className="surface-card cursor-pointer"
                      onClick={(event) => openCard(item, event)}
                    />
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
