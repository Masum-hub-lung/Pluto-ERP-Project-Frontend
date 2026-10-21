import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comboKey } from '../../src/lib/combobox'

const closed = { open: false, active: -1 }

test('arrow keys open the list and move with wrapping', () => {
  assert.deepEqual(comboKey(closed, 'ArrowDown', 3), { open: true, active: 0 })
  assert.deepEqual(comboKey({ open: true, active: 2 }, 'ArrowDown', 3), { open: true, active: 0 })
  assert.deepEqual(comboKey({ open: true, active: 0 }, 'ArrowUp', 3), { open: true, active: 2 })
  assert.deepEqual(comboKey(closed, 'ArrowUp', 3), { open: true, active: 2 })
  assert.deepEqual(comboKey({ open: true, active: 1 }, 'End', 3), { open: true, active: 2 })
  assert.deepEqual(comboKey({ open: true, active: 1 }, 'Home', 3), { open: true, active: 0 })
})

test('Enter chooses the highlighted option, Esc closes, empty lists stay safe', () => {
  assert.deepEqual(comboKey({ open: true, active: 1 }, 'Enter', 3), { open: false, active: -1, choose: 1 })
  assert.deepEqual(comboKey({ open: true, active: -1 }, 'Enter', 3), { open: true, active: -1 })
  assert.deepEqual(comboKey({ open: true, active: 1 }, 'Escape', 3), closed)
  assert.deepEqual(comboKey(closed, 'ArrowDown', 0), { open: true, active: -1 })
})
