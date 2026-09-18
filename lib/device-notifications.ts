export type NotificationPreferences = { newRequests: boolean }
export const defaultNotificationPreferences: NotificationPreferences = {
  newRequests: false,
}
export const notificationPreferencesEvent = "vivat-notification-preferences"
export function notificationStorageKey(tenant: string, membership: string) {
  return `vivat-notifications:${encodeURIComponent(tenant)}:${encodeURIComponent(membership)}`
}
export function parseNotificationPreferences(
  value: string | null
): NotificationPreferences {
  try {
    const parsed: unknown = JSON.parse(value ?? "null")
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "newRequests" in parsed &&
      typeof parsed.newRequests === "boolean"
    )
      return { newRequests: parsed.newRequests }
  } catch {
    /* Invalid or obsolete storage is opt-out, not opt-in. */
  }
  return { ...defaultNotificationPreferences }
}

export type RequestNotice = {
  id: string
  passengerName: string
  origin: string
  destination: string
}
export function requestNotices(payload: unknown): RequestNotice[] | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("items" in payload) ||
    !Array.isArray(payload.items)
  )
    return null
  if (
    !payload.items.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        typeof item.passengerName === "string" &&
        typeof item.origin === "string" &&
        typeof item.destination === "string"
    )
  )
    return null
  return payload.items
}
export class RequestNoticeTracker {
  private seen = new Set<string>()
  private initialized = false
  update(items: RequestNotice[]) {
    const fresh = this.initialized
      ? items.filter((item) => !this.seen.has(item.id))
      : []
    items.forEach((item) => this.seen.add(item.id))
    // Retain IDs between polls so disappearing/reappearing requests do not repeat.
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000))
    this.initialized = true
    return fresh
  }
}
