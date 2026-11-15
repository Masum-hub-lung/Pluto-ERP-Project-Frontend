import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { billingLabel } from '../../src/pages/platform/BillingPanel'

test('PEP-503: billing badge text and tone come from the API status and days left', () => {
  const b = (status: 'not_billed' | 'paid' | 'due_soon' | 'overdue' | 'suspended', days_left: number | null = null) => ({ status, days_left, grace_days: 7 })
  assert.deepEqual(billingLabel(b('not_billed')), { tone: 'neutral', text: 'Not billed' })
  assert.deepEqual(billingLabel(b('paid', 40)), { tone: 'positive', text: 'Paid' })
  assert.deepEqual(billingLabel(b('due_soon', 0)), { tone: 'warning', text: 'Due today' })
  assert.deepEqual(billingLabel(b('due_soon', 1)), { tone: 'warning', text: 'Due in 1 day' })
  assert.deepEqual(billingLabel(b('due_soon', 6)), { tone: 'warning', text: 'Due in 6 days' })
  assert.deepEqual(billingLabel(b('overdue', -1)), { tone: 'negative', text: 'Overdue 1 day' })
  assert.deepEqual(billingLabel(b('overdue', -3)), { tone: 'negative', text: 'Overdue 3 days' })
  assert.deepEqual(billingLabel(b('suspended', -9)), { tone: 'negative', text: 'Paused (unpaid)' })
  assert.deepEqual(billingLabel(undefined), { tone: 'neutral', text: '—' })
})
