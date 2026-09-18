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
  const response = await sessionFetch("/api/notifications?resource=push", {
    method,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  if (!response.ok)
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "Не удалось настроить push."
    )
  return payload
}
export async function currentPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null
  const registration = await navigator.serviceWorker.getRegistration("/")
  return registration?.pushManager.getSubscription() ?? null
}
export function matchesPushKey(
  subscription: PushSubscription,
  publicKey: string
) {
  try {
    if (!subscription.options.applicationServerKey) return false
    const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"))
    return equalKeys(
      new Uint8Array(subscription.options.applicationServerKey),
      Uint8Array.from(raw, (letter) => letter.charCodeAt(0))
    )
  } catch {
    return false
  }
}
export async function syncExistingPush(publicKey?: string) {
  if (!("Notification" in window) || Notification.permission !== "granted")
    return false
  const subscription = await currentPushSubscription()
  if (!subscription) return false
  const key = publicKey ?? (await pushRequest()).publicKey
  if (typeof key !== "string" || !matchesPushKey(subscription, key))
    return false
  await pushRequest("POST", { subscription: subscription.toJSON() })
  return true
}
export async function enablePush() {
  const permission = await Notification.requestPermission()
  if (permission !== "granted")
    throw new Error("Разрешите уведомления в настройках браузера или телефона.")
  const config = await pushRequest()
  if (typeof config?.publicKey !== "string")
    throw new Error("Push временно недоступен.")
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  })
  if (!registration.active)
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error("Приложение ещё обновляется. Повторите попытку.")),
          10_000
        )
      ),
    ])
  const decoded = atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/"))
  const key = Uint8Array.from(decoded, (letter) => letter.charCodeAt(0))
  let subscription = await registration.pushManager.getSubscription()
  if (
    subscription?.options.applicationServerKey &&
    !equalKeys(new Uint8Array(subscription.options.applicationServerKey), key)
  ) {
    await pushRequest("DELETE", { endpoint: subscription.endpoint })
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  })
  await pushRequest("POST", { subscription: subscription.toJSON() })
  return subscription
}
function equalKeys(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}
export async function disablePush() {
  const subscription = await currentPushSubscription()
  if (!subscription) return
  await pushRequest("DELETE", { endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}
