import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { chosenLines } from '../../src/pages/payroll/SalaryPayments'

test('PEP-522: chosen amounts become payment lines; blanks and zeros are skipped; bad amounts stop', () => {
  assert.deepEqual(chosenLines({ 3: '15000', 4: '', 5: '0' }), [{ payroll_line_id: 3, amount: '15000' }])
  assert.equal(chosenLines({ 3: '12.345' }), null)
  assert.deepEqual(chosenLines({}), [])
})
