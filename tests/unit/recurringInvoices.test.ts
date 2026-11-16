import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { nextDate, scheduleLine } from '../../src/pages/sales/RecurringInvoices'

test('PEP-517: the next date steps like the server (no month overflow)', () => {
  assert.equal(nextDate('2026-11-16', 'monthly'), '2026-12-16')
  assert.equal(nextDate('2027-01-31', 'monthly'), '2027-02-28')
  assert.equal(nextDate('2026-11-30', 'quarterly'), '2027-02-28')
  assert.equal(nextDate('2028-02-29', 'yearly'), '2029-02-28')
  assert.equal(nextDate('2026-12-28', 'weekly'), '2027-01-04')
})

test('PEP-517: the schedule in plain words', () => {
  assert.equal(scheduleLine({ frequency: 'monthly', ends_type: 'never' }), 'Every month, until stopped')
  assert.equal(scheduleLine({ frequency: 'quarterly', ends_type: 'after_count', ends_after_count: 4 }), 'Every 3 months, 4 times in all')
  assert.equal(scheduleLine({ frequency: 'yearly', ends_type: 'on_date', ends_on: '2030-06-30' }), 'Every year, until 30 Jun 2030')
})
