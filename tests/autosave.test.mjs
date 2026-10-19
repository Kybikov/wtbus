import { test } from "node:test"
import assert from "node:assert/strict"
import { createAutosaveQueue } from "../lib/autosave.ts"

test("blur commits serialize and merge without losing adjacent edits", async () => {
  const writes = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const queue = createAutosaveQueue(async value => {
    writes.push(value)
    if (writes.length === 1) await gate
    return value
  })
  queue.reset({ name: "old", phone: "1" })
  const first = queue.commit({ name: "new" })
  const second = queue.commit({ phone: "2" })
  await Promise.resolve()
  release()
  await Promise.all([first, second])
  assert.deepEqual(writes, [{ name: "new", phone: "1" }, { name: "new", phone: "2" }])
  await queue.commit({ phone: "2" })
  assert.equal(writes.length, 2, "unchanged blur must not write")
})
test("failed writes do not claim success or poison later retries", async () => {
  let fail = true
  const writes = []
  const queue = createAutosaveQueue(async value => {
    if (fail) { fail = false; throw Error("offline") }
    writes.push(value)
    return value
  })
  queue.reset({ name: "old", phone: "1" })
  await assert.rejects(queue.commit({ name: "new" }), /offline/)
  await queue.commit({ phone: "2" })
  await queue.commit({ name: "new" })
  assert.deepEqual(writes, [{ name: "old", phone: "2" }, { name: "new", phone: "2" }])
})
test("refresh invalidates queued changes from the previous record", async () => {
  const writes = []
  const queue = createAutosaveQueue(async value => { writes.push(value); return value })
  queue.reset({ name: "old" })
  const pending = queue.commit({ name: "discarded" })
  queue.reset({ name: "refreshed" })
  await pending
  assert.deepEqual(writes, [])
})

test("queued writes keep their original record handler after navigation", async () => {
 const targets=[]
 const queue=createAutosaveQueue(async value=>value)
 queue.reset({name:"old"})
 const old=queue.commit({name:"old edit"},async value=>{targets.push("old");return value})
 await old
 queue.reset({name:"new"})
 await queue.commit({name:"new edit"},async value=>{targets.push("new");return value})
 assert.deepEqual(targets,["old","new"])
})
