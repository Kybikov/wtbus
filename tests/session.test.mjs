import test from "node:test"
import assert from "node:assert/strict"
import { safeReturnPath, loginPath } from "../lib/session-navigation.ts"
import { checkSession } from "../lib/session-check.ts"

test("login preserves local destinations and rejects external or looping return URLs", () => {
  assert.equal(
    safeReturnPath("/trips?date=2026-09-14#booking"),
    "/trips?date=2026-09-14#booking"
  )
  assert.equal(
    new URL(
      loginPath("/driver?trip=123"),
      "https://vivat.invalid"
    ).searchParams.get("next"),
    "/driver?trip=123"
  )
  for (const value of [
    null,
    "",
    "https://evil.invalid",
    "//evil.invalid",
    "/\\evil.invalid",
    "/\t/evil.invalid",
    "/login",
    "/login/",
    "/trips/../login?next=/login",
  ]) {
    assert.equal(safeReturnPath(value), "/", String(value))
  }
})

test("server session gate checks the backend and distinguishes outages from invalid sessions", async (t) => {
  let status = 200
  let calls = 0
  let fail = false
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++
    assert.equal(url.toString(), "http://api.test/api/v1/auth/me")
    assert.equal(init.headers.Authorization, "Bearer fake-session")
    assert.equal(init.cache, "no-store")
    assert.equal(init.redirect, "error")
    assert.ok(init.signal instanceof AbortSignal)
    if (fail) throw new TypeError("Network failure")
    return new Response("{}", { status })
  })
  assert.equal(
    await checkSession(undefined, "http://api.test"),
    "unauthenticated"
  )
  assert.equal(calls, 0)
  assert.equal(
    await checkSession("fake-session", "http://api.test"),
    "authenticated"
  )
  status = 401
  assert.equal(
    await checkSession("fake-session", "http://api.test"),
    "unauthenticated"
  )
  for (status of [403, 429, 500, 502, 503]) {
    assert.equal(
      await checkSession("fake-session", "http://api.test"),
      "unavailable"
    )
  }
  fail = true
  assert.equal(
    await checkSession("fake-session", "http://api.test"),
    "unavailable"
  )
})

test("API session loss redirects once without swallowing responses or confusing permission/network failures", async (t) => {
  const { sessionFetch } =
    await import("../lib/session-navigation.ts?browser-test")
  const redirects = []
  const location = new URL(
    "https://vivat.invalid/trips?date=2026-09-14#booking"
  )
  location.replace = (path) => redirects.push(path)
  const previousWindow = globalThis.window
  globalThis.window = { location }
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })
  let status = 200
  let failure
  let expectedInit
  t.mock.method(globalThis, "fetch", async (_input, init) => {
    if (expectedInit) assert.equal(init, expectedInit)
    if (failure) throw failure
    return new Response(JSON.stringify({ status }), { status })
  })
  for (status of [200, 400, 403, 429, 500, 503]) {
    assert.equal((await sessionFetch("/api/fleet")).status, status)
  }
  failure = new TypeError("Failed to fetch")
  await assert.rejects(sessionFetch("/api/fleet"), failure)
  failure = undefined
  status = 401
  for (const url of [
    "/api/auth/login",
    "/api/auth/select-company",
    "/api/auth/logout",
    "https://external.invalid/api/fleet",
    "/logo.png",
  ]) {
    await sessionFetch(url)
  }
  location.pathname = "/login"
  await sessionFetch("/api/auth/me")
  assert.deepEqual(redirects, [])
  location.pathname = "/driver"
  expectedInit = {
    method: "POST",
    body: "point",
    signal: new AbortController().signal,
  }
  const response = await sessionFetch("/api/gps-points", expectedInit)
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { status: 401 })
  expectedInit = undefined
  await sessionFetch(new Request("https://vivat.invalid/api/auth/me"))
  assert.equal(redirects.length, 1)
  assert.equal(
    new URL(redirects[0], location).searchParams.get("next"),
    "/driver?date=2026-09-14#booking"
  )
})
