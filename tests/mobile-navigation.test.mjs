import { test } from "node:test"
import assert from "node:assert/strict"
import { mobileNavigation, mobileDockNavigation, isMobileDestinationActive } from "../lib/mobile-navigation.ts"

test("mobile navigation gives drivers only their trip, notifications and profile", () => {
  assert.deepEqual(mobileNavigation("driver").map(item => item.href), ["/driver", "/notifications", "/profile"])
  assert.deepEqual(mobileDockNavigation("driver").map(item => item.href), ["/driver", "/notifications", "/profile"])
})
test("dispatcher mobile search cannot suggest management or finance pages", () => {
  const pages = mobileNavigation("dispatcher").map(item => item.href)
  for (const href of ["/finance", "/settings", "/team", "/driver"]) assert.equal(pages.includes(href), false)
  for (const href of ["/routes", "/trips", "/bookings", "/notifications", "/profile"]) assert.equal(pages.includes(href), true)
})
test("operations dock has four unique primary destinations and managers retain all sections", () => {
  for (const role of ["owner", "admin", "developer", "dispatcher"]) {
    const pages = mobileDockNavigation(role).map(item => item.href)
    assert.equal(pages.length, 4)
    assert.equal(new Set(pages).size, 4)
  }
  assert.ok(mobileNavigation("owner").some(item => item.href === "/settings"))
})
test("dock selection uses complete route segments rather than prefix collisions", () => {
  assert.equal(isMobileDestinationActive("/bookings/abc", "/bookings"), true)
  assert.equal(isMobileDestinationActive("/bookings-other", "/bookings"), false)
  assert.equal(isMobileDestinationActive("/trips", "/"), false)
  assert.equal(isMobileDestinationActive("/", "/"), true)
})
