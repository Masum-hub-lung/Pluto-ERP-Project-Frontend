import assert from 'node:assert/strict'
import test from 'node:test'
import { periodText } from '../../src/lib/reportPeriod'

test('report period: as of a date, a range, or nothing', () => {
  assert.equal(periodText({ as_of: '2026-06-30' }), 'As of 30 Jun 2026')
  assert.equal(periodText({ from: '2025-07-01', to: '2026-06-30', prior_from: '2024-07-01' }), '1 Jul 2025 – 30 Jun 2026')
  assert.equal(periodText({}), '')
})
