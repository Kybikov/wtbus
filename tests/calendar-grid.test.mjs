import test from "node:test"
import assert from "node:assert/strict"
import {
  calendarDayKey,
  parseCalendarDay,
  calendarMonthDays,
} from "../lib/calendar-grid.ts"

test("calendar uses complete Monday-to-Sunday weeks without an unnecessary extra row", () => {
  const days = calendarMonthDays(new Date(2027, 1, 1))
  assert.equal(days.length, 28)
  assert.equal(days[0].getDay(), 1)
  assert.equal(days.at(-1).getDay(), 0)
  const november = calendarMonthDays(new Date(2026, 10, 2))
  assert.equal(november.length, 42)
  assert.equal(calendarDayKey(november[0]), "2026-10-26")
  assert.equal(november.filter((date) => date.getMonth() === 10).length, 30)
  assert.ok(november.some((date) => calendarDayKey(date) === "2026-11-02"))
})
test("calendar rejects invalid dates instead of silently moving records into another month", () => {
  assert.equal(parseCalendarDay("2026-02-31"), null)
  assert.equal(parseCalendarDay("2026-13-01"), null)
  assert.equal(parseCalendarDay("2026-02-29"), null)
  assert.equal(calendarDayKey(parseCalendarDay("2028-02-29")), "2028-02-29")
})
