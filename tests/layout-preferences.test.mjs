import test from "node:test"
import assert from "node:assert/strict"
import {
  defaultLayoutPreferences,
  parseLayoutCookie,
  parseLayoutPreferences,
  serializeLayoutCookie,
} from "../lib/layout-preferences.ts"

test("reload preserves layout and manual sidebar state for every mode", () => {
  for (const mode of ["default", "icon", "full"]) {
    for (const open of [true, false]) {
      const snapshot = {
        preferences: {
          ...defaultLayoutPreferences,
          sidebarMode: mode,
          sidebarVariant: "inset",
          scale: "lg",
          density: "compact",
        },
        override: { mode, open },
      }
      assert.deepEqual(parseLayoutCookie(serializeLayoutCookie(snapshot)), snapshot)
    }
  }
})

test("changing sidebar mode discards the previous mode's manual override", () => {
  const snapshot = {
    preferences: { ...defaultLayoutPreferences, sidebarMode: "icon" },
    override: { mode: "default", open: true },
  }
  assert.deepEqual(parseLayoutCookie(serializeLayoutCookie(snapshot)), {
    preferences: snapshot.preferences,
    override: null,
  })
})

test("invalid cookies and unsupported layout values fall back safely", () => {
  for (const value of [undefined, "", "%ZZ", "null", "[]", "{}", "broken"]) {
    assert.equal(parseLayoutCookie(value), null)
  }
  for (const [key, value] of [
    ["sidebarMode", "hidden"], ["sidebarVariant", "custom"],
    ["scale", "huge"], ["radius", 3], ["density", null],
    ["sidebarMode", { toString: () => "icon" }],
  ]) {
    assert.equal(parseLayoutPreferences({ ...defaultLayoutPreferences, [key]: value }), null)
  }
  assert.deepEqual(parseLayoutCookie(serializeLayoutCookie({
    preferences: defaultLayoutPreferences,
    override: { mode: "default", open: "false" },
  })), { preferences: defaultLayoutPreferences, override: null })
})
