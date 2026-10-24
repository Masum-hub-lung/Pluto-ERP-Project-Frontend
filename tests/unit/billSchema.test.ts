import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Party, Product, PurchaseBill } from '../../src/api/contract.gen'
import { emptyLine } from '../../src/components/document/lines'
import { billSchema, billToForm, toBillInput, type BillFormValues } from '../../src/lib/billSchema'

const p = { id: 7, code: 'OIL-0001', name: 'Soybean oil', unit: 'jar', track_stock: true } as unknown as Product
const sup = { id: 3, code: 'SUP-0001', name: 'Bengal Edible Oils' } as unknown as Party
const form = (over: Partial<BillFormValues> = {}): BillFormValues => ({
  party: sup, supplier_bill_no: ' CST-0918 ', date: '2026-10-24', due_date: '', warehouse_id: '2', notes: '', internal_note: '',
  lines: [{ ...emptyLine(), product: p, quantity: '10', price: '846.00' }, emptyLine()], ...over,
})
const issues = (v: BillFormValues) => { const r = billSchema.safeParse(v); return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }

test('a complete bill passes; blank lines are ignored', () => {
  assert.deepEqual(issues(form()), [])
})

test('missing supplier, bill number and warehouse are reported', () => {
  const out = issues(form({ party: null, supplier_bill_no: ' ', warehouse_id: '' }))
  assert.ok(out.some((m) => m.startsWith('party:')))
  assert.ok(out.some((m) => m.startsWith('supplier_bill_no:')))
  assert.ok(out.some((m) => m.startsWith('warehouse_id:')))
})

test('due date before bill date, started lines and no lines', () => {
  assert.ok(issues(form({ due_date: '2026-10-01' })).some((m) => m.startsWith('due_date:')))
  assert.ok(issues(form({ lines: [{ ...emptyLine(), product: p, quantity: '0', price: '1' }] })).some((m) => m.startsWith('lines.0.quantity:')))
  assert.ok(issues(form({ lines: [{ ...emptyLine(), quantity: '2' }] })).some((m) => m.startsWith('lines.0.product:')))
  assert.deepEqual(issues(form({ lines: [emptyLine()] })), ['lines.0.product: Add at least one item'])
})

test('toBillInput sends only complete lines, as strings', () => {
  const input = toBillInput(form({ lines: [emptyLine(), { ...emptyLine(), product: p, quantity: '10', price: '846.00', tax_rule_id: '4' }] }))
  assert.equal(input.supplier_bill_no, 'CST-0918')
  assert.equal(input.due_date, null)
  assert.equal(input.warehouse_id, 2)
  assert.deepEqual(input.lines, [{ product_id: 7, description: null, quantity: '10', unit_cost: '846.00', discount_pct: undefined, tax_rule_id: 4 }])
})

test('billToForm restores a stored draft', () => {
  const b = { supplier_bill_no: 'CST-1', bill_date: '2026-10-20', due_date: '2026-11-19', warehouse_id: 2,
    lines: [{ product_id: 7, product_code: 'OIL-0001', product_name: 'Soybean oil', unit: 'jar', description: null, quantity: '10.000', unit_cost: '846.0000', discount_pct: '0.0000', tax_rule_id: null }] } as unknown as PurchaseBill
  const v = billToForm(b, sup, '2026-10-24')
  assert.equal(v.date, '2026-10-20')
  assert.equal(v.lines[0]!.product!.code, 'OIL-0001')
  assert.equal(v.lines[0]!.discount_pct, '')
  assert.equal(billToForm(null, null, '2026-10-24').date, '2026-10-24')
})
