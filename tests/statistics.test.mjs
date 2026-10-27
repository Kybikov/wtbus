import { test } from "node:test"
import assert from "node:assert/strict"
import {
  statisticsPreset,
  statisticsMonth,
  statisticsCalendar,
  statisticsChange,
  statisticsOccupancy,
  shiftStatisticsDate,
  isStatisticsDate,
  statisticsPeriodLabel,
} from "../lib/statistics.ts"

test("statistics dates use civil days across DST, leap years and year boundaries", () => {
  assert.deepEqual(statisticsPreset("2026-03-30", "week"), {
    from: "2026-03-24",
    to: "2026-03-30",
  })
  assert.deepEqual(statisticsPreset("2026-01-03", "30days"), {
    from: "2025-12-05",
    to: "2026-01-03",
  })
  assert.equal(shiftStatisticsDate("2024-03-01", -1), "2024-02-29")
  assert.deepEqual(statisticsMonth("2026-01-31", -1), {
    from: "2025-12-01",
    to: "2025-12-31",
  })
  assert.deepEqual(statisticsMonth("2024-02-29"), {
    from: "2024-02-01",
    to: "2024-02-29",
  })
})

test("period picker presets preserve civil month/year boundaries and leap days", () => {
  assert.deepEqual(statisticsPreset("2026-01-03", "lastMonth"), {
    from: "2025-12-01",
    to: "2025-12-31",
  })
  assert.deepEqual(statisticsPreset("2025-03-30", "lastYear"), {
    from: "2024-01-01",
    to: "2024-12-31",
  })
  assert.deepEqual(statisticsPreset("2026-10-27", "year"), {
    from: "2026-01-01",
    to: "2026-10-27",
  })
  for (const days of [30, 90, 180, 365]) {
    const range = statisticsPreset("2026-10-27", `${days}days`)
    assert.equal(
      (new Date(range.to + "T12:00:00Z") -
        new Date(range.from + "T12:00:00Z")) /
        86400000 +
        1,
      days
    )
  }
})

test("one period button names the applied preset, whole month, year or exact range", () => {
  assert.equal(
    statisticsPeriodLabel("2026-10-27", "2026-10-01", "2026-10-27"),
    "Этот месяц"
  )
  assert.equal(
    statisticsPeriodLabel("2026-10-27", "2026-09-01", "2026-09-30"),
    "Прошлый месяц"
  )
  assert.equal(
    statisticsPeriodLabel("2026-10-27", "2024-01-01", "2024-12-31"),
    "2024 год"
  )
  assert.match(
    statisticsPeriodLabel("2026-10-27", "2024-02-01", "2024-02-29"),
    /^Февраль 2024/
  )
  assert.equal(
    statisticsPeriodLabel("2026-10-27", "2026-10-05", "2026-10-09"),
    "05.10.26 — 09.10.26"
  )
  assert.equal(statisticsPeriodLabel(undefined, "", ""), "Период")
})
test("calendar starts on Monday and includes every month day exactly once", () => {
  for (const month of [
    "2026-02-01",
    "2026-03-01",
    "2026-10-01",
    "2024-02-01",
  ]) {
    const dates = statisticsCalendar(month)
    assert.equal(new Date(dates[0] + "T12:00:00Z").getUTCDay(), 1)
    assert.equal(dates.length % 7, 0)
    assert.equal(new Set(dates).size, dates.length)
    const range = statisticsMonth(month)
    assert.equal(
      dates.filter((day) => day >= range.from && day <= range.to).length,
      Number(range.to.slice(-2))
    )
  }
})
test("comparison and occupancy do not fabricate a percentage without a denominator", () => {
  assert.equal(statisticsChange(100, 0), "Нет базы сравнения")
  assert.equal(statisticsChange(0, 0), "Без изменений")
  assert.equal(statisticsChange(150, 100), "+50%")
  assert.equal(statisticsChange(-50, -100), "+50%")
  assert.equal(statisticsOccupancy(0, 0), null)
  assert.equal(statisticsOccupancy(5, 20), 25)
})

test("malformed URL dates cannot reach the calendar renderer", () => {
  for (const value of [
    "bad",
    "2026-02-30",
    "2026-13-01",
    "1899-12-31",
    "2101-01-01",
  ])
    assert.equal(isStatisticsDate(value), false)
  assert.equal(isStatisticsDate("2024-02-29"), true)
})
