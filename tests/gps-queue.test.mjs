import test from "node:test"
import assert from "node:assert/strict"
import { GPSQueue, GPSDeliveryError, GPS_MAX_AGE_MS } from "../lib/gps-queue.ts"

function point(id, scope = "tenant:driver") {
  return {
    clientPointId: id,
    scope,
    membershipId: "driver",
    vehicleId: "bus",
    tripId: "trip",
    latitude: 50,
    longitude: 30,
    accuracyMeters: 10,
    recordedAt: new Date().toISOString(),
  }
}
function storage(initial = []) {
  const rows = new Map(initial.map((p) => [p.clientPointId, p]))
  return {
    rows,
    list: async (scope) => [...rows.values()].filter((p) => p.scope === scope),
    add: async (p) => rows.set(p.clientPointId, p),
    remove: async (id) => rows.delete(id),
  }
}
test("acknowledgement removes only the delivered ID, preserving captures during upload", async () => {
  const store = storage([point("first")])
  const queue = new GPSQueue(store, "tenant:driver", async (payload) => {
    assert.equal("scope" in payload, false)
    await store.add(point("captured-during-upload"))
  })
  await queue.flush()
  assert.deepEqual([...store.rows.keys()], ["captured-during-upload"])
})
test("concurrent flushes share one delivery", async () => {
  const store = storage([point("first")])
  let release
  let calls = 0
  const queue = new GPSQueue(store, "tenant:driver", () => {
    calls++
    return new Promise((resolve) => {
      release = resolve
    })
  })
  const a = queue.flush(),
    b = queue.flush()
  await Promise.resolve()
  assert.equal(calls, 1)
  release()
  await Promise.all([a, b])
  assert.equal(store.rows.size, 0)
})
for (const status of [429, 500, 502, 503]) {
  test(`HTTP ${status} retains the point and retries with the same ID after backoff`, async () => {
    const store = storage([point("stable-id")])
    let now = Date.now(),
      failing = true,
      calls = 0
    const queue = new GPSQueue(
      store,
      "tenant:driver",
      async (p) => {
        calls++
        assert.equal(p.clientPointId, "stable-id")
        if (failing) throw new GPSDeliveryError(status, "temporary")
      },
      () => now
    )
    await assert.rejects(queue.flush())
    assert.equal(store.rows.size, 1)
    failing = false
    await queue.flush()
    assert.equal(calls, 1)
    now += 2000
    await queue.flush()
    assert.equal(calls, 2)
    assert.equal(store.rows.size, 0)
  })
}
test("offline/network errors preserve all undelivered points", async () => {
  const store = storage([point("a"), point("b")])
  const queue = new GPSQueue(store, "tenant:driver", async () => {
    throw new TypeError("Failed to fetch")
  })
  await assert.rejects(queue.flush())
  assert.equal(store.rows.size, 2)
})
for (const status of [401, 403]) {
  test(`HTTP ${status} never deletes data or sends points from another membership`, async () => {
    const store = storage([
      point("mine"),
      point("other", "tenant:other-driver"),
    ])
    const queue = new GPSQueue(store, "tenant:driver", async (p) => {
      assert.equal(p.clientPointId, "mine")
      throw new GPSDeliveryError(status, "unauthorized")
    })
    await assert.rejects(queue.flush())
    assert.equal(store.rows.size, 2)
  })
}
test("permanently rejected old trip does not block the current trip", async () => {
  const store = storage([point("closed"), point("current")])
  const rejected = []
  const queue = new GPSQueue(store, "tenant:driver", async (p) => {
    if (p.clientPointId === "closed")
      throw new GPSDeliveryError(400, "trip closed")
  })
  await queue.flush((p) => rejected.push(p.clientPointId))
  assert.deepEqual(rejected, ["closed"])
  assert.equal(store.rows.size, 0)
})
test("lost acknowledgement keeps the stable ID on a new queue after reload", async () => {
  const store = storage([point("idempotent")])
  const serverIDs = new Set()
  const first = new GPSQueue(store, "tenant:driver", async (p) => {
    serverIDs.add(p.clientPointId)
    throw new TypeError("response lost")
  })
  await assert.rejects(first.flush())
  const reloaded = new GPSQueue(store, "tenant:driver", async (p) => {
    serverIDs.add(p.clientPointId)
  })
  await reloaded.flush()
  assert.equal(serverIDs.size, 1)
  assert.equal(store.rows.size, 0)
})
test("expired points are reported and never transmitted", async () => {
  const old = point("old")
  old.recordedAt = new Date(Date.now() - GPS_MAX_AGE_MS - 1000).toISOString()
  const store = storage([old])
  let rejected = 0
  const queue = new GPSQueue(store, "tenant:driver", async () =>
    assert.fail("expired point sent")
  )
  await queue.flush(() => rejected++)
  assert.equal(rejected, 1)
  assert.equal(store.rows.size, 0)
})
test("storage deletion failure preserves a point for an idempotent retry", async () => {
  const store = storage([point("a")])
  store.remove = async () => {
    throw new Error("disk failure")
  }
  const queue = new GPSQueue(store, "tenant:driver", async () => {})
  await assert.rejects(queue.flush())
  assert.equal(store.rows.size, 1)
})
