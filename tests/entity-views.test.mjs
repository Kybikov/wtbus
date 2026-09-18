import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeViewConfig, sameViewConfig } from '../lib/entity-views.ts'

test('saved views survive removed columns, modes and filters without an empty table',()=>{
  const saved={mode:'kanban',columns:['removed'],filters:{removed:'yes',telegram:'linked',trips:''}}
  assert.deepEqual(normalizeViewConfig(saved,['table','list'],['name','phone'],['name'],['telegram','trips']),{mode:'table',columns:['name'],filters:{telegram:'linked'}})
})
test('dirty state ignores column order and cleared filters but detects actual changes',()=>{
  const a={mode:'table',columns:['phone','name'],filters:{telegram:'linked',trips:''}}
  const b={mode:'table',columns:['name','phone'],filters:{telegram:'linked'}}
  assert.equal(sameViewConfig(a,b),true)
  assert.equal(sameViewConfig(a,{...b,mode:'list'}),false)
  assert.equal(sameViewConfig(a,{...b,filters:{telegram:'unlinked'}}),false)
})
