import test from "node:test"
import assert from "node:assert/strict"
import { groupActivityEvents } from "../lib/activity-changes.ts"

const event = (id, createdAt, extra = {}) => ({
  id, actorId: "member-1", actor: "Сотрудник", kind: "human", action: "record_updated", createdAt,
  changedFields: ["status"], changes: [{ field: "status", before: "inactive", after: "active" }], ...extra,
})

test("identical transitions from the same actor and minute collapse visually, preserving the input", () => {
  const input = [event("3", "2026-10-20T10:17:50Z"), event("2", "2026-10-20T12:17:20+02:00"), event("1", "2026-10-20T10:16:59Z")]
  const groups = groupActivityEvents(input)
  assert.deepEqual(groups.map(({ id, count }) => [id, count]), [["3", 2], ["1", 1]])
  assert.equal(input[0].count, undefined)
})

test("reverse transitions, different actors with the same name, and different changed fields stay distinct", () => {
  const input = [
    event("4", "2026-10-20T10:17:50Z"),
    event("3", "2026-10-20T10:17:40Z", { changes: [{ field: "status", before: "active", after: "inactive" }] }),
    event("2", "2026-10-20T10:17:30Z", { actorId: "member-2" }),
    event("1", "2026-10-20T10:17:20Z", { changedFields: ["is_active"] }),
  ]
  assert.equal(groupActivityEvents(input).length, 4)
})

test("legacy entries group without fabricating missing values", () => {
  const groups = groupActivityEvents([event("2", "2026-10-20T10:17:50Z", { changes: undefined }), event("1", "2026-10-20T10:17:40Z", { changes: undefined })])
  assert.equal(groups[0].count, 2)
  assert.equal(groups[0].changes, undefined)
})
