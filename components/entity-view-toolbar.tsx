"use client"

import * as React from "react"
import { sessionFetch } from "@/lib/session-navigation"
import { adminControlClassName } from "@/lib/admin-ui"
import {
  ChevronDown,
  Columns3,
  Filter,
  LayoutGrid,
  Lock,
  Plus,
  Save,
  Users,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FieldSelect } from "@/components/ui/field-select"
import { DatePicker } from "@/components/ui/date-picker"
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
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  entityModeLabels,
  sameViewConfig,
  type EntityCollection,
  type EntityFilter,
  type EntityViewConfig,
  type EntityViewMode,
  type SavedEntityView,
} from "@/lib/entity-views"

const control = adminControlClassName
type Props<T> = {
  extras?: React.ReactNode
  collection: EntityCollection
  config: EntityViewConfig
  defaults: EntityViewConfig
  onChange: (config: EntityViewConfig) => void
  modes: EntityViewMode[]
  columns: { id: string; label: string }[]
  filters: EntityFilter<T>[]
  ready: boolean
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
  ready,
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
  const applyRef = React.useRef(onChange)
  React.useEffect(() => {
    applyRef.current = onChange
  }, [onChange])
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
            setActive(view.id)
            applyRef.current(view.config)
          }
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message)
      })
    return () => controller.abort()
  }, [collection, revision, ready])
  const current = views.find((view) => view.id === active)
  const dirty = !sameViewConfig(config, current?.config ?? defaults)
  function select(view?: SavedEntityView) {
    setActive(view?.id ?? "")
    onChange(view?.config ?? defaults)
    try {
      localStorage.setItem(`entity-view:${scope}:${collection}`, view?.id ?? "")
    } catch {}
  }
  function open(kind: "create" | "edit" | "delete") {
    setName(kind === "create" ? "" : (current?.name ?? ""))
    setVisibility(
      kind === "create" ? "private" : (current?.visibility ?? "private")
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
        `/api/entity-views?entity=${collection}${kind !== "create" ? `&id=${current?.id}` : ""}`,
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
                  config,
                  version: current?.version ?? 0,
                }),
              }
            : {}),
        }
      )
      const payload = await response.json()
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось сохранить вид.")
      if (kind === "delete") {
        setViews((list) => list.filter((view) => view.id !== active))
        select()
      } else {
        setViews((list) => [
          ...list.filter((view) => view.id !== payload.item.id),
          payload.item,
        ])
        select(payload.item)
      }
      setDialog(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка сохранения.")
    } finally {
      setBusy(false)
    }
  }
  const filterCount = Object.values(config.filters).filter(Boolean).length
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
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {extras}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className={control} />
                }
              >
                {current?.visibility === "shared" ? (
                  <Users />
                ) : current ? (
                  <Lock />
                ) : (
                  <LayoutGrid />
                )}
                <span className="max-w-28 truncate sm:max-w-44">
                  {current?.name ?? "По умолчанию"}
                </span>
                {dirty ? (
                  <span
                    aria-label="Есть несохранённые изменения"
                    className="size-1.5 rounded-full bg-primary"
                  />
                ) : null}
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-80 w-64 overflow-y-auto"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => select()}>
                    По умолчанию
                  </DropdownMenuItem>
                  {(["shared", "private"] as const).map((group) => (
                    <React.Fragment key={group}>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>
                        {group === "shared" ? "Общие виды" : "Мои виды"}
                      </DropdownMenuLabel>
                      {views
                        .filter((view) => view.visibility === group)
                        .map((view) => (
                          <DropdownMenuItem
                            key={view.id}
                            onClick={() => select(view)}
                          >
                            {view.name}
                            {active === view.id ? " ✓" : ""}
                          </DropdownMenuItem>
                        ))}
                    </React.Fragment>
                  ))}
                  {current?.canEdit ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => open("edit")}>
                        Настроить и сохранить вид
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => open("delete")}
                      >
                        Удалить вид
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
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
            {current?.canEdit && dirty ? (
              <Button
                variant="outline"
                size="sm"
                className={control}
                disabled={busy}
                onClick={() => open("edit")}
              >
                <Save />
                Сохранить
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className={control} />
                }
              >
                <LayoutGrid />
                {entityModeLabels[config.mode]}
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Режим отображения</DropdownMenuLabel>
                  {modes.map((mode) => (
                    <DropdownMenuItem
                      key={mode}
                      onClick={() => onChange({ ...config, mode })}
                    >
                      {entityModeLabels[mode]}
                      {mode === config.mode ? " ✓" : ""}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {filters.length ? (
              <Popover>
                <PopoverTrigger
                  render={
                    <Button variant="outline" size="sm" className={control} />
                  }
                >
                  <Filter />
                  <span className="sr-only sm:not-sr-only">Фильтры</span>
                  {filterCount ? ` · ${filterCount}` : null}
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-80 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Фильтры</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      disabled={!filterCount}
                      onClick={() => onChange({ ...config, filters: {} })}
                    >
                      Сбросить
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Условия применяются одновременно. Пустое поле не
                    ограничивает данные.
                  </p>
                  <div className="space-y-3">
                    {filters.map((filter) => (
                      <div key={filter.id} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            className="text-xs font-medium text-muted-foreground"
                            htmlFor={`${collection}-filter-${filter.id}`}
                          >
                            {filter.label}
                          </label>
                          {config.filters[filter.id] ? (
                            <Button
                              aria-label={`Сбросить фильтр ${filter.label}`}
                              className="size-6 text-muted-foreground"
                              onClick={() => clearFilter(filter.id)}
                              size="icon"
                              variant="ghost"
                            >
                              <X className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                        {filter.type === "date" ? (
                          <DatePicker
                            label={filter.label}
                            id={`${collection}-filter-${filter.id}`}
                            value={config.filters[filter.id] ?? ""}
                            onValueChange={(value) =>
                              onChange({
                                ...config,
                                filters: {
                                  ...config.filters,
                                  [filter.id]: value,
                                },
                              })
                            }
                          />
                        ) : (
                          <FieldSelect
                            aria-label={filter.label}
                            value={config.filters[filter.id] ?? ""}
                            onValueChange={(value) =>
                              onChange({
                                ...config,
                                filters: {
                                  ...config.filters,
                                  [filter.id]: value,
                                },
                              })
                            }
                            options={[
                              { value: "", label: "Все" },
                              ...(filter.options ?? []),
                            ]}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
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
          </div>
        </div>
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
                  onValueChange={setVisibility}
                  options={[
                    { value: "private", label: "Приватный — только для меня" },
                    { value: "shared", label: "Общий — для команды" },
                  ]}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm">{current?.name}</p>
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
              Отмена
            </Button>
            <Button
              variant={dialog === "delete" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => dialog && void write(dialog)}
            >
              {busy
                ? "Сохраняем…"
                : dialog === "delete"
                  ? "Удалить"
                  : "Сохранить вид"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
