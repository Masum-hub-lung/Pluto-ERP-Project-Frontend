import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chargeLabel, lcActions, lcEditable, lcLive } from '../../src/api/lc'
import type { Party } from '../../src/api/contract.gen'
import { editBody, lcSchema, lcToForm, missingForSubmit, toLcInput, trimPct } from '../../src/lib/lcSchema'
import { billToForm, toBillInput } from '../../src/lib/billSchema'
import { itemErrors, itemNames, itemProblems, sentIndexes } from '../../src/lib/lcItems'

const straits = { id: 7, name: 'Straits Edible Oils' } as Party

function filled() {
  const v = lcToForm(null, straits)
  return { ...v, goods_description: '20,000 kg crude palm oil', amount: '38400.00', planning_rate: '121.50', tolerance_pct: '5', margin_pct: '20',
    issuing_bank_account_id: '3', expiry_date: '2026-12-31', incoterm: 'CFR Chattogram' }
}

test('a new LC form starts fresh with a two-document checklist', () => {
  const a = lcToForm(null, null)
  const b = lcToForm(null, null)
  assert.notEqual(a, b)
  assert.notEqual(a.documents, b.documents)
  assert.deepEqual(a.documents.map((d) => d.name), ['Bill of lading', 'Commercial invoice'])
  assert.equal(a.tenor, 'sight')
})

test('the LC body carries the API field names and only what applies', () => {
  const body = toLcInput(filled(), true)
  assert.equal(body.party_id, 7)
  assert.equal(body.amount, '38400.00')
  assert.equal(body.planning_rate, '121.50')
  assert.equal(body.usance_days, null)
  assert.equal(body.issuing_bank_account_id, 3)
  assert.equal(body.purchase_order_id, null)
  assert.deepEqual(body.documents?.map((d) => d.copies), [3, 3])
  assert.equal('shipment' in body, false)
  const withTemplate = toLcInput({ ...filled(), document_template_id: '4' }, true)
  assert.equal(withTemplate.document_template_id, 4)
  assert.equal('documents' in withTemplate, false)
  const edit = toLcInput(filled(), false)
  assert.equal('documents' in edit, false)
  assert.equal('record_shipments' in edit, false)
})

test('an edit sends fields the LC resource does not return only when the user changed them', () => {
  const input = toLcInput(filled(), false)
  const untouched = editBody(input, {})
  for (const k of ['lc_type', 'partial_shipments', 'advising_bank', 'margin_account_id', 'application_date', 'purchase_order_id', 'intended_import']) assert.equal(k in untouched, false, k)
  assert.equal(untouched.amount, '38400.00')
  const touched = editBody(input, { partial_shipments: true, link: true })
  assert.equal(touched.partial_shipments, false)
  assert.equal('purchase_order_id' in touched, true)
})

test('usance needs its days; dates must be in order', () => {
  assert.equal(lcSchema.safeParse(filled()).success, true)
  const r = lcSchema.safeParse({ ...filled(), tenor: 'usance', usance_days: '' })
  assert.equal(r.success, false)
  const d = lcSchema.safeParse({ ...filled(), application_date: '2026-12-31', expiry_date: '2026-12-01' })
  assert.equal(d.success, false)
})

test('the review lists what a submit still needs (BR-039)', () => {
  assert.deepEqual(missingForSubmit(filled()), [])
  assert.deepEqual(missingForSubmit({ ...lcToForm(null, null), amount: '0' }), ['Supplier', 'LC amount', 'Issuing bank', 'Expiry date'])
})

test('labels and status actions are display only', () => {
  assert.equal(trimPct('5.0000'), '5')
  assert.equal(trimPct('2.5000'), '2.5')
  assert.equal(chargeLabel('cf_agent_fee'), 'C&F agent fee')
  assert.equal(chargeLabel('something_new'), 'something new')
  assert.deepEqual(lcActions('awaiting_bank').map((a) => a.action), ['mark_opened', 'mark_refused', 'cancel'])
  assert.deepEqual(lcActions('payment_due'), [])
  assert.equal(lcEditable('opened'), false)
  assert.equal(lcLive('partly_shipped'), true)
})

test('an import bill sends the LC, lot and currency; a blank rate is left to the server', () => {
  const v = { ...billToForm(null, straits, '2026-11-01', '2'), supplier_bill_no: 'SEO-CI-88', letter_of_credit_id: '5', lc_shipment_id: '9', currency_code: 'USD', exchange_rate: '' }
  const body = toBillInput(v)
  assert.equal(body.letter_of_credit_id, 5)
  assert.equal(body.lc_shipment_id, 9)
  assert.equal(body.currency_code, 'USD')
  assert.equal('exchange_rate' in body, false)
  const local = toBillInput({ ...v, letter_of_credit_id: '', currency_code: 'BDT' })
  assert.equal('letter_of_credit_id' in local, false)
  assert.equal('currency_code' in local, false)
})

test('LC finance lives inside the LC portal: banks, loans and FX revaluation (the last needs accounting.view)', async () => {
  const { visibleNav } = await import('../../src/app/nav')
  const lcChildren = (perms: string[]) => visibleNav((p: string) => perms.includes(p)).flatMap((s) => s.items).find((i) => i.label === 'LC Management')!.children!.map((c) => c.path)
  const full = lcChildren(['lc.view', 'lc.create', 'accounting.view'])
  for (const p of ['/lc/banks', '/lc/loans', '/lc/fx-revaluation']) assert.ok(full.includes(p), p)
  assert.ok(!lcChildren(['lc.view']).includes('/lc/fx-revaluation'))
  assert.ok(lcChildren(['lc.view']).includes('/lc/loans'))
})

test('loan and financing labels', async () => {
  const { FINANCED_BY, LOAN_KIND, LOAN_STATUS } = await import('../../src/api/lcFinance')
  assert.equal(FINANCED_BY.own, 'Own funds')
  assert.equal(FINANCED_BY.ltr, 'Bank finance (LTR)')
  assert.equal(LOAN_KIND.pad, 'PAD')
  assert.equal(LOAN_STATUS.repaid!.tone, 'positive')
})

// ---- Items on the LC (PEP-487)
const oil = { id: 11, code: 'P-011', name: 'Crude palm oil', unit: 'kg', unit_id: 2, track_stock: true } as never
const ghee = { id: 12, code: 'P-012', name: 'Vegetable ghee', unit: 'kg', unit_id: 2, track_stock: true } as never

test('a new LC enters its items by default and sends only the rows that were filled', () => {
  const v = lcToForm(null, straits)
  assert.equal(v.link, 'items')
  assert.equal(v.lines.length, 1)
  assert.deepEqual(toLcInput(filled(), true).lines, [])
  const rows = [{ product: oil, unit_id: '2', quantity: ' 20000 ', unit_cost: '1.92', description: '' }, { product: null, unit_id: '', quantity: '', unit_cost: '', description: '' },
    { product: ghee, unit_id: '', quantity: '2000', unit_cost: '2.5', description: ' In 16 kg tins ' }]
  const body = toLcInput({ ...filled(), lines: rows, warehouse_id: '4' }, true)
  assert.deepEqual(body.lines, [{ product_id: 11, quantity: '20000', unit_cost: '1.92', unit_id: 2 }, { product_id: 12, quantity: '2000', unit_cost: '2.5', description: 'In 16 kg tins' }])
  assert.equal(body.warehouse_id, 4)
  assert.equal(body.purchase_order_id, null)
  assert.deepEqual(sentIndexes(rows), [0, 2])
  assert.equal(itemNames(rows), 'Crude palm oil, Vegetable ghee')
  // An existing purchase order instead: no items are sent.
  const po = toLcInput({ ...filled(), link: 'po', purchase_order_id: '9', lines: rows }, true)
  assert.equal(po.purchase_order_id, 9)
  assert.equal('lines' in po, false)
})

test('a started item needs an item, a quantity above 0 and a cost; blank rows are ignored', () => {
  assert.equal(lcSchema.safeParse(filled()).success, true)
  const bad = lcSchema.safeParse({ ...filled(), lines: [{ product: null, unit_id: '', quantity: '0', unit_cost: 'x', description: '' }] })
  assert.equal(bad.success, false)
  assert.deepEqual(bad.error?.issues.map((i) => i.path.join('.')).sort(), ['lines.0.product', 'lines.0.quantity', 'lines.0.unit_cost'])
  assert.deepEqual(itemProblems({ product: oil, unit_id: '', quantity: '1.5', unit_cost: '0', description: '' }), {})
  // The same rows are not checked when an existing order is chosen.
  assert.equal(lcSchema.safeParse({ ...filled(), link: 'po', lines: [{ product: null, unit_id: '', quantity: '0', unit_cost: 'x', description: '' }] }).success, true)
})

test('an edit shows the stored items and sends them only when touched', () => {
  const lc = { items_source: 'entered', purchase_order_id: 31, warehouse_id: 4, goods_description: 'Oil', tolerance_pct: '5.0000', margin_pct: '0.0000',
    lines: [{ id: 91, line_no: 1, product_id: 11, product_code: 'P-011', product_name: 'Crude palm oil', unit: 'kg', unit_id: 2, quantity: '20000.000', unit_cost: '1.9200',
      line_total: '38400.00', received_quantity: '0.000', remaining_quantity: '20000.000' }] } as never
  const v = lcToForm(lc, straits)
  assert.deepEqual([v.link, v.purchase_order_id, v.warehouse_id], ['items', '', '4'])
  assert.deepEqual(v.lines.map((r) => [r.product?.id, r.unit_id, r.quantity, r.unit_cost]), [[11, '2', '20000.000', '1.9200']])
  const input = toLcInput({ ...v, amount: '38400.00', planning_rate: '121.50' }, false)
  const untouched = editBody(input, {})
  assert.equal('lines' in untouched, false)
  assert.equal('warehouse_id' in untouched, false)
  const touched = editBody(input, { lines: true })
  assert.equal(touched.lines?.length, 1)
  assert.equal('purchase_order_id' in touched, false)
  // An LC raised against an existing order keeps that link.
  assert.equal(lcToForm({ ...(lc as object), items_source: 'purchase_order' } as never, straits).link, 'po')
})

test('422 line errors go back to the rows that were sent', () => {
  const rows = [{ product: null, unit_id: '', quantity: '', unit_cost: '', description: '' }, { product: oil, unit_id: '', quantity: '1', unit_cost: '1', description: '' }]
  assert.deepEqual(itemErrors({ 'lines.0.product_id': ['Crude palm oil is inactive'], 'lines.0.unit_id': ['kg only'], amount: ['x'] }, sentIndexes(rows)),
    { '1.product': 'Crude palm oil is inactive', '1.unit_id': 'kg only' })
})
