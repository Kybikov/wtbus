import { normalizeQuery, type FilterGroup } from "./entity-query.ts"
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
export type CardLayoutKind = "title" | "one" | "two"
export type CardSize = "xs" | "sm" | "md"
export type CardRow = { fields: string[]; layout: CardLayoutKind }
export type CardLayout = { size: CardSize; rows: CardRow[] }
export type BoardOrderBy = "manual" | "name" | "count"
export type BoardLayout = {
  hidden: string[]
  order: string[]
  orderBy: BoardOrderBy
  cardOrder?: string[]
}
export type EntityViewConfig = {
  mode: EntityViewMode
  columns: string[]
  filters: Record<string, string>
  query?: FilterGroup
  metrics?: EntityMetric[]
  columnWidths?: Record<string, number>
  pinnedColumns?: { left: string[]; right: string[] }
  sort?: { columnId: string; direction: "asc" | "desc" } | null
  card?: CardLayout
  board?: BoardLayout
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
const boardId = /^[^\u0000-\u001f\u007f]{1,100}$/

export function cleanBoard(board?: BoardLayout): BoardLayout | undefined {
  const hidden: string[] = []
  const order: string[] = []
  const seenHidden = new Set<string>()
  const seenOrder = new Set<string>()
  for (const id of board?.hidden ?? []) {
    if (!boardId.test(id) || seenHidden.has(id)) continue
    seenHidden.add(id)
    hidden.push(id)
    if (hidden.length === 40) break
  }
  for (const id of board?.order ?? []) {
    if (!boardId.test(id) || seenOrder.has(id)) continue
    seenOrder.add(id)
    order.push(id)
    if (order.length === 40) break
  }
  const cardOrder = [...new Set(board?.cardOrder ?? [])]
    .filter((id) => boardId.test(id))
    .slice(0, 5000)
  const orderBy: BoardOrderBy =
    board?.orderBy === "name" || board?.orderBy === "count"
      ? board.orderBy
      : "manual"
  if (
    !hidden.length &&
    !order.length &&
    !cardOrder.length &&
    orderBy === "manual"
  )
    return undefined
  return { hidden, order, orderBy, ...(cardOrder.length ? { cardOrder } : {}) }
}

export function arrangeBoardGroups<
  T extends { id: string; label: string; count: number },
>(groups: T[], board?: BoardLayout): T[] {
  const hidden = new Set(board?.hidden ?? [])
  const visible = groups.filter((group) => !hidden.has(group.id))
  if (board?.orderBy === "name") {
    return [...visible].sort((a, b) => a.label.localeCompare(b.label, "ru"))
  }
  if (board?.orderBy === "count") {
    return [...visible].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru")
    )
  }
  const rank = new Map((board?.order ?? []).map((id, index) => [id, index]))
  return [...visible].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  )
}

export function defaultCardLayout(columnIds: string[]): CardLayout {
  const [title, ...rest] = columnIds
  return {
    size: "sm",
    rows: [
      ...(title ? [{ fields: [title], layout: "title" as const }] : []),
      ...rest
        .slice(0, 4)
        .map((id) => ({ fields: [id], layout: "one" as const })),
    ],
  }
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
  const known = new Set(columnIds)
  const rows: CardRow[] = (config.card?.rows ?? [])
    .flatMap((row): CardRow[] => {
      const fields = row.fields.filter((id) => known.has(id))
      if (row.layout === "two") {
        const unique = [...new Set(fields)]
        return unique.length >= 2
          ? [{ layout: "two" as const, fields: unique.slice(0, 2) }]
          : []
      }
      if (!fields.length) return []
      return [
        {
          layout:
            row.layout === "title" ? ("title" as const) : ("one" as const),
          fields: [fields[0]],
        },
      ]
    })
    .slice(0, 12)
  const board = cleanBoard(config.board)
  const card =
    rows.length > 0
      ? {
          size:
            config.card?.size === "xs" || config.card?.size === "md"
              ? config.card.size
              : ("sm" as const),
          rows,
        }
      : undefined
  return {
    ...(normalizeQuery(config.query, [...columnIds, ...filterIds])
      ? { query: normalizeQuery(config.query, [...columnIds, ...filterIds]) }
      : {}),
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
    ...(card ? { card } : {}),
    ...(board ? { board } : {}),
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
      query: value.query ?? null,
      metrics: value.metrics ?? [],
      columnWidths: Object.entries(value.columnWidths ?? {}).sort(([a], [b]) =>
        a.localeCompare(b)
      ),
      pinnedColumns: value.pinnedColumns ?? { left: [], right: [] },
      sort: value.sort ?? null,
      card: value.card ?? null,
      board: value.board
        ? {
            hidden: [...(value.board.hidden ?? [])].sort(),
            order: value.board.order ?? [],
            orderBy: value.board.orderBy ?? "manual",
            cardOrder: value.board.cardOrder ?? [],
          }
        : null,
    })
  return canonical(a) === canonical(b)
}
