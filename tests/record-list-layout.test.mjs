import test from "node:test"
import assert from "node:assert/strict"
import { recordListColumns } from "../lib/record-list-layout.ts"

test("record rows use the center and preserve every configured field in columns of at most two", () => {
  for (let length = 0; length <= 16; length++) {
    const fields = Array.from({ length }, (_, index) => String(index))
    const snapshot = [...fields]
    const columns = recordListColumns(fields)
    assert.deepEqual(columns.flat(), snapshot)
    assert.ok(
      columns.every((column) => column.length > 0 && column.length <= 2)
    )
    assert.deepEqual(fields, snapshot)
  }
  assert.deepEqual(recordListColumns(["name", "phone", "trips", "revenue"]), [
    ["name", "phone"],
    ["trips"],
    ["revenue"],
  ])
  assert.deepEqual(
    recordListColumns(["name", "plate", "seats", "driver", "status"]),
    [["name", "plate"], ["seats", "driver"], ["status"]]
  )
})
