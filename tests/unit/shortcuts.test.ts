import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inField, shortcutFor } from '../../src/lib/shortcuts'

const key = (k: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}, target?: unknown, code?: string) =>
  ({ key: k, code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target, ...mods })
const input = { tagName: 'INPUT', type: 'text' }

test('Ctrl K opens the palette, also from inside a field; Cmd K on a Mac', () => {
  assert.deepEqual(shortcutFor(key('k', { ctrlKey: true })), { kind: 'palette' })
  assert.deepEqual(shortcutFor(key('k', { ctrlKey: true }, input)), { kind: 'palette' })
  assert.deepEqual(shortcutFor(key('k', { metaKey: true }), true), { kind: 'palette' })
  assert.equal(shortcutFor(key('k', { metaKey: true })), null, 'not Cmd off a Mac')
  assert.equal(shortcutFor(key('k', { ctrlKey: true, shiftKey: true })), null)
})

test('Alt S/P/R/Y/J/C create, but not while typing in a field', () => {
  const s = shortcutFor(key('s', { altKey: true }))
  assert.equal(s?.kind === 'create' && s.path, '/sales/invoices/new')
  assert.equal(shortcutFor(key('ß', { altKey: true }, undefined, 'KeyS'))?.kind, 'create', 'the physical key when Alt changes the character')
  const paths: Array<[string, string]> = [['p', '/purchases/bills/new'], ['r', '/sales/payments/new'], ['y', '/purchases/payments/new'],
    ['j', '/accounting/vouchers/new/journal'], ['c', '/accounting/vouchers/new/contra']]
  for (const [k, path] of paths) {
    const a = shortcutFor(key(k, { altKey: true }))
    assert.equal(a?.kind === 'create' && a.path, path, k)
  }
  assert.equal(shortcutFor(key('s', { altKey: true }, input)), null)
  assert.equal(shortcutFor(key('s', { altKey: true }, { tagName: 'INPUT', type: 'checkbox' }))?.kind, 'create', 'a checkbox is not typing')
  assert.equal(shortcutFor(key('x', { altKey: true })), null)
  assert.equal(shortcutFor(key('s', { altKey: true, ctrlKey: true })), null, 'AltGr (Ctrl+Alt) types characters')
})

test('Ctrl S saves and Ctrl Enter runs the primary action, from inside fields', () => {
  assert.deepEqual(shortcutFor(key('s', { ctrlKey: true }, input)), { kind: 'save' })
  assert.deepEqual(shortcutFor(key('Enter', { ctrlKey: true }, { tagName: 'TEXTAREA' })), { kind: 'primary' })
  assert.equal(shortcutFor(key('Enter')), null)
  assert.equal(shortcutFor(key('s')), null)
})

test('inField knows typing targets', () => {
  assert.equal(inField(input), true)
  assert.equal(inField({ tagName: 'SELECT' }), true)
  assert.equal(inField({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(inField({ tagName: 'BUTTON' }), false)
  assert.equal(inField(null), false)
})
