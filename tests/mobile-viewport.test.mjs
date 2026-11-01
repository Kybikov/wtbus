import test from "node:test"
import assert from "node:assert/strict"
import { resolveMobileViewport } from "../lib/mobile-viewport.ts"

const phone = {
  innerHeight: 793,
  largeHeight: 852,
  visualHeight: 793,
  visualTop: 0,
  scale: 1,
  iosStandalone: true,
  focused: false,
  wasKeyboard: false,
  safeTop: 59,
  safeBottom: 34,
}
function viewport(overrides = {}) {
  const value = resolveMobileViewport({ ...phone, ...overrides })
  assert.ok(value)
  assert.equal(value.top + value.height + value.bottom, value.layoutHeight)
  assert.ok(value.height > 0 && value.bottom >= 0 && value.top >= 0)
  return value
}
test("installed iPhone cold start fills the large viewport without adding safe area twice", () => {
  for (const [small, large, top] of [
    [793, 852, 59],
    [797, 844, 47],
    [812, 874, 62],
  ]) {
    const v = viewport({
      innerHeight: small,
      visualHeight: small,
      largeHeight: large,
      safeTop: top,
    })
    assert.equal(v.layoutHeight, large)
    assert.equal(v.height, large)
    assert.equal(v.bottom, 0)
    assert.equal(v.safeTop, top)
    assert.equal(v.safeBottom, 34)
    assert.equal(v.keyboard, false)
  }
})
test("Safari and Android browser toolbars do not get standalone height compensation", () => {
  const v = viewport({ iosStandalone: false })
  assert.equal(v.layoutHeight, 793)
  assert.equal(v.height, 793)
  assert.equal(v.bottom, 0)
})
test("keyboard visual rectangle and safe inset are consumed once", () => {
  const v = viewport({ visualHeight: 410, visualTop: 59, focused: true })
  assert.equal(v.keyboard, true)
  assert.equal(v.height, 410)
  assert.equal(v.top, 59)
  assert.equal(v.bottom, 383)
  assert.equal(v.safeTop, 0)
  assert.equal(v.safeBottom, 0)
})
test("keyboard dismissal restores full screen despite WebKit's stale visual offset and height", () => {
  const v = viewport({ visualHeight: 769, visualTop: 24, wasKeyboard: true })
  assert.equal(v.keyboard, false)
  assert.equal(v.height, 852)
  assert.equal(v.top, 0)
  assert.equal(v.bottom, 0)
  assert.equal(v.safeBottom, 34)
})
test("blur before keyboard animation ends retains occlusion until the viewport recovers", () => {
  const closing = viewport({
    visualHeight: 410,
    focused: false,
    wasKeyboard: true,
  })
  assert.equal(closing.keyboard, true)
  assert.equal(closing.safeBottom, 0)
  const closed = viewport({
    visualHeight: 793,
    focused: true,
    wasKeyboard: true,
  })
  assert.equal(closed.keyboard, false)
  assert.equal(closed.height, 852)
})
test("Android resize keyboard hides navigation even if innerHeight already shrank", () => {
  const v = viewport({
    iosStandalone: false,
    innerHeight: 410,
    largeHeight: 852,
    visualHeight: 410,
    focused: true,
  })
  assert.equal(v.layoutHeight, 410)
  assert.equal(v.height, 410)
  assert.equal(v.bottom, 0)
  assert.equal(v.keyboard, true)
  assert.equal(v.safeBottom, 0)
})
test("hardware keyboard and small browser deficits do not count as software keyboard", () => {
  const v = viewport({ focused: true })
  assert.equal(v.keyboard, false)
  assert.equal(v.safeBottom, 34)
})
test("rotation replaces portrait geometry instead of retaining a previous maximum", () => {
  const v = viewport({
    innerHeight: 373,
    largeHeight: 393,
    visualHeight: 373,
    safeTop: 0,
    safeBottom: 21,
  })
  assert.equal(v.layoutHeight, 393)
  assert.equal(v.height, 393)
  assert.equal(v.safeTop, 0)
  assert.equal(v.safeBottom, 21)
})
test("pinch zoom and hidden-page zero measurements leave the last valid geometry untouched", () => {
  assert.equal(resolveMobileViewport({ ...phone, scale: 1.5 }), null)
  assert.equal(resolveMobileViewport({ ...phone, visualHeight: 0 }), null)
  assert.equal(resolveMobileViewport({ ...phone, innerHeight: NaN }), null)
})
