import test from "node:test"
import assert from "node:assert/strict"
import { retargetTripDate } from "../lib/trip-recurrence.ts"

test("changing departure carries default weekly and monthly recurrence with it", () => {
  const form = {
    startsAt: "2026-11-01T09:00",
    weekdays: [0],
    monthDay: 1,
    price: "50",
  }
  const next = retargetTripDate(form, "2026-11-04T14:00")
  assert.deepEqual(next.weekdays, [3])
  assert.equal(next.monthDay, 4)
  assert.equal(next.price, "50")
  assert.deepEqual(form.weekdays, [0])
})
test("explicit recurrence days survive moving the first departure", () => {
  const next = retargetTripDate(
    { startsAt: "2026-11-01T09:00", weekdays: [1, 5], monthDay: -1 },
    "2026-11-04T09:00"
  )
  assert.deepEqual(next.weekdays, [1, 5])
  assert.equal(next.monthDay, -1)
})
test("changing time or clearing a date does not reset recurrence", () => {
  const form = { startsAt: "2026-11-01T09:00", weekdays: [0], monthDay: 1 }
  assert.deepEqual(retargetTripDate(form, "2026-11-01T14:00").weekdays, [0])
  assert.deepEqual(retargetTripDate(form, "").weekdays, [0])
})
