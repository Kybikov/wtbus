import assert from "node:assert/strict"
import { test } from "node:test"
import { isPublicBookingPath, travelDay, departureMinute } from "../lib/public-booking.ts"

test("public access is confined to passenger booking routes", () => {
  for (const path of ["/book", "/book/", "/book/vivat-bus", "/book/another-tenant/"]) assert.equal(isPublicBookingPath(path), true)
  for (const path of ["/", "/bookings", "/book/vivat-bus/team", "/book/../team", "/book//team", "/profile", "/team"]) assert.equal(isPublicBookingPath(path), false)
})
test("travel dates and departure filters follow the carrier timezone", () => {
  assert.equal(travelDay(new Date("2026-09-18T23:30:00Z"), "Europe/Warsaw"), "2026-09-19")
  assert.equal(departureMinute({ startsAt: "2026-09-18T23:30:00Z" }, "Europe/Warsaw"), 90)
})
