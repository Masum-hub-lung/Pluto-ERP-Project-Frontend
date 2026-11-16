import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { PayrollLine } from '../../src/api/contract.gen'
import { lastMonth, lineChanges } from '../../src/pages/payroll/SalarySheets'

const line = (id: number, over = '0.00'): PayrollLine => ({ id, employee_id: id, employee_code: `EMP-000${id}`, employee_name: `E${id}`, designation: null, days_in_month: 30, days_paid: 30,
  basic_salary: '1000.00', house_rent: '0.00', medical: '0.00', conveyance: '0.00', overtime: over, other_earnings: '0.00', deductions: '0.00', advance_recovery: '0.00',
  gross: '1000.00', net: '1000.00', paid_amount: '0.00', note: null })

test('PEP-521: only changed lines are sent; blank is 0; bad amounts are caught', () => {
  assert.deepEqual(lineChanges([line(1), line(2)], { 1: { overtime: '500' }, 2: { overtime: '0.00' } }).changes, [{ id: 1, overtime: '500' }])
  assert.deepEqual(lineChanges([line(1, '200.00')], { 1: { overtime: '' } }).changes, [{ id: 1, overtime: '0' }])
  assert.equal(lineChanges([line(1)], { 1: { deductions: '-5' } }).bad, 'E1: enter an amount of 0 or more with up to 2 decimals')
  assert.deepEqual(lineChanges([line(1)], { 1: { note: ' late ' } }).changes, [{ id: 1, note: 'late' }])
})

test('PEP-521: the usual month to prepare is last month', () => {
  assert.equal(lastMonth(new Date('2026-11-16T10:00:00Z')), '2026-10')
  assert.equal(lastMonth(new Date('2027-01-05T10:00:00Z')), '2026-12')
})
