import test from "node:test"
import assert from "node:assert/strict"
import {
  createPushDevice,
  pushProblem,
  PushSetupError,
} from "../lib/push-device.ts"

function fixture(t, timeout = 50) {
  const key = new Uint8Array(65).fill(1)
  key[0] = 4
  const publicKey = Buffer.from(key).toString("base64url")
  const calls = []
  let stored = null,
    native,
    permission = "granted"
  const subscription = (applicationServerKey = key.buffer) => ({
    endpoint: "https://fcm.googleapis.com/fcm/send/qa-only",
    options: { applicationServerKey },
    toJSON() {
      return {
        endpoint: this.endpoint,
        keys: { p256dh: "fixture", auth: "fixture" },
      }
    },
    async unsubscribe() {
      calls.push("unsubscribe")
      stored = null
      return true
    },
  })
  const registration = {
    active: {},
    pushManager: {
      async getSubscription() {
        return stored
      },
      subscribe() {
        calls.push("subscribe")
        return native ? native() : Promise.resolve((stored = subscription()))
      },
    },
  }
  const notification = {
    get permission() {
      return permission
    },
    async requestPermission() {
      calls.push("permission")
      return permission
    },
  }
  for (const [name, value] of Object.entries({
    window: {
      isSecureContext: true,
      Notification: notification,
      PushManager: {},
    },
    Notification: notification,
    navigator: {
      onLine: true,
      serviceWorker: {
        async getRegistration() {
          return registration
        },
        async register() {
          calls.push("register")
          return registration
        },
        ready: Promise.resolve(registration),
      },
    },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    })
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    })
  }
  const request = async (method = "GET") => {
    calls.push(method)
    return { publicKey }
  }
  return {
    key,
    publicKey,
    calls,
    registration,
    subscription,
    device: createPushDevice(request, timeout),
    get stored() {
      return stored
    },
    set stored(value) {
      stored = value
    },
    set native(value) {
      native = value
    },
    set permission(value) {
      permission = value
    },
  }
}

test("native Push errors are useful Russian messages without provider internals", () => {
  for (const error of [
    new DOMException("Registration failed - push service error", "AbortError"),
    new Error("provider-secret"),
    null,
  ]) {
    const problem = pushProblem(error)
    assert.equal(problem.code, "browser-service")
    assert.match(problem.message, /[А-Яа-я]/)
    assert.doesNotMatch(problem.message, /Registration failed|provider-secret/)
  }
  for (const [name, code] of [
    ["NotAllowedError", "permission"],
    ["SecurityError", "permission"],
    ["NotSupportedError", "unsupported"],
    ["InvalidStateError", "reconnect"],
    ["NetworkError", "offline"],
    ["TimeoutError", "timeout"],
  ])
    assert.equal(pushProblem({ name }).code, code)
  const known = new PushSetupError("server", "Повторите попытку позже.")
  assert.equal(pushProblem(known), known)
})
test("permission denial and offline mode never create a subscription", async (t) => {
  const f = fixture(t)
  f.permission = "denied"
  await assert.rejects(f.device.enablePush(), (e) => e.code === "permission")
  assert.deepEqual(f.calls, ["permission"])
  f.calls.length = 0
  navigator.onLine = false
  await assert.rejects(f.device.enablePush(), (e) => e.code === "offline")
  assert.deepEqual(f.calls, [])
})
test("concurrent enrollment shares one native subscription and one server write", async (t) => {
  const f = fixture(t),
    first = f.device.enablePush(),
    second = f.device.enablePush()
  assert.equal(first, second)
  await Promise.all([first, second])
  assert.equal(f.calls.filter((x) => x === "subscribe").length, 1)
  assert.equal(f.calls.filter((x) => x === "POST").length, 1)
})
test("failed enrollment never claims a server binding and can be retried", async (t) => {
  const f = fixture(t)
  f.native = () =>
    Promise.reject(
      new DOMException("Registration failed - push service error", "AbortError")
    )
  await assert.rejects(
    f.device.enablePush(),
    (e) => e.code === "browser-service"
  )
  assert.ok(!f.calls.includes("POST"))
  f.native = null
  await f.device.enablePush()
  assert.equal(f.calls.filter((x) => x === "POST").length, 1)
})
test("timed-out native enrollment is reused across retries instead of duplicated", async (t) => {
  const f = fixture(t, 20)
  let resolve
  f.native = () =>
    new Promise((r) => {
      resolve = r
    })
  await assert.rejects(f.device.enablePush(), (e) => e.code === "timeout")
  const retry = f.device.enablePush()
  await new Promise((r) => setTimeout(r, 5))
  resolve((f.stored = f.subscription()))
  await retry
  assert.equal(f.calls.filter((x) => x === "subscribe").length, 1)
  assert.equal(f.calls.filter((x) => x === "POST").length, 1)
})
test("old and missing VAPID keys are replaced before enrollment, never in background sync", async (t) => {
  const f = fixture(t)
  f.stored = f.subscription(null)
  assert.equal(await f.device.syncExistingPush(), false)
  assert.ok(!f.calls.includes("unsubscribe"))
  f.calls.length = 0
  await f.device.enablePush()
  assert.deepEqual(f.calls, [
    "GET",
    "register",
    "unsubscribe",
    "DELETE",
    "subscribe",
    "POST",
  ])
})
test("restoring an enrolled device rebinds without asking permission or subscribing again", async (t) => {
  const f = fixture(t)
  f.stored = f.subscription()
  assert.equal(await f.device.syncExistingPush(), true)
  assert.deepEqual(f.calls, ["GET", "POST"])
})
test("disable unsubscribes locally before server removal; a server failure cannot re-enroll it", async (t) => {
  const f = fixture(t)
  f.stored = f.subscription()
  const device = createPushDevice(async (method) => {
    f.calls.push(method)
    if (method === "DELETE")
      throw new PushSetupError("server", "Сервер недоступен.")
    return { publicKey: f.publicKey }
  })
  await assert.rejects(device.disablePush(), (e) => e.code === "server")
  assert.deepEqual(f.calls, ["unsubscribe", "DELETE"])
  assert.equal(await device.currentPushSubscription(), null)
  assert.equal(await device.syncExistingPush(), false)
})
test("service-worker activation completes before native subscription", async (t) => {
  const f = fixture(t)
  f.registration.active = null
  let activate
  navigator.serviceWorker.ready = new Promise((resolve) => {
    activate = resolve
  })
  const enabled = f.device.enablePush()
  await new Promise((r) => setTimeout(r, 5))
  assert.ok(!f.calls.includes("subscribe"))
  activate(f.registration)
  await enabled
  assert.ok(f.calls.includes("POST"))
})

test("subscription inspection errors cannot leak English into the profile", async (t) => {
  const f = fixture(t)
  f.registration.pushManager.getSubscription = async () => {
    throw Error("Error retrieving push subscription.")
  }
  await assert.rejects(
    f.device.currentPushSubscription(),
    (e) => e.code === "browser-service" && !e.message.includes("retrieving")
  )
  assert.ok(!f.calls.includes("POST"))
})

test("a malformed public key cannot create a browser or server subscription", async (t) => {
  const f = fixture(t)
  const device = createPushDevice(async () => ({ publicKey: "invalid-key" }))
  await assert.rejects(device.enablePush(), (e) => e.code === "server")
  assert.ok(!f.calls.includes("subscribe"))
})

test("an older background connection check cannot rebind a disabled device", async (t) => {
  const f = fixture(t)
  f.stored = f.subscription()
  let config
  const calls = []
  const device = createPushDevice(async (method = "GET") => {
    calls.push(method)
    if (method === "GET")
      return new Promise((resolve) => {
        config = resolve
      })
    return { publicKey: f.publicKey }
  })
  const checking = device.syncExistingPush()
  await new Promise((r) => setTimeout(r, 0))
  await device.disablePush()
  config({ publicKey: f.publicKey })
  assert.equal(await checking, false)
  assert.deepEqual(calls, ["GET", "DELETE"])
  assert.equal(f.stored, null)
})

test("disconnect waits for an already sent bind and removes it last", async (t) => {
  const f = fixture(t)
  f.stored = f.subscription()
  let finishPost
  const calls = []
  const device = createPushDevice(async (method = "GET") => {
    calls.push(method)
    if (method === "POST")
      await new Promise((resolve) => {
        finishPost = resolve
      })
    return { publicKey: f.publicKey }
  })
  const checking = device.syncExistingPush()
  await new Promise((r) => setTimeout(r, 0))
  const stopping = device.disablePush()
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(calls, ["GET", "POST"])
  finishPost()
  assert.equal(await checking, false)
  await stopping
  assert.deepEqual(calls, ["GET", "POST", "DELETE"])
  assert.equal(f.stored, null)
})
