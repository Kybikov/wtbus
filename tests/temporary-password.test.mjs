import test from "node:test"
import assert from "node:assert/strict"
import { generateTemporaryPassword } from "../lib/temporary-password.ts"

test("temporary credentials fit bcrypt's byte limit, cover character classes and do not repeat", () => {
  const values = new Set()
  for (let i = 0; i < 1000; i++) {
    const value = generateTemporaryPassword()
    assert.equal(value.length, 20)
    assert.equal(new TextEncoder().encode(value).length, 20)
    assert.match(value, /^[A-Za-z2-9!@#$%]+$/)
    assert.match(value, /[A-Z]/)
    assert.match(value, /[a-z]/)
    assert.match(value, /[0-9]/)
    values.add(value)
  }
  assert.equal(values.size, 1000)
})
