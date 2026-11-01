import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sampleAmount } from '../../src/pages/settings/BusinessSettings'
import { trimRate } from '../../src/pages/settings/TaxSettings'

test('the K5 example shows the chosen formats, not a calculation', () => {
  assert.equal(sampleAmount({ symbol_position: 'before', table_decimals: 2, negative_format: 'parentheses', number_grouping: 'lakh' }), '(৳ 12,34,567.50)')
  assert.equal(sampleAmount({ symbol_position: 'after', table_decimals: 0, negative_format: 'minus', number_grouping: 'million' }), '−1,234,567 ৳')
})

test('tax rates lose trailing zeros for display only', () => {
  assert.equal(trimRate('15.0000'), '15')
  assert.equal(trimRate('7.5000'), '7.5')
  assert.equal(trimRate('0.0000'), '0')
})
