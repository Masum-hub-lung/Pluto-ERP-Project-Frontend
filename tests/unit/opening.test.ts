import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openingInput, splitOpening } from '../../src/lib/opening'

test('splitOpening turns the signed API value into amount and side (text only)', () => {
  assert.deepEqual(splitOpening('185000.00', 'customer'), { opening_balance: '185000.00', opening_side: 'dr' })
  assert.deepEqual(splitOpening('-75000.00', 'supplier'), { opening_balance: '75000.00', opening_side: 'cr' })
  assert.deepEqual(splitOpening('0.00', 'customer'), { opening_balance: '', opening_side: 'dr' })
  assert.deepEqual(splitOpening(null, 'supplier'), { opening_balance: '', opening_side: 'cr' })
})

test('openingInput sends an amount only when typed, or zero to clear an existing one', () => {
  assert.deepEqual(openingInput({ opening_balance: ' 185000.00 ', opening_side: 'dr' }, false), { opening_balance: '185000.00', opening_side: 'dr' })
  assert.deepEqual(openingInput({ opening_balance: '', opening_side: 'cr' }, false), {})
  assert.deepEqual(openingInput({ opening_balance: '', opening_side: 'cr' }, true), { opening_balance: '0.00', opening_side: 'cr' })
})
