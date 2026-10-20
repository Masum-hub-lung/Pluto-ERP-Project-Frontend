import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customerSchema, emptyCustomer, toPartyInput } from '../../src/lib/customerSchema'

const base = { ...emptyCustomer, name: 'Rahman Stores', mobile: '01711458230' }

test('BR-063: Bangladeshi mobile numbers have 11 digits starting 01', () => {
  for (const ok of ['01711458230', '01711-458230', '017 11 458230']) assert.equal(customerSchema.safeParse({ ...base, mobile: ok }).success, true, ok)
  for (const bad of ['0171145823', '02711458230', '+8801711458230', 'abc']) {
    const r = customerSchema.safeParse({ ...base, mobile: bad })
    assert.equal(r.success, false, bad)
    assert.equal(r.error?.issues[0]?.message, 'Mobile numbers have 11 digits starting 01')
  }
  assert.equal(customerSchema.safeParse({ ...base, mobile: '' }).error?.issues[0]?.message, 'Enter a mobile number')
})

test('name is required and money must be a decimal string with up to 2 decimals', () => {
  assert.equal(customerSchema.safeParse({ ...base, name: '  ' }).error?.issues[0]?.message, 'Enter the customer or supplier name')
  assert.equal(customerSchema.safeParse({ ...base, credit_limit: '500000.00' }).success, true)
  assert.equal(customerSchema.safeParse({ ...base, credit_limit: '5,00,000' }).success, false)
  assert.equal(customerSchema.safeParse({ ...base, credit_limit: '12.345' }).success, false)
  assert.equal(customerSchema.safeParse({ ...base, email: 'not-mail' }).success, false)
})

test('form values map to the PartyInput contract', () => {
  const parsed = customerSchema.parse({ ...base, mobile: '01711 458230', payment_term_id: '4', credit_limit: '500000.00', email: '' })
  assert.deepEqual(toPartyInput(parsed), {
    party_type: 'customer', name: 'Rahman Stores', category: null, party_group_id: null, contact_person: null, mobile: '01711-458230',
    email: null, alt_phone: null, address: null, district: null, area: null, payment_term_id: 4, credit_limit: '500000.00',
    price_tier: 'standard', tax_registration_no: null, notes: null,
  })
})
