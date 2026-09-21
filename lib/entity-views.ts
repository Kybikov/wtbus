import type { EntityMetric } from "./entity-metrics.ts"
export const entityCollections = [
  "customers",
  "bookings",
  "team",
  "routes",
  "fleet",
  "requests",
  "availability",
  "trips",
  "cash-balances",
] as const
export type EntityCollection = (typeof entityCollections)[number]
export type EntityViewMode =
  "table" | "list" | "kanban" | "calendar" | "gallery" | "schedule"
export type EntityViewConfig = {
  mode: EntityViewMode
  columns: string[]
  filters: Record<string, string>
  metrics?: EntityMetric[]
  columnWidths?: Record<string, number>
  pinnedColumns?: { left: string[]; right: string[] }
  sort?: { columnId: string; direction: "asc" | "desc" } | null
}
export type SavedEntityView = {
  id: string
  name: string
  visibility: "private" | "shared"
  config: EntityViewConfig
  version: number
  canEdit: boolean
}
export type EntityFilter<T> = {
  id: string
  label: string
  type?: "select" | "date"
  options?: { value: string; label: string }[]
  matches?: (item: T, value: string) => boolean
}
export const entityModeLabels: Record<EntityViewMode, string> = {
  table: "Таблица",
  list: "Список",
  kanban: "Канбан",
  calendar: "Календарь",
  gallery: "Галерея",
  schedule: "Расписание",
}

export function normalizeViewConfig(
  config: EntityViewConfig,
  modes: EntityViewMode[],
  columnIds: string[],
  defaults: string[],
  filterIds: string[]
): EntityViewConfig {
  const columns = config.columns.filter((id) => columnIds.includes(id))
  const visible = new Set(columns)
  const widths = Object.fromEntries(
    Object.entries(config.columnWidths ?? {}).filter(
      ([id, width]) => columnIds.includes(id) && width >= 96 && width <= 720
    )
  )
  const pins = config.pinnedColumns ?? { left: [], right: [] }
  const cleanPins = (ids: string[]) =>
    ids.filter((id, index) => visible.has(id) && ids.indexOf(id) === index)
  const left = cleanPins(pins.left)
  const right = cleanPins(pins.right).filter((id) => !left.includes(id))
  const sort =
    config.sort && visible.has(config.sort.columnId) ? config.sort : null
  return {
    mode: modes.includes(config.mode) ? config.mode : modes[0],
    columns: columns.length ? columns : defaults,
    filters: Object.fromEntries(
      Object.entries(config.filters).filter(
        ([id, value]) => filterIds.includes(id) && value !== ""
      )
    ),
    metrics: config.metrics ?? [],
    columnWidths: widths,
    pinnedColumns: { left, right },
    sort,
  }
}

export function sameViewConfig(a: EntityViewConfig, b: EntityViewConfig) {
  const canonical = (value: EntityViewConfig) =>
    JSON.stringify({
      mode: value.mode,
      columns: value.columns,
      filters: Object.entries(value.filters)
        .filter(([, v]) => v !== "")
        .sort(([a], [b]) => a.localeCompare(b)),
      metrics: value.metrics ?? [],
      columnWidths: Object.entries(value.columnWidths ?? {}).sort(([a], [b]) =>
        a.localeCompare(b)
      ),
      pinnedColumns: value.pinnedColumns ?? { left: [], right: [] },
      sort: value.sort ?? null,
    })
  return canonical(a) === canonical(b)
}
