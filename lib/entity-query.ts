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

// A column condition narrows the whole expression, including an existing OR.
// Refuse overflow instead of letting normalization discard existing conditions.
export function appendQueryRule(
  group: FilterGroup | undefined,
  rule: FilterRule
): FilterGroup | undefined {
  const next: FilterGroup = !group?.rules.length
    ? { id: `group-${rule.id}`, combinator: "and", rules: [rule] }
    : group.combinator === "and"
      ? { ...group, rules: [...group.rules, rule] }
      : { id: `group-${rule.id}`, combinator: "and", rules: [group, rule] }
  let nodes = 0
  const fits = (current: FilterGroup, depth: number): boolean =>
    depth <= 3 &&
    current.rules.every(
      (node) => ++nodes <= 40 && (!("rules" in node) || fits(node, depth + 1))
    )
  return fits(next, 0) ? next : undefined
}

export function hasColumnCondition(
  group: FilterGroup | undefined,
  field: string
): boolean {
  return (
    group?.rules.some((node) =>
      "rules" in node ? hasColumnCondition(node, field) : node.field === field
    ) ?? false
  )
}

export function removeColumnConditions(
  group: FilterGroup | undefined,
  field: string
): FilterGroup | undefined {
  if (!group) return undefined
  const rules = group.rules.flatMap<FilterRule | FilterGroup>((node) => {
    if (!("rules" in node)) return node.field === field ? [] : [node]
    const nested = removeColumnConditions(node, field)
    return nested ? [nested] : []
  })
  return rules.length ? { ...group, rules } : undefined
}

export function queryWithLegacyFilters(
  values: Record<string, string>,
  query?: FilterGroup
): FilterGroup {
  const legacy: FilterRule[] = Object.entries(values)
    .filter(([, value]) => value)
    .map(([field, value]) => ({
      id: `legacy-${field}`,
      field,
      operator: "eq",
      value: [value],
    }))
  return legacy.length
    ? {
        id: "legacy-root",
        combinator: "and",
        rules: [...legacy, ...(query ? [query] : [])],
      }
    : (query ?? { id: "root", combinator: "and", rules: [] })
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
