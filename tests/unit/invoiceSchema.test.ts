import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Party, Product, SalesInvoice } from '../../src/api/contract.gen'
import { emptyLine } from '../../src/components/document/lines'
import { deliveryChanged, deliveryToForm, invoiceSchema, invoiceToForm, tierPrice, toDeliveryUpdate, toInvoiceInput, type InvoiceFormValues } from '../../src/lib/invoiceSchema'

const oil = { id: 7, code: 'PRD-0001', name: 'Soybean oil', unit: 'jar', track_stock: true, selling_price: '940.00', wholesale_price: '900.00' } as unknown as Product
const karim = { id: 3, code: 'CUS-0001', name: 'Karim Distributors', price_tier: 'standard' } as unknown as Party
const form = (over: Partial<InvoiceFormValues> = {}): InvoiceFormValues => ({
  party: karim, customer_po_ref: ' PO-2231 ', date: '2026-10-24', due_date: '', payment_term_id: '', warehouse_id: '2', notes: '', internal_note: '',
  challan_no: '', vehicle_no: '', delivered_at: '', lines: [{ ...emptyLine(), product: oil, quantity: '40', price: '940.00' }, emptyLine()], ...over,
})
const issues = (v: InvoiceFormValues) => { const r = invoiceSchema.safeParse(v); return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }

test('a complete invoice passes; blank lines are ignored', () => {
  assert.deepEqual(issues(form()), [])
})

test('customer, warehouse, due date and started lines are checked', () => {
  const out = issues(form({ party: null, warehouse_id: '', due_date: '2026-10-01' }))
  assert.ok(out.some((m) => m.startsWith('party:')))
  assert.ok(out.some((m) => m.startsWith('warehouse_id:')))
  assert.ok(out.some((m) => m.startsWith('due_date:')))
  assert.ok(issues(form({ lines: [{ ...emptyLine(), product: oil, quantity: '1', price: '9.999' }] })).some((m) => m.startsWith('lines.0.price:')), 'prices have 2 decimals')
  assert.deepEqual(issues(form({ lines: [emptyLine()] })), ['lines.0.product: Add at least one item'])
})

test('tierPrice picks the wholesale price only for wholesale customers that have one', () => {
  assert.equal(tierPrice(oil, karim), '940.00')
  assert.equal(tierPrice(oil, { ...karim, price_tier: 'wholesale' } as Party), '900.00')
  assert.equal(tierPrice({ ...oil, wholesale_price: null } as Product, { ...karim, price_tier: 'wholesale' } as Party), '940.00')
  assert.equal(tierPrice(oil, null), '940.00')
})

test('toInvoiceInput sends only complete lines, as strings', () => {
  const input = toInvoiceInput(form({ payment_term_id: '5', lines: [emptyLine(), { ...emptyLine(), product: oil, quantity: '10', price: '950.00', discount_pct: '2', tax_rule_id: '4' }] }))
  assert.equal(input.customer_po_ref, 'PO-2231')
  assert.equal(input.due_date, null)
  assert.equal(input.payment_term_id, 5)
  assert.equal(input.warehouse_id, 2)
  assert.deepEqual(input.lines, [{ product_id: 7, description: null, quantity: '10', unit_price: '950.00', discount_pct: '2', tax_rule_id: 4 }])
})

test('delivery details round-trip and only changes need a PATCH', () => {
  const stored = { challan_no: 'DC-2026-0412', vehicle_no: null, delivered_at: '2026-10-24T09:30:00+00:00' }
  const f = deliveryToForm(stored)
  assert.equal(f.challan_no, 'DC-2026-0412')
  assert.equal(f.vehicle_no, '')
  assert.equal(new Date(f.delivered_at).toISOString(), '2026-10-24T09:30:00.000Z', 'local time of the same instant')
  assert.equal(deliveryChanged(form(f), stored), false)
  assert.equal(deliveryChanged(form({ ...f, vehicle_no: 'Dhaka Metro-Ta 11-2233' }), stored), true)
  assert.equal(deliveryChanged(form(), null), false)
  assert.deepEqual(toDeliveryUpdate({ challan_no: ' ', vehicle_no: '', delivered_at: '' }), { challan_no: null, vehicle_no: null, delivered_at: null })
})

test('invoiceToForm restores a stored draft', () => {
  const inv = { customer_po_ref: 'PO-1', invoice_date: '2026-10-20', due_date: '2026-11-19', warehouse_id: 2, delivery: null,
    lines: [{ product_id: 7, product_code: 'PRD-0001', product_name: 'Soybean oil', unit: 'jar', description: null, quantity: '10.000', unit_price: '940.00', discount_pct: '0.0000', tax_rule_id: null }] } as unknown as SalesInvoice
  const v = invoiceToForm(inv, karim, '2026-10-24')
  assert.equal(v.date, '2026-10-20')
  assert.equal(v.lines[0]!.price, '940.00')
  assert.equal(v.lines[0]!.discount_pct, '')
  assert.equal(invoiceToForm(null, null, '2026-10-24').date, '2026-10-24')
})
