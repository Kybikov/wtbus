export type PushProblemCode =
  | "permission"
  | "unsupported"
  | "offline"
  | "browser-service"
  | "timeout"
  | "server"
  | "reconnect"
  | "busy"

export class PushSetupError extends Error {
  readonly code: PushProblemCode
  constructor(code: PushProblemCode, message: string) {
    super(message)
    this.name = "PushSetupError"
    this.code = code
  }
}

export function pushProblem(error: unknown): PushSetupError {
  if (error instanceof PushSetupError) return error
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? error.name
      : ""
  if (name === "NotAllowedError" || name === "SecurityError")
    return new PushSetupError(
      "permission",
      "Разрешите уведомления для этого сайта в настройках браузера."
    )
  if (name === "NotSupportedError")
    return new PushSetupError(
      "unsupported",
      "Этот браузер не поддерживает Push. На iPhone откройте приложение с экрана «Домой»."
    )
  if (name === "InvalidStateError")
    return new PushSetupError(
      "reconnect",
      "Не удалось восстановить подключение Push. Обновите страницу и подключите уведомления снова."
    )
  if (name === "TimeoutError")
    return new PushSetupError(
      "timeout",
      "Служба Push не ответила вовремя. Проверьте подключение к интернету и повторите попытку."
    )
  if (name === "TypeError" || name === "NetworkError")
    return new PushSetupError(
      "offline",
      "Не удалось подключиться. Проверьте интернет и повторите попытку."
    )
  // Browser/provider exception text is often English, and may include internal details.
  return new PushSetupError(
    "browser-service",
    "Браузер не смог подключиться к службе Push. Проверьте настройки уведомлений и подключение к интернету, затем повторите попытку."
  )
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "Notification" in window &&
    "PushManager" in window &&
    "serviceWorker" in navigator
  )
}

function keyBytes(publicKey: string) {
  try {
    const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"))
    const key = Uint8Array.from(raw, (letter) => letter.charCodeAt(0))
    if (key.length !== 65 || key[0] !== 4) throw Error()
    return key
  } catch {
    throw new PushSetupError(
      "server",
      "Не удалось получить параметры Push. Обновите страницу и повторите попытку."
    )
  }
}

export function matchesPushKey(
  subscription: PushSubscription,
  publicKey: string
) {
  try {
    if (!subscription.options.applicationServerKey) return false
    const actual = new Uint8Array(subscription.options.applicationServerKey),
      expected = keyBytes(publicKey)
    return (
      actual.length === expected.length &&
      actual.every((byte, index) => byte === expected[index])
    )
  } catch {
    return false
  }
}

async function bounded<T>(work: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new PushSetupError(
                "timeout",
                "Служба Push не ответила вовремя. Проверьте интернет и повторите попытку."
              )
            ),
          ms
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

type Request = (
  method?: string,
  body?: unknown
) => Promise<{ publicKey?: unknown }>

/** Native subscriptions cannot be aborted: retain a pending enrollment across retries. */
export function createPushDevice(request: Request, timeoutMs = 20_000) {
  let enabling: Promise<PushSubscription> | null = null
  let pendingNative: Promise<PushSubscription> | null = null
  let generation = 0
  let stopping = false
  let bindingWrites = Promise.resolve()
  function updateBinding(method: string, body: unknown, version: number) {
    const work = bindingWrites.then(async () => {
      if (version !== generation) return false
      await request(method, body)
      return version === generation
    })
    // A failed bind must not prevent a later explicit disconnect or retry.
    bindingWrites = work.then(
      () => {},
      () => {}
    )
    return work
  }

  async function currentPushSubscription() {
    if (!pushSupported()) return null
    try {
      const registration = await bounded(
        navigator.serviceWorker.getRegistration("/"),
        timeoutMs
      )
      return registration
        ? await bounded(registration.pushManager.getSubscription(), timeoutMs)
        : null
    } catch (error) {
      throw pushProblem(error)
    }
  }
  async function syncExistingPush(publicKey?: string) {
    if (
      stopping ||
      enabling ||
      !pushSupported() ||
      Notification.permission !== "granted"
    )
      return false
    const version = generation
    const subscription = await currentPushSubscription()
    if (!subscription) return false
    const key = publicKey ?? (await request()).publicKey
    if (typeof key !== "string" || !matchesPushKey(subscription, key))
      return false
    return updateBinding(
      "POST",
      { subscription: subscription.toJSON() },
      version
    )
  }
  async function enroll(version: number) {
    if (!pushSupported())
      throw new PushSetupError(
        "unsupported",
        "Push недоступен в этом браузере. На iPhone добавьте сайт на экран «Домой» и откройте его оттуда."
      )
    if (!navigator.onLine)
      throw new PushSetupError(
        "offline",
        "Нет подключения к интернету. Подключитесь к сети и повторите попытку."
      )
    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await bounded(Notification.requestPermission(), timeoutMs)
    if (permission !== "granted")
      throw new PushSetupError(
        "permission",
        "Разрешите уведомления для этого сайта в настройках браузера."
      )
    const config = await request()
    if (typeof config.publicKey !== "string")
      throw new PushSetupError(
        "server",
        "Push временно недоступен. Повторите попытку позже."
      )
    const key = keyBytes(config.publicKey)
    let registration = await bounded(
      navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }),
      timeoutMs
    )
    if (!registration.active)
      registration = await bounded(navigator.serviceWorker.ready, timeoutMs)
    let subscription = await bounded(
      registration.pushManager.getSubscription(),
      timeoutMs
    )
    if (subscription && !matchesPushKey(subscription, config.publicKey)) {
      const old = subscription
      if (!(await bounded(old.unsubscribe(), timeoutMs)))
        throw new PushSetupError(
          "reconnect",
          "Не удалось обновить подключение Push. Перезапустите браузер и повторите попытку."
        )
      await updateBinding("DELETE", { endpoint: old.endpoint }, version)
      subscription = null
    }
    if (!subscription) {
      if (!pendingNative) {
        const native = registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        })
        pendingNative = native
        void native.then(
          () => {
            if (pendingNative === native) pendingNative = null
          },
          () => {
            if (pendingNative === native) pendingNative = null
          }
        )
      }
      subscription = await bounded(pendingNative, timeoutMs)
    }
    if (!matchesPushKey(subscription, config.publicKey))
      throw new PushSetupError(
        "reconnect",
        "Параметры Push обновились. Подключите уведомления снова."
      )
    if (
      !(await updateBinding(
        "POST",
        { subscription: subscription.toJSON() },
        version
      ))
    )
      throw new PushSetupError(
        "busy",
        "Подключение Push изменилось. Повторите попытку."
      )
    return subscription
  }
  function enablePush() {
    if (enabling) return enabling
    if (stopping)
      return Promise.reject(
        new PushSetupError(
          "busy",
          "Дождитесь отключения Push и повторите попытку."
        )
      )
    const work = enroll(++generation).catch((error: unknown) => {
      throw pushProblem(error)
    })
    enabling = work
    void work.then(
      () => {
        if (enabling === work) enabling = null
      },
      () => {
        if (enabling === work) enabling = null
      }
    )
    return work
  }
  async function disablePush() {
    if (stopping || enabling || pendingNative)
      throw new PushSetupError(
        "busy",
        "Подключение Push ещё выполняется. Дождитесь завершения и повторите попытку."
      )
    stopping = true
    const version = ++generation
    try {
      const subscription = await currentPushSubscription()
      if (!subscription) return
      if (!(await bounded(subscription.unsubscribe(), timeoutMs)))
        throw new PushSetupError(
          "reconnect",
          "Не удалось отключить Push. Повторите попытку."
        )
      await updateBinding(
        "DELETE",
        { endpoint: subscription.endpoint },
        version
      )
    } catch (error) {
      throw pushProblem(error)
    } finally {
      stopping = false
    }
  }
  return { currentPushSubscription, syncExistingPush, enablePush, disablePush }
}

export const pushStateChanged = "vivat-push-state-changed"
