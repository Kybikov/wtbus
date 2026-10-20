import { createPushDevice, PushSetupError } from "@/lib/push-device"
import { sessionFetch } from "@/lib/session-navigation"

export type PushPreferences = {
  newRequests: boolean
  newBookings: boolean
  payments: boolean
  trips: boolean
}
export const defaultPushPreferences: PushPreferences = {
  newRequests: true,
  newBookings: true,
  payments: true,
  trips: true,
}
export async function pushRequest(method = "GET", body?: unknown) {
  let response: Response
  try {
    response = await sessionFetch("/api/notifications?resource=push", {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new PushSetupError(
      "server",
      "Не удалось связаться с сервером. Проверьте интернет и повторите попытку."
    )
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload)
    throw new PushSetupError(
      "server",
      typeof payload?.error === "string" && /[А-Яа-яЁё]/.test(payload.error)
        ? payload.error
        : "Не удалось настроить Push. Повторите попытку позже."
    )

  return payload
}
const device = createPushDevice(pushRequest)
export const {
  currentPushSubscription,
  syncExistingPush,
  enablePush,
  disablePush,
} = device
export { matchesPushKey } from "@/lib/push-device"
