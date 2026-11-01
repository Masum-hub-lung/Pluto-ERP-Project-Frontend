import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chargeLabel, lcActions, lcEditable, lcLive } from '../../src/api/lc'
import type { Party } from '../../src/api/contract.gen'
import { editBody, lcSchema, lcToForm, missingForSubmit, toLcInput, trimPct } from '../../src/lib/lcSchema'
import { billToForm, toBillInput } from '../../src/lib/billSchema'

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
