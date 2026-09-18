import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { appHome } from "../lib/app-entry.ts"
import {
  notificationStorageKey,
  parseNotificationPreferences,
  requestNotices,
  RequestNoticeTracker,
} from "../lib/device-notifications.ts"
import manifest from "../app/manifest.ts"

test("PWA starts in the CRM; only drivers land on the driver screen", () => {
  assert.equal(appHome("driver"), "/driver")
  for (const role of ["owner", "admin", "dispatcher", "developer", ""])
    assert.equal(appHome(role), "/")
  const data = manifest()
  assert.equal(data.start_url, "/")
  // Preserve identity so an existing installed app receives this update.
  assert.equal(data.id, "/driver")
  assert.deepEqual(
    data.icons.map((icon) => icon.sizes),
    ["192x192", "512x512"]
  )
  assert.ok(!data.description.includes("водитель"))
})

test("device notification preferences default off and are isolated by company/membership", () => {
  for (const value of [
    null,
    "bad",
    "{}",
    "null",
    '{"newRequests":"true"}',
    "[]",
  ])
    assert.deepEqual(parseNotificationPreferences(value), {
      newRequests: false,
    })
  assert.deepEqual(parseNotificationPreferences('{"newRequests":true}'), {
    newRequests: true,
  })
  const keys = new Set([
    notificationStorageKey("company-a", "user-a"),
    notificationStorageKey("company-b", "user-a"),
    notificationStorageKey("company-a", "user-b"),
    notificationStorageKey("company:a", "user:b"),
  ])
  assert.equal(keys.size, 4)
})

const notice = (id) => ({
  id,
  passengerName: "Анна",
  origin: "Киев",
  destination: "Варшава",
})
test("notification polling does not replay existing requests or transiently disappearing IDs", () => {
  const tracker = new RequestNoticeTracker()
  assert.deepEqual(tracker.update([notice("existing")]), [])
  assert.deepEqual(tracker.update([notice("new"), notice("existing")]), [
    notice("new"),
  ])
  assert.deepEqual(tracker.update([]), [])
  assert.deepEqual(tracker.update([notice("new")]), [])
  assert.deepEqual(new RequestNoticeTracker().update([notice("new")]), [])
  assert.equal(requestNotices({ items: [{ id: "invalid" }] }), null)
  assert.deepEqual(requestNotices({ items: [notice("valid")] }), [
    notice("valid"),
  ])
})

test("notification clicks remain same-origin and offline recovery goes to the universal home", async () => {
  const handlers = {}
  const opened = []
  runInNewContext(
    readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
    {
      URL,
      self: {
        location: { origin: "https://vivat.example" },
        addEventListener: (event, handler) => {
          handlers[event] = handler
        },
        clients: {
          matchAll: async () => [],
          openWindow: async (url) => {
            opened.push(url)
          },
        },
      },
    }
  )
  for (const url of ["https://evil.example", "/requests", "/driver"]) {
    let work
    handlers.notificationclick({
      notification: { close() {}, data: { url } },
      waitUntil: (promise) => {
        work = promise
      },
    })
    await work
  }
  assert.deepEqual(opened, [
    "https://vivat.example/profile",
    "https://vivat.example/requests",
    "https://vivat.example/driver",
  ])
  assert.match(
    readFileSync(new URL("../public/offline.html", import.meta.url), "utf8"),
    /href="\/"/
  )
})
