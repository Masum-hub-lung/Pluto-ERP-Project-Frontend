import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionLabel, changes, humanize, timeAgo } from '../../src/lib/activity'

test('action and field labels read as plain English', () => {
  assert.equal(actionLabel('updated'), 'Edited')
  assert.equal(actionLabel('two_factor_enabled'), 'Two factor enabled')
  assert.equal(humanize('party_group_id'), 'Party group')
})

test('changes show old → new with money in lakh format and blanks as a dash', () => {
  const c = changes({ id: 1, action: 'updated', created_at: '2026-10-21T10:00:00+06:00',
    old_values: { credit_limit: '500000.00', email: null }, new_values: { credit_limit: '600000.00', email: 'a@b.example' } })
  assert.deepEqual(c, [
    { field: 'Credit limit', from: '৳ 5,00,000.00', to: '৳ 6,00,000.00' },
    { field: 'Email', from: '—', to: 'a@b.example' },
  ])
})

test('relative times', () => {
  const now = new Date('2026-10-21T12:00:00Z')
  assert.equal(timeAgo('2026-10-21T11:59:30Z', now), 'just now')
  assert.equal(timeAgo('2026-10-21T11:55:00Z', now), '5 min ago')
  assert.equal(timeAgo('2026-10-21T10:00:00Z', now), '2 h ago')
  assert.equal(timeAgo('2026-10-20T11:00:00Z', now), '1 day ago')
  assert.equal(timeAgo('2026-09-01T11:00:00Z', now), '1 Sept 2026')
})
