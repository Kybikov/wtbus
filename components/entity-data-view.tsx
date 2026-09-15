"use client"

import * as React from "react"

import FadeContent from "@/components/react-bits/FadeContent/FadeContent"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  DropdownMenuCheckboxItem,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export type EntityViewMode = "table" | "kanban" | "calendar" | "gallery"

export type EntityColumn<T> = {
  id: string
  label: string
  value: (item: T) => React.ReactNode
  text?: (item: T) => string
  defaultVisible?: boolean
  className?: string
}

export type EntityAction<T> = {
  label: string
  onSelect: (item: T) => void
  destructive?: boolean
  disabled?: (item: T) => boolean
}

type Props<T> = {
  items: T[]
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
  dateValue?: (item: T) => string | undefined
  bulkActions?: React.ReactNode
  className?: string
  isSelectable?: (item: T) => boolean
}

const modeLabels: Record<EntityViewMode, string> = {
  table: "Таблица",
  kanban: "Канбан",
  calendar: "Календарь",
  gallery: "Галерея",
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
  items,
  getId,
  getLabel,
  columns,
  actions,
  selected,
  onSelectedChange,
  emptyText,
  loading = false,
  loadingText = "Загружаем данные…",
  modes = ["table"],
  defaultMode = "table",
  renderCard,
  groupBy,
  dateValue,
  bulkActions,
  className,
  isSelectable = () => true,
}: Props<T>) {
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
  const visibleColumns = columns.filter((column) => visible.has(column.id))
  const selectableItems = items.filter(isSelectable)
  const allSelected =
    selectableItems.length > 0 &&
    selectableItems.every((item) => selected.has(getId(item)))
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
  const card = (item: T) =>
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

  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-h-8 items-center gap-2">
          {selected.size ? (
            <>
              <span className="text-sm font-semibold tabular-nums">
                Выбрано: {selected.size}
              </span>
              {bulkActions}
              <Button
                onClick={() => onSelectedChange(new Set())}
                size="sm"
                variant="ghost"
              >
                Снять выбор
              </Button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {items.length} записей
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="sm" variant="outline" />}
            >
              Колонки
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Показывать в таблице</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.map((column) => (
                  <DropdownMenuCheckboxItem
                    checked={visible.has(column.id)}
                    key={column.id}
                    onCheckedChange={(checked) => {
                      const next = new Set(visible)
                      if (checked) next.add(column.id)
                      else if (next.size > 1) next.delete(column.id)
                      setVisible(next)
                    }}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {modes.length > 1 ? (
            <Tabs
              onValueChange={(value) => setMode(value as EntityViewMode)}
              value={mode}
            >
              <TabsList>
                {modes.map((item) => (
                  <TabsTrigger key={item} value={item}>
                    {modeLabels[item]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
        </div>
      </div>

      <FadeContent duration={240} initialOpacity={0.5} key={mode}>
        {loading ? (
          <div className="surface-card p-8 text-center text-sm text-muted-foreground">
            {loadingText}
          </div>
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
                            {column.value(item)}
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
        ) : mode === "kanban" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              ...new Set(items.map((item) => groupBy?.(item) ?? "Без группы")),
            ].map((group) => (
              <Card className="min-w-0 gap-3 py-3" key={group} size="sm">
                <CardHeader className="px-3">
                  <CardTitle className="text-sm font-semibold">
                    {group}
                  </CardTitle>
                  <CardAction className="text-xs text-muted-foreground tabular-nums">
                    {
                      items.filter(
                        (item) => (groupBy?.(item) ?? "Без группы") === group
                      ).length
                    }
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-2 px-3">
                  {items
                    .filter(
                      (item) => (groupBy?.(item) ?? "Без группы") === group
                    )
                    .map((item) => (
                      <ContextMenu key={getId(item)}>
                        <ContextMenuTrigger
                          render={
                            <Card
                              className="gap-0 rounded-xl bg-background p-3 shadow-none ring-border"
                              size="sm"
                            />
                          }
                        >
                          {card(item)}
                        </ContextMenuTrigger>
                        <EntityMenu
                          actions={actions}
                          item={item}
                          label={getLabel(item)}
                        />
                      </ContextMenu>
                    ))}
                </CardContent>
              </Card>
            ))}
          </div>
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
                        <div
                          className="rounded-xl bg-muted/60 p-3"
                          key={getId(item)}
                        >
                          {card(item)}
                        </div>
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
                  {card(item)}
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
    </section>
  )
}
