import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { helpFor, whatsappLink } from '../../src/lib/help'

test('PEP-510: the help topic is the longest matching path', () => {
  assert.equal(helpFor('/sales/invoices/new').title, 'Write a sales invoice')
  assert.equal(helpFor('/sales/invoices/12').title, 'Sales')
  assert.equal(helpFor('/lc/new').title, 'Open a letter of credit')
  assert.equal(helpFor('/lc/12?tab=terms').title, 'Letters of credit')
  assert.equal(helpFor('/settings/users').title, 'Users and roles')
  assert.equal(helpFor('/settings/tax').title, 'Settings')
  assert.equal(helpFor('/salesx').title, 'Using Pluto')
  assert.equal(helpFor('/').title, 'Using Pluto')
})

test('PEP-510: WhatsApp link carries the company and page, and hides without a number', () => {
  assert.equal(whatsappLink('Babsaik Sheba', '/sales', ''), null)
  const url = whatsappLink('Babsaik Sheba', '/sales', '+880 1711-000000')!
  assert.ok(url.startsWith('https://wa.me/8801711000000?text='))
  assert.ok(decodeURIComponent(url).includes('Company: Babsaik Sheba. Page: /sales.'))
})
