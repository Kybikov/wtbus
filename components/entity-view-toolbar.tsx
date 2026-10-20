"use client"

import * as React from "react"
import {
  operatorLabels,
  countQuery,
  type QueryFieldChoice,
  type FilterGroup,
} from "@/lib/entity-query"
import { ReorderableList } from "@/components/list-4"
import { createPortal } from "react-dom"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import { EntityFilters } from "@/components/entity-filters"
import { HoldActionButton } from "@/components/ui/hold-action-button"
import { useFieldAutosave } from "@/components/use-field-autosave"
import { sessionFetch } from "@/lib/session-navigation"
import { adminControlClassName } from "@/lib/admin-ui"
import { cn } from "@/lib/utils"
import {
  Check,
  ArrowDownUp,
  Copy,
  Eye,
  RotateCcw,
  Save,
  Trash2,
  ChevronDown,
  CheckSquare2,
  CalendarDays,
  GalleryHorizontal,
  KanbanSquare,
  List,
  Rows3,
  Table2,
  Columns3,
  Plus,
  Settings2,
  Users,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu"
import {
  arrangeBoardGroups,
  entityModeLabels,
  sameViewConfig,
  type BoardLayout,
  type BoardOrderBy,
  type EntityCollection,
  type EntityFilter,
  type EntityViewConfig,
  type EntityViewMode,
  type SavedEntityView,
} from "@/lib/entity-views"

const control = adminControlClassName
const modeIcons: Record<
  EntityViewMode,
  React.ComponentType<{ className?: string }>
> = {
  table: Table2,
  list: List,
  kanban: KanbanSquare,
  calendar: CalendarDays,
  gallery: GalleryHorizontal,
  schedule: Rows3,
}

function ViewChip({
  label,
  mode,
  selected,
  shared,
  dirty,
  onClick,
  menu,
}: {
  label: string
  mode: EntityViewMode
  selected: boolean
  shared?: boolean
  dirty?: boolean
  onClick: () => void
  menu: React.ReactNode
}) {
  const Icon = modeIcons[mode]
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-pressed={selected}
            title={`${label} · ${entityModeLabels[mode]}${shared ? " · общий" : ""}`}
            className={cn(
              control,
              "max-w-56",
              selected && "border-primary/50 bg-primary/15 text-foreground"
            )}
            onClick={onClick}
          />
        }
      >
        <Icon />
        <span className="truncate">{label}</span>
        {shared ? <Users className="text-muted-foreground" /> : null}
        {dirty ? (
          <span
            aria-label="Есть несохранённые изменения"
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
        ) : null}
      </ContextMenuTrigger>
      {menu}
    </ContextMenu>
  )
}
function BoardSettings({
  groups,
  config,
  onChange,
  onConfigureCard,
}: {
  groups: { id: string; label: string; count: number }[]
  config: EntityViewConfig
  onChange: (config: EntityViewConfig) => void
  onConfigureCard?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const board = config.board
  const hidden = new Set(board?.hidden ?? [])
  const orderBy = board?.orderBy ?? "manual"
  const shown = arrangeBoardGroups(groups, {
    hidden: [],
    order: board?.order ?? [],
    orderBy,
  })
  const visibleCount = groups.filter((group) => !hidden.has(group.id)).length
  function update(next: BoardLayout) {
    onChange({
      ...config,
      board: {
        ...next,
        ...(board?.cardOrder ? { cardOrder: board.cardOrder } : {}),
      },
    })
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className={control} />}
      >
        <KanbanSquare />
        <span className="sr-only sm:not-sr-only">Столбцы</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl p-3"
      >
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Порядок столбцов
          </p>
          <FieldSelect
            aria-label="Порядок столбцов"
            onValueChange={(value) =>
              update({
                hidden: [...hidden],
                order:
                  value === "manual"
                    ? shown.map((group) => group.id)
                    : (board?.order ?? []),
                orderBy: value as BoardOrderBy,
              })
            }
            options={[
              { value: "manual", label: "Вручную" },
              { value: "name", label: "По названию" },
              { value: "count", label: "По количеству записей" },
            ]}
            value={orderBy}
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          <ReorderableList
            items={shown}
            getId={(group) => group.id}
            getLabel={(group) => group.label}
            disabled={orderBy !== "manual"}
            onReorder={(next) =>
              update({
                hidden: [...hidden],
                order: next.map((group) => group.id),
                orderBy: "manual",
              })
            }
          >
            {(group, handle) => (
              <div className="flex min-h-12 items-center gap-2 px-1">
                {handle}
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <Checkbox
                    checked={!hidden.has(group.id)}
                    disabled={!hidden.has(group.id) && visibleCount === 1}
                    onCheckedChange={(checked) => {
                      const next = new Set(hidden)
                      if (checked) next.delete(group.id)
                      else next.add(group.id)
                      update({
                        hidden: [...next],
                        order: board?.order ?? [],
                        orderBy,
                      })
                    }}
                  />
                  <span className="truncate">{group.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {group.count}
                  </span>
                </label>
              </div>
            )}
          </ReorderableList>
        </div>
        {onConfigureCard ? (
          <Button
            className="w-full justify-start"
            onClick={() => {
              setOpen(false)
              onConfigureCard?.()
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Settings2 />
            Настройка карточки
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function ViewSorting({
  columns,
  config,
  onChange,
}: {
  columns: { id: string; label: string }[]
  config: EntityViewConfig
  onChange: (next: EntityViewConfig) => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label="Сортировка"
            variant="outline"
            size="sm"
            className={control}
          />
        }
      >
        <ArrowDownUp />
        <span className="sr-only sm:not-sr-only">Сортировка</span>
        {config.sort && <span className="size-1.5 rounded-full bg-primary" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <p className="text-sm font-medium">Сортировка записей</p>
        <FieldSelect
          aria-label="Поле сортировки"
          options={[
            { value: "", label: "Вручную" },
            ...columns.map((column) => ({
              value: column.id,
              label: column.label,
            })),
          ]}
          value={config.sort?.columnId ?? ""}
          onValueChange={(columnId) =>
            onChange({
              ...config,
              sort: columnId
                ? { columnId, direction: config.sort?.direction ?? "asc" }
                : null,
            })
          }
        />
        {config.sort && (
          <FieldSelect
            aria-label="Направление сортировки"
            options={[
              { value: "asc", label: "По возрастанию" },
              { value: "desc", label: "По убыванию" },
            ]}
            value={config.sort.direction}
            onValueChange={(direction) =>
              onChange({
                ...config,
                sort: {
                  columnId: config.sort!.columnId,
                  direction: direction === "desc" ? "desc" : "asc",
                },
              })
            }
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

type Props<T> = {
  extras?: React.ReactNode
  collection: EntityCollection
  config: EntityViewConfig
  defaults: EntityViewConfig
  onChange: (config: EntityViewConfig) => void
  modes: EntityViewMode[]
  columns: { id: string; label: string }[]
  queryFields: QueryFieldChoice[]
  queryCount?: (query: FilterGroup) => number
  filters: EntityFilter<T>[]
  ready: boolean
  resultCount: number
  loading?: boolean
  bulkActions?: React.ReactNode
  selectedCount?: number
  onClearSelection?: () => void
  filterRequest?: string | null
  onFilterRequestHandled?: () => void
  onConfigureCard?: () => void
  groups?: { id: string; label: string; count: number }[]
}

export function EntityViewToolbar<T>({
  extras,
  collection,
  config,
  defaults,
  onChange,
  modes,
  columns,
  filters,
  queryFields,
  queryCount,
  ready,
  bulkActions,
  selectedCount = 0,
  onClearSelection,
  filterRequest,
  onFilterRequestHandled,
  onConfigureCard,
  groups = [],
}: Props<T>) {
  const [views, setViews] = React.useState<SavedEntityView[]>([])
  const [active, setActive] = React.useState<string>("")
  const [scope, setScope] = React.useState("")
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const [dialog, setDialog] = React.useState<
    "create" | "edit" | "delete" | null
  >(null)
  const [name, setName] = React.useState("")
  const [visibility, setVisibility] = React.useState("private")
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const autosave = useFieldAutosave<SavedEntityView>(async (next) => {
    const response = await sessionFetch(
      `/api/entity-views?entity=${collection}&id=${encodeURIComponent(next.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: next.name,
          visibility: next.visibility,
          config: next.config,
          version: next.version,
        }),
        signal: AbortSignal.timeout(10000),
      }
    )
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.item) {
      const message = payload?.error ?? "Не удалось сохранить вид."
      setError(message)
      throw Error(message)
    }
    setError("")
    setViews((list) =>
      list.map((view) => (view.id === payload.item.id ? payload.item : view))
    )
    return payload.item as SavedEntityView
  })
  const applyRef = React.useRef(onChange)
  React.useEffect(() => {
    applyRef.current = onChange
  }, [onChange])
  const defaultsRef = React.useRef(defaults)
  React.useLayoutEffect(() => {
    defaultsRef.current = defaults
  }, [defaults])
  const activeRef = React.useRef(active)
  React.useLayoutEffect(() => {
    activeRef.current = active
  }, [active])
  const restored = React.useRef(false)
  const loadedRevision = React.useRef(-1)
  React.useEffect(() => {
    if (!ready || loadedRevision.current === revision) return
    const controller = new AbortController()
    sessionFetch(`/api/entity-views?entity=${collection}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok)
          throw new Error(payload.error ?? "Не удалось загрузить виды.")
        if (controller.signal.aborted) return
        loadedRevision.current = revision
        setViews(payload.items)
        setScope(payload.scopeKey)
        setError("")
        if (restored.current) {
          const selected = (payload.items as SavedEntityView[]).find(
            (item) => item.id === activeRef.current
          )
          autosave.initialize(selected ?? null)
        }
        if (!restored.current) {
          restored.current = true
          let remembered: string | null = null
          try {
            remembered = localStorage.getItem(
              `entity-view:${payload.scopeKey}:${collection}`
            )
          } catch {}
          const view = (payload.items as SavedEntityView[]).find(
            (item) => item.id === remembered
          )
          if (view) {
            autosave.initialize(view)
            setActive(view.id)
            applyRef.current(view.config)
          }
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message)
      })
    return () => controller.abort()
  }, [collection, revision, ready, autosave])
  const current = views.find((view) => view.id === active)
  const dirty = !sameViewConfig(config, current?.config ?? defaults)
  const [drafts, setDrafts] = React.useState(
    () => new Map<string, EntityViewConfig>()
  )
  function discardDraft(id: string) {
    setDrafts((current) => {
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }
  const [targetView, setTargetView] = React.useState<
    SavedEntityView | undefined
  >()
  const [createConfig, setCreateConfig] = React.useState<EntityViewConfig>()
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  React.useEffect(() => {
    if (!dirty && !drafts.size) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, drafts.size])
  async function saveCurrent() {
    if (!current?.canEdit || busy || !dirty) return
    const snapshot = config,
      view = current
    setBusy(true)
    setError("")
    try {
      const response = await sessionFetch(
        `/api/entity-views?entity=${collection}&id=${encodeURIComponent(view.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: view.name,
            visibility: view.visibility,
            config: snapshot,
            version: view.version,
          }),
          signal: AbortSignal.timeout(10000),
        }
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.item)
        throw Error(payload?.error ?? "Не удалось сохранить вид.")
      setViews((list) =>
        list.map((item) => (item.id === view.id ? payload.item : item))
      )
      setDrafts((current) => {
        const stashed = current.get(view.id)
        if (stashed && !sameViewConfig(stashed, snapshot)) return current
        const next = new Map(current)
        next.delete(view.id)
        return next
      })
      if (activeRef.current === view.id) autosave.initialize(payload.item)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось сохранить вид."
      )
    } finally {
      setBusy(false)
    }
  }
  function resetDraft() {
    setError("")
    discardDraft(active)
    onChange(current?.config ?? defaults)
  }
  function select(view?: SavedEntityView) {
    setError("")
    if (dirty) setDrafts((current) => new Map(current).set(active, config))
    else discardDraft(active)
    autosave.initialize(view ?? null)
    setActive(view?.id ?? "")
    onChange(drafts.get(view?.id ?? "") ?? view?.config ?? defaults)
    try {
      localStorage.setItem(`entity-view:${scope}:${collection}`, view?.id ?? "")
    } catch {}
  }
  function open(
    kind: "create" | "edit" | "delete",
    view: SavedEntityView | null | undefined = current
  ) {
    setTargetView(view ?? undefined)
    if (kind === "create")
      setCreateConfig(
        view === null
          ? (drafts.get("") ?? defaults)
          : view && view.id !== active
            ? view.config
            : config
      )
    if (kind === "edit") autosave.initialize(view ?? null)
    setName(kind === "create" ? "" : (view?.name ?? ""))
    setVisibility(
      kind === "create" ? "private" : (view?.visibility ?? "private")
    )
    setError("")
    setDialog(kind)
  }
  async function write(kind: "create" | "edit" | "delete") {
    if (busy || !scope) return
    if (kind !== "delete" && !name.trim()) {
      setError("Введите название вида.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const response = await sessionFetch(
        `/api/entity-views?entity=${collection}${kind !== "create" ? `&id=${targetView?.id}` : ""}`,
        {
          method:
            kind === "create" ? "POST" : kind === "edit" ? "PATCH" : "DELETE",
          signal: AbortSignal.timeout(10000),
          headers: { "Content-Type": "application/json" },
          ...(kind !== "delete"
            ? {
                body: JSON.stringify({
                  name: name.trim(),
                  visibility,
                  config:
                    kind === "create"
                      ? (createConfig ?? config)
                      : targetView?.config,
                  version: targetView?.version ?? 0,
                }),
              }
            : {}),
        }
      )
      const payload = await response.json()
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось сохранить вид.")
      if (kind === "delete") {
        setViews((list) => list.filter((view) => view.id !== targetView?.id))
        discardDraft(targetView?.id ?? "")
        if (active === targetView?.id) {
          discardDraft(active)
          setActive("")
          onChange(drafts.get("") ?? defaults)
          autosave.initialize(null)
          try {
            localStorage.setItem(`entity-view:${scope}:${collection}`, "")
          } catch {}
        }
      } else {
        setViews((list) => [
          ...list.filter((view) => view.id !== payload.item.id),
          payload.item,
        ])
        discardDraft(payload.item.id)
        setActive(payload.item.id)
        autosave.initialize(payload.item)
        onChange(payload.item.config)
        try {
          localStorage.setItem(
            `entity-view:${scope}:${collection}`,
            payload.item.id
          )
        } catch {}
      }
      setDialog(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка сохранения.")
    } finally {
      setBusy(false)
    }
  }
  const viewMenu = (view?: SavedEntityView) => (
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuLabel>{view?.name ?? "По умолчанию"}</ContextMenuLabel>
        <ContextMenuItem onClick={() => select(view)}>
          <Eye />
          Открыть вид
        </ContextMenuItem>
        {onConfigureCard && (view?.id ?? "") === active && (
          <ContextMenuItem onClick={onConfigureCard}>
            <Settings2 />
            Настройка карточки
          </ContextMenuItem>
        )}
        <ContextMenuItem
          disabled={busy || !scope}
          onClick={() => open("create", view ?? null)}
        >
          <Copy />
          Создать копию
        </ContextMenuItem>
        {view?.canEdit && (
          <ContextMenuItem disabled={busy} onClick={() => open("edit", view)}>
            <Settings2 />
            Настройки вида
          </ContextMenuItem>
        )}
        {(view?.id ?? "") === active && dirty && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!view?.canEdit || busy}
              onClick={() => void saveCurrent()}
            >
              <Save />
              Сохранить изменения
            </ContextMenuItem>
            <ContextMenuItem disabled={busy} onClick={resetDraft}>
              <RotateCcw />
              Сбросить изменения
            </ContextMenuItem>
          </>
        )}
        {view?.canEdit && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={busy}
              onClick={() => open("delete", view)}
            >
              <Trash2 />
              Удалить вид
            </ContextMenuItem>
          </>
        )}
      </ContextMenuGroup>
    </ContextMenuContent>
  )
  const activeFilters = filters.filter((filter) => config.filters[filter.id])
  const clearFilter = (id: string) => {
    const next = { ...config.filters }
    delete next[id]
    onChange({ ...config, filters: next })
  }
  const filterValueLabel = (filter: EntityFilter<T>) => {
    const value = config.filters[filter.id]
    if (!value) return ""
    if (filter.type === "date") {
      const [year, month, day] = value.split("-")
      return year && month && day ? `${day}.${month}.${year}` : value
    }
    return String(
      filter.options?.find((option) => option.value === value)?.label ?? value
    )
  }
  return (
    <>
      <div
        role="region"
        className="workspace-panel flex min-h-[50px] flex-col gap-2 p-2"
        aria-label="Виды и настройки отображения"
      >
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto sm:flex-1 sm:flex-wrap">
            {extras}
            <div
              role="group"
              aria-label="Сохранённые виды"
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 sm:flex-initial sm:flex-wrap sm:overflow-visible sm:pb-0"
            >
              <ViewChip
                label="По умолчанию"
                mode={active ? defaults.mode : config.mode}
                selected={!active}
                dirty={!active ? dirty : drafts.has("")}
                onClick={() => select()}
                menu={viewMenu()}
              />
              {(["shared", "private"] as const).flatMap((group) =>
                views
                  .filter((view) => view.visibility === group)
                  .map((view) => (
                    <ViewChip
                      key={view.id}
                      label={view.name}
                      mode={view.id === active ? config.mode : view.config.mode}
                      selected={view.id === active}
                      shared={view.visibility === "shared"}
                      dirty={view.id === active ? dirty : drafts.has(view.id)}
                      onClick={() => select(view)}
                      menu={viewMenu(view)}
                    />
                  ))
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className={control}
              disabled={!scope || busy}
              onClick={() => open("create")}
            >
              <Plus />
              <span className="sr-only sm:not-sr-only">Создать вид</span>
            </Button>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            {selectedCount ? (
              <Popover>
                <PopoverTrigger
                  render={
                    <Button variant="outline" size="sm" className={control} />
                  }
                >
                  <CheckSquare2 />
                  Выбрано · {selectedCount}
                  <ChevronDown />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-auto min-w-56 space-y-2 rounded-xl p-2"
                >
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    Действия с выбранными
                  </p>
                  <div className="flex flex-col gap-1 [&_button]:w-full [&_button]:justify-start">
                    {bulkActions}
                    <Button
                      onClick={onClearSelection}
                      size="sm"
                      variant="ghost"
                    >
                      <X />
                      Снять выбор
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
            <ViewSorting
              columns={columns.filter((column) =>
                config.columns.includes(column.id)
              )}
              config={config}
              onChange={onChange}
            />
            {config.mode === "table" ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" size="sm" className={control} />
                  }
                >
                  <Columns3 />
                  <span className="sr-only sm:not-sr-only">Колонки</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-80 overflow-y-auto"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Видимые колонки</DropdownMenuLabel>
                    {columns.map((column) => (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        checked={config.columns.includes(column.id)}
                        disabled={
                          config.columns.length === 1 &&
                          config.columns.includes(column.id)
                        }
                        onCheckedChange={(checked) =>
                          onChange({
                            ...config,
                            columns: checked
                              ? [...config.columns, column.id]
                              : config.columns.filter((id) => id !== column.id),
                          })
                        }
                      >
                        {column.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : config.mode === "kanban" ? (
              <BoardSettings
                config={config}
                groups={groups}
                onChange={onChange}
                onConfigureCard={onConfigureCard}
              />
            ) : onConfigureCard ? (
              <Button
                className={control}
                onClick={onConfigureCard}
                size="sm"
                type="button"
                variant="outline"
              >
                <Settings2 />
                <span className="sr-only sm:not-sr-only">Карточка</span>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className={control} />
                }
              >
                {React.createElement(modeIcons[config.mode], {
                  className: "size-4",
                })}
                {entityModeLabels[config.mode]}
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Отображение</DropdownMenuLabel>
                  {modes.map((mode) => (
                    <DropdownMenuItem
                      key={mode}
                      onClick={() => onChange({ ...config, mode })}
                    >
                      {React.createElement(modeIcons[mode], {
                        className: "size-4",
                      })}
                      {entityModeLabels[mode]}
                      {mode === config.mode && (
                        <Check className="ml-auto text-emerald-500!" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {queryFields.length > 0 && (
              <EntityFilters
                fields={queryFields}
                values={config.filters}
                query={config.query}
                initialField={filterRequest}
                count={queryCount}
                open={filtersOpen || Boolean(filterRequest)}
                onOpenChange={(open) => {
                  setFiltersOpen(open)
                  if (!open) onFilterRequestHandled?.()
                }}
                onChange={(query) =>
                  onChange({
                    ...config,
                    filters: {},
                    query: countQuery(query) ? query : undefined,
                  })
                }
              />
            )}
          </div>
        </div>
        {countQuery(config.query) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2">
            {config.query?.rules.map((node, index) => (
              <React.Fragment key={node.id}>
                {index > 0 && (
                  <span className="px-1 text-xs text-muted-foreground">
                    {config.query?.combinator === "or" ? "ИЛИ" : "И"}
                  </span>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="max-w-full gap-1.5 rounded-lg text-xs font-normal"
                  onClick={() => setFiltersOpen(true)}
                >
                  {"rules" in node
                    ? `${node.combinator === "or" ? "Любое" : "Все"} из ${countQuery(node)} условий`
                    : `${queryFields.find((field) => field.id === node.field)?.label ?? "Колонка"} · ${operatorLabels[node.operator].toLocaleLowerCase("ru")} ${node.value.map((value) => queryFields.find((field) => field.id === node.field)?.options?.find((option) => option.value === value)?.label ?? value).join(", ")}`}
                </Button>
              </React.Fragment>
            ))}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Сбросить условия"
              onClick={() => onChange({ ...config, query: undefined })}
            >
              <X />
            </Button>
          </div>
        )}
        {activeFilters.length ? (
          <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-border/70 pt-2">
            <span className="px-1 text-xs text-muted-foreground">
              Активные:
            </span>
            {activeFilters.map((filter) => (
              <Button
                key={filter.id}
                className="h-7 gap-1.5 rounded-lg px-2 text-xs font-normal"
                onClick={() => clearFilter(filter.id)}
                size="sm"
                variant="secondary"
              >
                <span className="text-muted-foreground">{filter.label}:</span>
                <span className="max-w-44 truncate">
                  {filterValueLabel(filter)}
                </span>
                <X className="size-3" />
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {error && !dialog ? (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-destructive"
        >
          {error}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRevision((value) => value + 1)}
          >
            Обновить виды
          </Button>
        </div>
      ) : null}
      {mounted &&
        dirty &&
        createPortal(
          <section
            aria-label="Несохранённые изменения вида"
            className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-2xl border border-primary/30 bg-popover p-3 shadow-xl sm:bottom-20"
          >
            <p role="status" className="px-1 text-sm font-medium">
              Есть несохранённые изменения
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !current?.canEdit}
                title={
                  !current
                    ? "Стандартный вид: сохраните изменения как новый вид"
                    : !current.canEdit
                      ? "Этот вид доступен только для просмотра"
                      : undefined
                }
                onClick={() => void saveCurrent()}
              >
                <Save />
                Сохранить в текущий
              </Button>
              <Button
                size="sm"
                disabled={busy || !scope}
                onClick={() => open("create")}
              >
                <Plus />
                Создать новый
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Отменить изменения вида"
                disabled={busy}
                onClick={resetDraft}
              >
                <RotateCcw />
              </Button>
            </div>
          </section>,
          document.body
        )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setDialog(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog === "delete"
                ? "Удалить вид?"
                : dialog === "edit"
                  ? "Настройки вида"
                  : "Создать вид"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "delete"
                ? "Данные останутся. Будут удалены только настройки отображения."
                : "Сохраняются режим отображения, фильтры, видимые колонки и метрики."}
            </DialogDescription>
          </DialogHeader>
          {dialog !== "delete" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="entity-view-name" className="text-sm">
                  Название
                </label>
                <Input
                  id="entity-view-name"
                  value={name}
                  maxLength={80}
                  onBlur={() => {
                    if (dialog === "edit")
                      autosave.commit({ name: name.trim() })
                  }}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Название вида"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="entity-view-visibility" className="text-sm">
                  Доступ
                </label>
                <FieldSelect
                  aria-label="Доступ"
                  value={visibility}
                  onValueChange={(next) => {
                    setVisibility(next)
                    if (dialog === "edit")
                      autosave.commit({
                        visibility: next as SavedEntityView["visibility"],
                      })
                  }}
                  options={[
                    { value: "private", label: "Приватный — только для меня" },
                    { value: "shared", label: "Общий — для команды" },
                  ]}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm">{targetView?.name}</p>
          )}
          {error ? (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{error}</p>
              {dialog !== "create" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setDialog(null)
                    setRevision((value) => value + 1)
                  }}
                >
                  Обновить виды
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDialog(null)}
            >
              {dialog === "edit" ? "Готово" : "Отмена"}
            </Button>
            {dialog === "delete" ? (
              <HoldActionButton
                disabled={busy}
                onConfirm={() => void write("delete")}
              >
                Удалить
              </HoldActionButton>
            ) : (
              dialog !== "edit" && (
                <Button
                  variant="default"
                  disabled={busy}
                  onClick={() => dialog && void write(dialog)}
                >
                  {busy ? "Сохраняем…" : "Создать вид"}
                </Button>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
