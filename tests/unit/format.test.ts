import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTaka, initials, termLabel } from '../../src/lib/format'

test('formats decimal strings with Bangladeshi grouping, without floats', () => {
  assert.equal(formatTaka('118450.00'), '1,18,450.00')
  assert.equal(formatTaka('26184000.5'), '2,61,84,000.50')
  assert.equal(formatTaka('999'), '999.00')
  assert.equal(formatTaka('0'), '0.00')
  assert.equal(formatTaka('-1500.25'), '(1,500.25)')
  assert.equal(formatTaka('-0.00'), '0.00')
  assert.equal(formatTaka('9007199254740993.01'), '9,00,71,99,25,47,40,993.01') // beyond float precision (2^53+1), still exact
  assert.equal(formatTaka('500000.00', { symbol: true }), '৳ 5,00,000.00')
})

test('initials and term labels follow the design', () => {
  assert.equal(initials('Karim Distributors'), 'KD')
  assert.equal(initials('rahman'), 'R')
  assert.equal(termLabel('Net 15'), 'Net 15 days')
  assert.equal(termLabel('Cash'), 'Cash')
  assert.equal(termLabel(null), '—')
})
