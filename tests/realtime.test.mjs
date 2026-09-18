import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { parseRealtimeMessage } from "../lib/realtime.ts"

test("realtime validates messages and exposes invalidations only", () => {
  assert.deepEqual(parseRealtimeMessage('{"type":"ready"}'), { type: "ready" })
  assert.deepEqual(parseRealtimeMessage('{"type":"invalidate","id":"12","entity":"bookings","private":"not forwarded"}'), { type: "invalidate", id: "12", entity: "bookings" })
  for (const raw of ["bad", "null", "[]", '{"type":"invalidate","id":12,"entity":"trips"}', '{"type":"invalidate","id":"-1","entity":"trips"}', '{"type":"invalidate","id":"1","entity":"../secret"}'])
    assert.equal(parseRealtimeMessage(raw), null)
})
test("service worker handles background push with stable tags and safe navigation", async () => {
  const handlers = {}
  const displayed = []
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL, self: { location: { origin: "https://vivat.example" },
      addEventListener: (type, handler) => { handlers[type] = handler },
      registration: { showNotification: async (title, options) => { displayed.push({ title, options }) } },
    },
  })
  for (const url of ["/bookings", "https://evil.example", "//evil.example"]) {
    let work
    handlers.push({ data: { json: () => ({ title: "Оплата", body: "Подтверждена", tag: "vivat:event-1", url }) }, waitUntil: (promise) => { work = promise } })
    await work
  }
  assert.equal(displayed.length, 3)
  assert.equal(displayed[0].options.data.url, "/bookings")
  assert.equal(displayed[1].options.data.url, "/profile")
  assert.equal(displayed[2].options.data.url, "/profile")
  assert.ok(displayed.every((entry) => entry.options.tag === "vivat:event-1"))
  handlers.push({ data: { json: () => { throw new Error("bad") } }, waitUntil: () => assert.fail("malformed payload displayed") })
  handlers.push({ data: { json: () => ({ title: 123 }) }, waitUntil: () => assert.fail("malformed payload displayed") })
})
