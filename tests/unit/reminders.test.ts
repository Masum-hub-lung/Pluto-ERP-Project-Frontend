import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { reminderLine } from '../../src/pages/customers/PaymentReminders'

test('PEP-516: a reminder in plain words', () => {
  const r = { id: 1, sent_at: '2026-11-16T04:00:00Z', trigger: 'manual' as const, email: 'a@b.example', invoices_count: 2, overdue_amount: '11000.00', sent_by: { id: 1, name: 'Masum' } }
  assert.equal(reminderLine(r), '16 Nov 2026 · by Masum · 2 invoices')
  assert.equal(reminderLine({ ...r, trigger: 'auto', sent_by: null, invoices_count: 1 }), '16 Nov 2026 · automatic · 1 invoice')
})
