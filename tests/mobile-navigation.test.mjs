import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mobileNavigation,
  mobileDockNavigation,
  isMobileDestinationActive,
} from "../lib/mobile-navigation.ts"

test("mobile navigation gives drivers only their trip, notifications and profile", () => {
  assert.deepEqual(
    mobileNavigation("driver").map((item) => item.href),
    ["/driver", "/notifications", "/profile"]
  )
  assert.deepEqual(
    mobileDockNavigation("driver").map((item) => item.href),
    ["/driver", "/notifications", "/profile"]
  )
})
test("dispatcher mobile search cannot suggest management or finance pages", () => {
  const pages = mobileNavigation("dispatcher").map((item) => item.href)
  for (const href of ["/finance", "/settings", "/team", "/driver"])
    assert.equal(pages.includes(href), false)
  for (const href of [
    "/routes",
    "/trips",
    "/bookings",
    "/notifications",
    "/profile",
  ])
    assert.equal(pages.includes(href), true)
})
test("primary dock stays compact while all other permitted pages remain reachable", () => {
  for (const role of ["owner", "admin", "developer", "dispatcher"]) {
    const primary = mobileDockNavigation(role).map((item) => item.href)
    assert.deepEqual(primary, ["/", "/trips", "/bookings"])
    // Three destinations plus Search and More: no scrolling or hidden targets.
    assert.ok(primary.length + 2 <= 5)
    const pages = mobileNavigation(role).map((item) => item.href)
    assert.equal(new Set(pages).size, pages.length)
    for (const href of primary) assert.ok(pages.includes(href))
    for (const href of ["/routes", "/fleet", "/customers", "/profile"])
      assert.ok(pages.includes(href))
    assert.equal(pages.includes("/availability"), false)
  }
})

test("dock selection uses complete route segments rather than prefix collisions", () => {
  assert.equal(isMobileDestinationActive("/bookings/abc", "/bookings"), true)
  assert.equal(isMobileDestinationActive("/bookings-other", "/bookings"), false)
  assert.equal(isMobileDestinationActive("/trips", "/"), false)
  assert.equal(isMobileDestinationActive("/", "/"), true)
})

test("developer can reach every registered destination", () => {
  const developer = new Set(
    mobileNavigation("developer").map((item) => item.href)
  )
  for (const role of ["owner", "admin", "dispatcher", "driver", "accountant"])
    for (const page of mobileNavigation(role))
      assert.ok(developer.has(page.href), page.href)
})
