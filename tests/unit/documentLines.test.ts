import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Product } from '../../src/api/contract.gen'
import { completeIndexes, emptyLine, isBlankLine, isCompleteLine, mapResults, remapLineErrors } from '../../src/components/document/lines'

const p = { id: 7, code: 'OIL-0001', name: 'Soybean oil', unit: 'jar', item_type: 'product', track_stock: true } as unknown as Product
const line = (over = {}) => ({ ...emptyLine(), product: p, quantity: '10', price: '846.00', ...over })

test('blank and complete lines', () => {
  assert.equal(isBlankLine(emptyLine()), true)
  assert.equal(isBlankLine({ ...emptyLine(), quantity: '1' }), false)
  assert.equal(isCompleteLine(line()), true)
  for (const bad of [{ product: null }, { quantity: '0' }, { quantity: '1.2345' }, { price: '-1' }, { price: '' }, { discount_pct: '101' }, { discount_pct: 'x' }]) {
    assert.equal(isCompleteLine(line(bad)), false, JSON.stringify(bad))
  }
  assert.equal(isCompleteLine(line({ discount_pct: '100' })), true)
  assert.equal(isCompleteLine(line({ discount_pct: '2.5' })), true)
})

test('results and errors map between API line numbers and form rows when rows are skipped', () => {
  const rows = [line(), emptyLine(), line({ quantity: '' }), line()]
  const idx = completeIndexes(rows)
  assert.deepEqual(idx, [0, 3])
  const mapped = mapResults([{ line_no: 1, gross: '1', discount_amount: '0', tax_amount: '0', line_total: '1' }, { line_no: 2, gross: '2', discount_amount: '0', tax_amount: '0', line_total: '2' }], idx)
  assert.deepEqual(Object.keys(mapped), ['0', '3'])
  assert.equal(mapped[3]!.line_total, '2')
  assert.deepEqual(remapLineErrors({ 'lines.1.quantity': ['Too much'], 'lines.0.unit_cost': ['Bad'], 'lines.1.product_id': ['Inactive'], supplier_bill_no: ['Dup'] }, idx),
    { 'lines.3.quantity': ['Too much'], 'lines.0.price': ['Bad'], 'lines.3.product': ['Inactive'], supplier_bill_no: ['Dup'] })
})
