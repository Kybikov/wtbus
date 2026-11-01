import test from "node:test"
import assert from "node:assert/strict"
import { pullDistance, pullRefreshThreshold } from "../lib/pull-refresh.ts"

test("refresh requires a deliberate downward drag at the top, preserving scroll, swipe and pinch gestures", () => {
  assert.ok(pullDistance(3, 150, 0) >= pullRefreshThreshold)
  assert.ok(pullDistance(3, 80, 0) < pullRefreshThreshold)
  assert.equal(pullDistance(80, 30, 0), 0)
  assert.equal(pullDistance(0, -150, 0), 0)
  assert.equal(pullDistance(0, 150, 1), 0)
  assert.equal(pullDistance(0, 150, 0, 2), 0)
  assert.equal(pullDistance(0, 600, 0), 96)
})
