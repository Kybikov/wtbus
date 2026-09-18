import type { EntityMetric } from "./entity-metrics.ts"
export type EntityCollection = "customers" | "bookings" | "team"
export type EntityViewMode =
  "table" | "list" | "kanban" | "calendar" | "gallery"
export type EntityViewConfig = {
  mode: EntityViewMode
  columns: string[]
  filters: Record<string, string>
  metrics?: EntityMetric[]
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
}

export function normalizeViewConfig(
  config: EntityViewConfig,
  modes: EntityViewMode[],
  columnIds: string[],
  defaults: string[],
  filterIds: string[]
): EntityViewConfig {
  const columns = columnIds.filter((id) => config.columns.includes(id))
  return {
    mode: modes.includes(config.mode) ? config.mode : modes[0],
    columns: columns.length ? columns : defaults,
    filters: Object.fromEntries(
      Object.entries(config.filters).filter(
        ([id, value]) => filterIds.includes(id) && value !== ""
      )
    ),
    metrics: config.metrics ?? [],
  }
}

export function sameViewConfig(a: EntityViewConfig, b: EntityViewConfig) {
  const canonical = (value: EntityViewConfig) =>
    JSON.stringify({
      mode: value.mode,
      columns: [...value.columns].sort(),
      filters: Object.entries(value.filters)
        .filter(([, v]) => v !== "")
        .sort(([a], [b]) => a.localeCompare(b)),
      metrics: value.metrics ?? [],
    })
  return canonical(a) === canonical(b)
}
