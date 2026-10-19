import assert from "node:assert/strict"
import test from "node:test"
import {
  mergeCardOrder,
  mergeVisibleCardOrder,
  placeKanbanCard,
  restoreKanbanCard,
  kanbanScrollSpeed,
} from "../lib/kanban.ts"
import {
  canMoveTripStatus,
  canMoveBookingStatus,
} from "../lib/kanban-workflow.ts"

test("card order survives refreshed records and inserts into the requested column position", () => {
  assert.deepEqual(mergeCardOrder(["gone", "b", "b"], ["a", "b", "c"]), [
    "b",
    "a",
    "c",
  ])
  const group = (id) => (["c", "d"].includes(id) ? "done" : "todo")
  assert.deepEqual(
    placeKanbanCard(["a", "b", "c", "d"], "a", "done", 1, group),
    ["b", "c", "a", "d"]
  )
  assert.deepEqual(
    placeKanbanCard(["a", "b", "c", "d"], "b", "todo", -2, group),
    ["b", "a", "c", "d"]
  )
  assert.deepEqual(
    placeKanbanCard(["a", "b", "c", "d"], "a", "done", 100, group),
    ["b", "c", "d", "a"]
  )
  assert.deepEqual(placeKanbanCard(["a", "b"], "a", "empty", 0, group), [
    "b",
    "a",
  ])
})

test("a rejected move restores only that card while preserving other reordered cards and new arrivals", () => {
  assert.deepEqual(
    restoreKanbanCard(["d", "b", "c", "a", "new"], "a", ["a", "b", "c", "d"]),
    ["d", "a", "b", "c", "new"]
  )
  assert.deepEqual(restoreKanbanCard(["a", "b", "new"], "c", ["a", "b", "c"]), [
    "a",
    "b",
    "c",
    "new",
  ])
  assert.deepEqual(restoreKanbanCard(["new"], "c", ["a", "b", "c"]), [
    "c",
    "new",
  ])
})

test("sorting filtered cards preserves the saved positions of hidden cards", () => {
  assert.deepEqual(
    mergeVisibleCardOrder(["a", "hidden", "b", "other"], ["b", "a", "new"]),
    ["b", "hidden", "a", "other", "new"]
  )
  assert.deepEqual(
    mergeVisibleCardOrder(["a", "a", "hidden"], ["a", "a", "new"]),
    ["a", "hidden", "new"]
  )
})

test("autoscroll accelerates at both edges and stays still outside the board or at its center", () => {
  assert.equal(kanbanScrollSpeed(100, 100, 500), -14)
  assert.equal(kanbanScrollSpeed(500, 100, 500), 14)
  assert.equal(kanbanScrollSpeed(300, 100, 500), 0)
  assert.equal(kanbanScrollSpeed(99, 100, 500), 0)
  assert.equal(kanbanScrollSpeed(501, 100, 500), 0)
  assert.ok(kanbanScrollSpeed(480, 100, 500) < 14)
})

const statuses = (phases) =>
  phases.map(([key, phase, terminal = false]) => ({
    key,
    semanticPhase: phase,
    isTerminal: terminal,
  }))
test("trip dragging follows semantic transitions, including custom statuses and terminal locks", () => {
  const list = statuses([
    ["new", "planned"],
    ["review", "planned"],
    ["assigned", "assigned"],
    ["running", "in_progress"],
    ["done", "completed", true],
    ["cancel", "cancelled", true],
  ])
  assert.equal(canMoveTripStatus(list, "new", "review"), true)
  assert.equal(canMoveTripStatus(list, "new", "assigned"), true)
  assert.equal(canMoveTripStatus(list, "new", "done"), false)
  assert.equal(canMoveTripStatus(list, "running", "cancel"), true)
  assert.equal(canMoveTripStatus(list, "done", "review"), false)
  assert.equal(canMoveTripStatus(list, "new", "unknown"), false)
})

test("booking dragging never substitutes for payment confirmation or completing a trip", () => {
  const list = statuses([
    ["pending", "awaiting_payment"],
    ["reminder", "awaiting_payment"],
    ["paid", "confirmed"],
    ["done", "completed", true],
    ["cancel", "cancelled", true],
  ])
  assert.equal(
    canMoveBookingStatus(list, "pending", "reminder", "planned"),
    true
  )
  assert.equal(canMoveBookingStatus(list, "pending", "paid", "planned"), false)
  assert.equal(canMoveBookingStatus(list, "paid", "done", "in_progress"), false)
  assert.equal(canMoveBookingStatus(list, "pending", "cancel", "planned"), true)
  assert.equal(
    canMoveBookingStatus(list, "pending", "cancel", "in_progress"),
    false
  )
  assert.equal(
    canMoveBookingStatus(list, "done", "pending", "completed"),
    false
  )
})
