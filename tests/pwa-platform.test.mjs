import test from "node:test"
import assert from "node:assert/strict"
import { pwaPlatform } from "../lib/pwa-platform.ts"
import { installPWA, updateInstallState } from "../lib/pwa-install.ts"
test("PWA instructions distinguish desktop Mac from iPad and all four platforms", () => {
  assert.equal(
    pwaPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 0),
    "windows"
  )
  assert.equal(
    pwaPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 0),
    "mac"
  )
  assert.equal(
    pwaPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5),
    "ios"
  )
  assert.equal(
    pwaPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS)", "iPhone", 0),
    "ios"
  )
  assert.equal(
    pwaPlatform("Mozilla/5.0 (Linux; Android 15)", "Linux armv8l", 5),
    "android"
  )
  assert.equal(
    pwaPlatform("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64", 0),
    null
  )
})

test("PWA installation consumes the browser prompt once, including dismissal and failure", async () => {
  let calls = 0
  updateInstallState({
    prompt: {
      prompt: async () => {
        calls++
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    },
  })
  assert.deepEqual(await Promise.all([installPWA(), installPWA()]), [
    "accepted",
    null,
  ])
  assert.equal(calls, 1)
  updateInstallState({
    prompt: {
      prompt: async () => {
        calls++
      },
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    },
  })
  assert.equal(await installPWA(), "dismissed")
  assert.equal(await installPWA(), null)
  updateInstallState({
    prompt: {
      prompt: async () => {
        throw Error("browser rejected prompt")
      },
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    },
  })
  await assert.rejects(installPWA(), /browser rejected prompt/)
  assert.equal(await installPWA(), null)
  updateInstallState({ prompt: null })
})
