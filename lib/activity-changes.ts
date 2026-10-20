export type ActivityValue = string | number | boolean | null
export type ActivityChange = {
  field: string
  before: ActivityValue
  after: ActivityValue
  beforeLabel?: string
  afterLabel?: string
  beforeTone?: "success" | "warning" | "danger" | "info" | "neutral" | "violet"
  afterTone?: ActivityChange["beforeTone"]
  beforeCurrency?: string
  afterCurrency?: string
}
export type ActivityEvent = {
  id?: string
  actorId?: string
  action: string
  actor: string
  kind: string
  changedFields?: string[]
  changes?: ActivityChange[]
  createdAt: string
}

// Group identical recorded transitions for the same actor and calendar minute.
// An A→B transition must never swallow a B→A transition or another actor's work.
export function groupActivityEvents<T extends ActivityEvent>(
  events: T[]
): (T & { count: number })[] {
  const groups = new Map<string, T & { count: number }>()
  for (const event of events) {
    const timestamp = Date.parse(event.createdAt)
    const key = JSON.stringify([
      Number.isFinite(timestamp)
        ? Math.floor(timestamp / 60_000)
        : event.createdAt,
      event.actorId ?? event.actor,
      event.kind,
      event.action,
      [...(event.changedFields ?? [])].sort(),
      [...(event.changes ?? [])].sort((a, b) => a.field.localeCompare(b.field)),
    ])
    const existing = groups.get(key)
    if (existing) existing.count++
    else groups.set(key, { ...event, count: 1 })
  }
  return [...groups.values()]
}
