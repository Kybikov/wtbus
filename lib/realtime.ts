export const realtimeEvent = "vivat-realtime"
export type RealtimeMessage = {
  type: "ready" | "invalidate"
  id?: string
  entity?: string
}
export function parseRealtimeMessage(raw: string): RealtimeMessage | null {
  try {
    const value = JSON.parse(raw)
    if (value?.type === "ready") return { type: "ready" }
    if (
      value?.type === "invalidate" &&
      typeof value.id === "string" &&
      /^\d+$/.test(value.id) &&
      typeof value.entity === "string" &&
      /^[a-z_]{1,64}$/.test(value.entity)
    )
      return { type: "invalidate", id: value.id, entity: value.entity }
  } catch {
    /* Ignore malformed messages. */
  }
  return null
}
