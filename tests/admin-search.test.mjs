import assert from 'node:assert/strict'
import test from 'node:test'
import { isSearchShortcut, searchPageHref } from '../lib/admin-search.ts'

test('global search shortcut works with Ukrainian layout and on Mac, and ignores composition',()=>{
  const key={key:'л',code:'KeyK',ctrlKey:true,metaKey:false,altKey:false}
  assert.equal(isSearchShortcut(key),true)
  assert.equal(isSearchShortcut({...key,ctrlKey:false,metaKey:true}),true)
  assert.equal(isSearchShortcut({...key,isComposing:true}),false)
  assert.equal(isSearchShortcut({...key,altKey:true}),false)
  assert.equal(isSearchShortcut({...key,ctrlKey:false}),false)
})

test('result navigation preserves the exact record identifier and safely encodes a phone',()=>{
  assert.equal(new URL(searchPageHref('/customers','+380500001122'),'http://localhost').searchParams.get('q'),'+380500001122')
  assert.equal(searchPageHref('/bookings','123-456'),'/bookings?q=123-456')
})
