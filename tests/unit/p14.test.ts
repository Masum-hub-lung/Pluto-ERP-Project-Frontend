import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportFilters, listSource, reportSource } from '../../src/api/exports'
import { greeting } from '../../src/pages/dashboard/common'
import { dayLabel } from '../../src/pages/notifications/NotificationCentre'
import { lastMonth } from '../../src/pages/reports/ReportsCentre'

test('export sources are the contract operationIds', () => {
  assert.equal(reportSource('trial-balance'), 'getReportsTrialBalance')
  assert.equal(reportSource('inventory/low-stock'), 'getReportsInventoryLowStock')
  assert.equal(listSource('/sales-invoices'), 'getSalesInvoices')
  assert.equal(listSource('/ie-entries'), 'getIeEntries')
})

test('export filters drop empties and paging, and become strings', () => {
  assert.deepEqual(exportFilters({ q: '', status: 'posted', party_id: 12, page: 3, per_page: 25, date_to: undefined, flag: false }),
    { status: 'posted', party_id: '12', flag: 'false' })
})

test('the month-end pack defaults to last month', () => {
  assert.equal(lastMonth('2026-11-01'), '2026-10')
  assert.equal(lastMonth('2027-01-15'), '2026-12')
})

test('greeting follows the Dhaka clock and the first name', () => {
  assert.equal(greeting('Rafiq Hasan', new Date('2026-11-01T02:00:00Z')), 'Good morning, Rafiq') // 08:00 Dhaka
  assert.equal(greeting('Rafiq Hasan', new Date('2026-11-01T08:00:00Z')), 'Good afternoon, Rafiq') // 14:00
  assert.equal(greeting(undefined, new Date('2026-11-01T14:00:00Z')), 'Good evening') // 20:00
})

test('notification days read Today, Yesterday, then the date', () => {
  assert.equal(dayLabel('2026-11-01', '2026-11-01'), 'Today')
  assert.equal(dayLabel('2026-10-31', '2026-11-01'), 'Yesterday')
  assert.match(dayLabel('2026-10-28', '2026-11-01'), /^Wednesday,? 28 October 2026$/) // the comma differs between ICU versions
})
