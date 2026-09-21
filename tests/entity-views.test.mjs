import assert from "node:assert/strict"
import test from "node:test"
import { normalizeViewConfig, sameViewConfig } from "../lib/entity-views.ts"

test("saved views survive removed columns, modes and filters without an empty table", () => {
  const saved = {
    mode: "kanban",
    columns: ["removed"],
    filters: { removed: "yes", telegram: "linked", trips: "" },
  }
  assert.deepEqual(
    normalizeViewConfig(
      saved,
      ["table", "list"],
      ["name", "phone"],
      ["name"],
      ["telegram", "trips"]
    ),
    {
      mode: "table",
      columns: ["name"],
      filters: { telegram: "linked" },
      metrics: [],
      columnWidths: {},
      pinnedColumns: { left: [], right: [] },
      sort: null,
    }
  )
})
test("saved views preserve table layout and remove invalid pin, width and sort state", () => {
  const saved = {
    mode: "table",
    columns: ["phone", "name"],
    filters: {},
    columnWidths: { phone: 240, name: 80, removed: 200 },
    pinnedColumns: {
      left: ["phone", "phone", "removed"],
      right: ["phone", "name"],
    },
    sort: { columnId: "removed", direction: "asc" },
  }
  assert.deepEqual(
    normalizeViewConfig(saved, ["table"], ["name", "phone"], ["name"], []),
    {
      mode: "table",
      columns: ["phone", "name"],
      filters: {},
      metrics: [],
      columnWidths: { phone: 240 },
      pinnedColumns: { left: ["phone"], right: ["name"] },
      sort: null,
    }
  )
})
test("dirty state tracks column order and ignores cleared filters while detecting actual changes", () => {
  const a = {
    mode: "table",
    columns: ["phone", "name"],
    filters: { telegram: "linked", trips: "" },
  }
  const b = {
    mode: "table",
    columns: ["name", "phone"],
    filters: { telegram: "linked" },
  }
  assert.equal(sameViewConfig(a, b), false)
  assert.equal(sameViewConfig(a, { ...b, columns: ["phone", "name"] }), true)
  assert.equal(sameViewConfig(a, { ...b, mode: "list" }), false)
  assert.equal(
    sameViewConfig(a, { ...b, filters: { telegram: "unlinked" } }),
    false
  )
  assert.equal(
    sameViewConfig(a, { ...b, columns: ["phone", "name"], metrics: [] }),
    true
  )
  assert.equal(
    sameViewConfig(a, {
      ...b,
      metrics: [{ field: "phone", operation: "filled" }],
    }),
    false
  )
})
