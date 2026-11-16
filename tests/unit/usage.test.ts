import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ago, workLine } from '../../src/pages/platform/UsageCell'

test('PEP-512: last sign-in in plain words', () => {
  const now = new Date('2026-11-16T10:00:00Z')
  assert.equal(ago(null, now), 'Never signed in')
  assert.equal(ago('2026-11-16T03:00:00Z', now), 'Signed in today')
  assert.equal(ago('2026-11-15T09:00:00Z', now), 'Signed in yesterday')
  assert.equal(ago('2026-11-06T10:00:00Z', now), 'Signed in 10 days ago')
  assert.equal(ago('2026-08-01T10:00:00Z', now), 'Signed in 3 months ago')
})

test("PEP-512: this month's work line", () => {
  const u = { invoices_this_month: 0, bills_this_month: 0, vouchers_this_month: 0, active_people_30d: 0, quiet: true, last_sign_in_at: null }
  assert.equal(workLine(u), 'Nothing entered this month')
  assert.equal(workLine({ ...u, invoices_this_month: 1, vouchers_this_month: 4 }), 'This month: 1 invoice, 4 vouchers')
  assert.equal(workLine({ ...u, bills_this_month: 2 }), 'This month: 2 bills')
})
