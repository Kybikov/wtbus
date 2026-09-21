import test from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, serializeViewCsv, createTargets } from '../lib/admin-actions.ts'
test('CSV escapes separators, quotes and line breaks and protects formulas', () => {
 assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"')
 for (const value of ['=HYPERLINK("x")','+380500001122',' @SUM(1)','-cmd']) assert.ok(csvCell(value).startsWith('"\''))
 assert.equal(csvCell(-12), '"-12"')
 assert.equal(csvCell(false), '"false"')
 assert.equal(csvCell(null), '""')
 assert.equal(serializeViewCsv(['Ім’я'], [['Ivan']]), '\uFEFF"Ім’я"\r\n"Ivan"')
})
test('drivers cannot create CRM records; fleet and team require management rights', () => {
 assert.equal(createTargets.filter(t => t.roles.includes('driver')).length,0)
 assert.equal(createTargets.filter(t => t.roles.includes('developer')).length,6)
 assert.equal(createTargets.find(t => t.href === '/team').roles.includes('dispatcher'),false)
 assert.equal(createTargets.find(t => t.href === '/fleet').roles.includes('dispatcher'),false)
})
