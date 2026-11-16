import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { emptyEmployee, toEmployeeInput } from '../../src/lib/employeeSchema'
import { payLabel } from '../../src/pages/payroll/Employees'

test('PEP-520: employee form → input (blank optional fields are null; account only for bank or wallet)', () => {
  const v = { ...emptyEmployee, name: 'Rahim', joining_date: '2025-01-01', basic_salary: '15000', pay_method: 'cash' as const, account_no: '0171' }
  const i = toEmployeeInput(v)
  assert.equal(i.designation, null)
  assert.equal(i.house_rent, null)
  assert.equal(i.account_no, null)
  assert.equal(toEmployeeInput({ ...v, pay_method: 'mobile' }).account_no, '0171')
})

test('PEP-520: how an employee is paid, in words', () => {
  assert.equal(payLabel({ pay_method: 'cash', bank_name: null, account_no: null }), 'Cash')
  assert.equal(payLabel({ pay_method: 'bank', bank_name: 'Dutch-Bangla Bank', account_no: '123' }), 'Dutch-Bangla Bank · 123')
  assert.equal(payLabel({ pay_method: 'mobile', bank_name: null, account_no: '01711' }), 'Mobile wallet · 01711')
})
