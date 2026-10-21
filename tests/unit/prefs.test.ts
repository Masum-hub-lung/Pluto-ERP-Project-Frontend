import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readPref, writePref } from '../../src/lib/prefs'

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

test('moves a value from the old lf. key to the pluto. key once', () => {
  const s = memory({ 'lf.sidebar': 'collapsed' })
  assert.equal(readPref('pluto.sidebar', 'lf.sidebar', s), 'collapsed')
  assert.deepEqual([...s.m], [['pluto.sidebar', 'collapsed']])
  assert.equal(readPref('pluto.sidebar', 'lf.sidebar', s), 'collapsed')
})

test('the new key wins over a leftover old key; missing keys read as null', () => {
  const s = memory({ 'pluto.lastCompany': '2', 'lf.lastCompany': '1' })
  assert.equal(readPref('pluto.lastCompany', 'lf.lastCompany', s), '2')
  assert.equal(readPref('pluto.other', 'lf.other', s), null)
})

test('storage that throws or is missing never breaks the app', () => {
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => {} }
  assert.equal(readPref('pluto.sidebar', 'lf.sidebar', broken), null)
  assert.doesNotThrow(() => writePref('pluto.sidebar', 'expanded', broken))
  assert.equal(readPref('pluto.sidebar', undefined, null), null)
})
