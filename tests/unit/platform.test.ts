import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentFiscalYear, dhakaToday } from '../../src/api/platform'

const fy = (name: string, start: string, end: string) => ({ id: 1, name, start_date: start, end_date: end, status: 'open' as const, periods: [] })

test('the current financial year is the one containing today (July–June)', () => {
  const years = [fy('FY 2026-27', '2026-07-01', '2027-06-30'), fy('FY 2025-26', '2025-07-01', '2026-06-30')]
  assert.equal(currentFiscalYear(years, '2026-10-21')?.name, 'FY 2026-27')
  assert.equal(currentFiscalYear(years, '2026-06-30')?.name, 'FY 2025-26')
  assert.equal(currentFiscalYear(years, '2027-07-01'), undefined)
})

test('today is taken in Dhaka time', () => {
  assert.equal(dhakaToday(new Date('2026-06-30T19:30:00Z')), '2026-07-01') // 01:30 in Dhaka
})
