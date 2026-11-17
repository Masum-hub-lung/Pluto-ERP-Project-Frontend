import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { PayrollLine } from '../../src/api/contract.gen'
import { bonusInput, lastMonth, lineChanges, sheetTitle } from '../../src/pages/payroll/SalarySheets'

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

test('PEP-523: the advance to take back is sent like the other amounts', () => {
  assert.deepEqual(lineChanges([line(1)], { 1: { advance_recovery: '1500' } }).changes, [{ id: 1, advance_recovery: '1500' }])
})

test('PEP-524: the bonus dialog sends a % of basic or a fixed amount, and catches bad values', () => {
  const f = { festival: ' Eid-ul-Fitr ', month: '2027-03', pay_date: '', basis: 'percent' as const, value: '100', min_service_months: '12' }
  assert.deepEqual(bonusInput(f).input, { kind: 'bonus', month: '2027-03', pay_date: null, notes: 'Eid-ul-Fitr', min_service_months: 12, bonus_percent: '100' })
  assert.deepEqual(bonusInput({ ...f, basis: 'fixed', value: '5000', festival: '', pay_date: '2027-03-25' }).input,
    { kind: 'bonus', month: '2027-03', pay_date: '2027-03-25', notes: null, min_service_months: 12, bonus_amount: '5000' })
  assert.equal(bonusInput({ ...f, value: '0' }).bad, 'Enter a percentage of basic above 0, up to 500')
  assert.equal(bonusInput({ ...f, value: '501' }).bad, 'Enter a percentage of basic above 0, up to 500')
  assert.equal(bonusInput({ ...f, basis: 'fixed', value: 'abc' }).bad, 'Enter the bonus amount, above 0')
  assert.equal(bonusInput({ ...f, min_service_months: '1.5' }).bad, 'Enter the minimum service in whole months, 0 to 120')
  assert.equal(bonusInput({ ...f, month: '' }).bad, 'Choose the month')
})

test('PEP-524: a bonus sheet is titled with its festival', () => {
  assert.equal(sheetTitle({ kind: 'bonus', label: 'Festival bonus, March 2027', notes: 'Eid-ul-Fitr' }), 'Festival bonus, March 2027 · Eid-ul-Fitr')
  assert.equal(sheetTitle({ kind: 'salary', label: 'Salaries, March 2027', notes: 'late' }), 'Salaries, March 2027')
})
