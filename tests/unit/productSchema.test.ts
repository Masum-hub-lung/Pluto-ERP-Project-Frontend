import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyProduct, productSchema, toProductInput, trimZeros } from '../../src/lib/productSchema'

const values = (over: Record<string, unknown> = {}) => productSchema.parse({
  ...emptyProduct, name: ' Soybean oil 5L jar ', unit_id: '4', selling_price: '920.00', income_ledger_id: '31',
  warehouses: [{ warehouse_id: 1, name: 'Tejgaon', reorder_level: '20', reorder_qty: '' }, { warehouse_id: 2, name: 'Narayanganj', reorder_level: '', reorder_qty: '' }],
  ...over,
})

test('a product: decimal strings kept as text, empties become null, every warehouse row sent', () => {
  const input = toProductInput(values({ code: 'oil-9', wholesale_price: '900', last_purchase_cost: '845.5' }), 'add')
  assert.equal(input.name, 'Soybean oil 5L jar')
  assert.equal(input.code, 'OIL-9')
  assert.equal(input.selling_price, '920.00')
  assert.equal(input.wholesale_price, '900')
  assert.equal(input.last_purchase_cost, '845.5')
  assert.equal(input.barcode, null)
  assert.equal(input.category_id, null)
  assert.equal(input.expense_ledger_id, null)
  assert.deepEqual(input.warehouses, [{ warehouse_id: 1, reorder_level: '20', reorder_qty: '0' }, { warehouse_id: 2, reorder_level: '0', reorder_qty: '0' }])
})

test('a service sends no warehouse rows and no purchase cost (CF-09)', () => {
  const input = toProductInput(values({ item_type: 'service', last_purchase_cost: '10', expense_ledger_id: '40' }), 'add')
  assert.equal(input.warehouses, undefined)
  assert.equal(input.last_purchase_cost, null)
  assert.equal(input.expense_ledger_id, 40)
})

test('on edit an empty code and an unchosen expense account are not sent', () => {
  const input = toProductInput(values({ code: '' }), 'edit')
  assert.equal(input.code, undefined)
  assert.equal('expense_ledger_id' in input, false)
  assert.equal(toProductInput(values({ code: '' }), 'add').code, undefined)
})

test('shape checks: required fields and decimal places', () => {
  const r = productSchema.safeParse({ ...emptyProduct, selling_price: '9.999', warehouses: [{ warehouse_id: 1, name: 'T', reorder_level: '1.2345', reorder_qty: '' }] })
  assert.equal(r.success, false)
  const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'))
  for (const p of ['name', 'unit_id', 'income_ledger_id', 'selling_price', 'warehouses.0.reorder_level']) assert.ok(paths.includes(p), `${p} in ${paths}`)
})

test('trimZeros shows API quantities without trailing zeros, and zero as empty', () => {
  assert.equal(trimZeros('20.000'), '20')
  assert.equal(trimZeros('12.500'), '12.5')
  assert.equal(trimZeros('0.000'), '')
  assert.equal(trimZeros(null), '')
  assert.equal(trimZeros('100'), '100')
})
