export function mergeCardOrder(
  order: readonly string[],
  ids: readonly string[]
) {
  const known = new Set(ids)
  const seen = new Set<string>()
  return [...order, ...ids].filter(
    (id) => known.has(id) && !seen.has(id) && !!seen.add(id)
  )
}

export function placeKanbanCard(
  order: readonly string[],
  id: string,
  group: string,
  index: number,
  groupOf: (id: string) => string
) {
  const next = order.filter((candidate) => candidate !== id)
  const members = next.filter((candidate) => groupOf(candidate) === group)
  const slot = Math.max(0, Math.min(index, members.length))
  const anchor = members[slot]
  const last = members.at(-1)
  next.splice(
    anchor ? next.indexOf(anchor) : last ? next.indexOf(last) + 1 : next.length,
    0,
    id
  )
  return next
}

/** Keep the relative positions of cards hidden by a filter or collapsed column. */
export function mergeVisibleCardOrder(
  previous: readonly string[],
  visible: readonly string[]
) {
  const ordered = [...new Set(visible)]
  const shown = new Set(ordered)
  let index = 0
  const next = [...new Set(previous)].map((id) =>
    shown.has(id) ? ordered[index++] : id
  )
  return [...next, ...ordered.slice(index)]
}

export function restoreKanbanCard(
  order: readonly string[],
  id: string,
  previous: readonly string[]
) {
  const next = order.filter((candidate) => candidate !== id)
  const index = previous.indexOf(id)
  const following = previous
    .slice(index + 1)
    .find((candidate) => next.includes(candidate))
  const preceding = previous
    .slice(0, index)
    .findLast((candidate) => next.includes(candidate))
  next.splice(
    following
      ? next.indexOf(following)
      : preceding
        ? next.indexOf(preceding) + 1
        : 0,
    0,
    id
  )
  return next
}

export function kanbanScrollSpeed(point: number, start: number, end: number) {
  const edge = Math.min(56, (end - start) / 4)
  if (point < start || point > end) return 0
  if (point < start + edge) return -Math.ceil(14 * (1 - (point - start) / edge))
  if (point > end - edge) return Math.ceil(14 * (1 - (end - point) / edge))
  return 0
}
