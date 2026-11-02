import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrubEvent, stripQuery } from '../../src/lib/monitoring'

test('URLs lose query strings and fragments before they reach Sentry', () => {
  assert.equal(stripQuery('/api/v1/parties?q=Karim%20Store&type=customer'), '/api/v1/parties')
  assert.equal(stripQuery('https://x.example/sales/invoices/12#payments'), 'https://x.example/sales/invoices/12')
  assert.equal(stripQuery('/dashboard'), '/dashboard')
})

test('an error event keeps no request, user, extra data or bodies', () => {
  const e = scrubEvent({
    message: 'boom', request: { url: '/x', data: '{"amount":"5000.00"}' }, user: { email: 'owner@meghna.example' }, extra: { total: '5000.00' },
    breadcrumbs: [{ data: { url: '/api/v1/sales-invoices?q=Rahim', body: '{"party":"Rahim"}', response: '{}' } }, { message: 'click' }],
  })
  assert.equal('request' in e, false)
  assert.equal('user' in e, false)
  assert.equal('extra' in e, false)
  assert.deepEqual(e.breadcrumbs?.[0]?.data, { url: '/api/v1/sales-invoices' })
  assert.equal(e.message, 'boom')
})
