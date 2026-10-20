export type FilterOperator =
  | "eq"
  | "neq"
  | "in"
  | "notIn"
  | "contains"
  | "notContains"
  | "empty"
  | "notEmpty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after"
export type FilterRule = {
  id: string
  field: string
  operator: FilterOperator
  value: string[]
}
export type FilterGroup = {
  id: string
  combinator: "and" | "or"
  rules: (FilterGroup | FilterRule)[]
}
export type QueryField<T = unknown> = {
  id: string
  label: string
  kind: "text" | "number" | "date" | "select"
  options?: { value: string; label: string }[]
  read?: (item: T) => unknown
  matches?: (item: T, value: string) => boolean
}
export type QueryFieldChoice = Omit<QueryField, "read" | "matches">
export const operatorLabels: Record<FilterOperator, string> = {
  eq: "Равно",
  neq: "Не равно",
  in: "Любое из",
  notIn: "Ни одно из",
  contains: "Содержит",
  notContains: "Не содержит",
  empty: "Не заполнено",
  notEmpty: "Заполнено",
  gt: "Больше",
  gte: "Не меньше",
  lt: "Меньше",
  lte: "Не больше",
  before: "До",
  after: "После",
}
export function fieldOperators(kind: QueryField["kind"]): FilterOperator[] {
  return [
    ...(kind === "select"
      ? (["in", "notIn"] as const)
      : kind === "number"
        ? (["eq", "neq", "gt", "gte", "lt", "lte"] as const)
        : kind === "date"
          ? (["eq", "neq", "before", "after"] as const)
          : (["contains", "notContains", "eq", "neq"] as const)),
    "empty",
    "notEmpty",
  ]
}
export function countQuery(group?: FilterGroup): number {
  return (
    group?.rules.reduce(
      (sum, node) => sum + ("rules" in node ? countQuery(node) : 1),
      0
    ) ?? 0
  )
}
export function normalizeQuery(
  group: FilterGroup | undefined,
  known: string[]
): FilterGroup | undefined {
  let count = 0
  const clean = (
    input: FilterGroup,
    depth: number
  ): FilterGroup | undefined => {
    if (
      !input ||
      depth > 3 ||
      !Array.isArray(input.rules) ||
      !["and", "or"].includes(input.combinator)
    )
      return undefined
    const rules: (FilterGroup | FilterRule)[] = []
    for (const node of input.rules) {
      if (++count > 40) break
      if (node && "rules" in node) {
        const nested = clean(node, depth + 1)
        if (nested?.rules.length) rules.push(nested)
      } else if (
        node &&
        known.includes(node.field) &&
        Object.hasOwn(operatorLabels, node.operator) &&
        Array.isArray(node.value) &&
        node.value.length <= 50 &&
        node.value.every((v) => typeof v === "string" && v.length <= 500)
      )
        rules.push({ ...node, value: [...node.value] })
    }
    return {
      id: String(input.id).slice(0, 100),
      combinator: input.combinator,
      rules,
    }
  }
  const result = group ? clean(group, 0) : undefined
  return result?.rules.length ? result : undefined
}
const present = (value: unknown) =>
  value != null &&
  (typeof value !== "string" || value.trim() !== "") &&
  (!Array.isArray(value) || value.some(present))
export function matchesQuery<T>(
  item: T,
  group: FilterGroup | undefined,
  fields: QueryField<T>[]
): boolean {
  if (!group || !group.rules.length) return true
  const test = (node: FilterGroup | FilterRule): boolean => {
    if ("rules" in node)
      return node.combinator === "or"
        ? node.rules.some(test)
        : node.rules.every(test)
    const field = fields.find((f) => f.id === node.field)
    if (!field) return false
    const raw = field.read?.(item)
    const [value = ""] = node.value
    if (node.operator === "empty" || node.operator === "notEmpty")
      return node.operator === "empty" ? !present(raw) : present(raw)
    if (!node.value.length || value === "") return true // An unfinished draft never hides records.
    const values = Array.isArray(raw) ? raw : [raw]
    const text = (v: unknown) =>
      String(v ?? "")
        .toLocaleLowerCase("ru")
        .trim()
    const equal = (wanted: string) =>
      field.matches
        ? field.matches(item, wanted)
        : values.some((v) =>
            field.kind === "date"
              ? (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(
                  0,
                  10
                ) === wanted
              : field.kind === "number"
                ? present(v) && Number(v) === Number(wanted)
                : text(v) === text(wanted)
          )
    switch (node.operator) {
      case "eq":
      case "in":
        return node.value.some(equal)
      case "neq":
      case "notIn":
        return !node.value.some(equal)
      case "contains":
        return values.some((v) => text(v).includes(text(value)))
      case "notContains":
        return !values.some((v) => text(v).includes(text(value)))
      default:
        return values.some((v) => {
          if (!present(v)) return false
          const left =
            field.kind === "date"
              ? Date.parse(
                  (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10)
                )
              : Number(v)
          const right =
            field.kind === "date" ? Date.parse(value) : Number(value)
          if (!Number.isFinite(left) || !Number.isFinite(right)) return false
          switch (node.operator) {
            case "gt":
            case "after":
              return left > right
            case "gte":
              return left >= right
            case "lt":
            case "before":
              return left < right
            case "lte":
              return left <= right
            default:
              return false
          }
        })
    }
  }
  return test(group)
}
