import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { hasModule, moduleForPath, moduleForPermission } from '../../src/lib/modules'

test('hasModule: missing list = everything (older API); finance needs LC management', () => {
  assert.equal(hasModule(undefined, 'lc_finance'), true)
  assert.equal(hasModule([], 'lc_management'), false)
  assert.equal(hasModule(['lc_management'], 'lc_management'), true)
  assert.equal(hasModule(['lc_management'], 'lc_finance'), false)
  assert.equal(hasModule(['lc_finance'], 'lc_finance'), false)
  assert.equal(hasModule(['lc_finance', 'lc_management'], 'lc_finance'), true)
})

test('moduleForPath: LC portal pages and the finance pages inside it', () => {
  assert.equal(moduleForPath('/lc'), 'lc_management')
  assert.equal(moduleForPath('/lc/12?tab=terms'), 'lc_management')
  assert.equal(moduleForPath('/lc/loans/4'), 'lc_finance')
  assert.equal(moduleForPath('/lc/banks'), 'lc_finance')
  assert.equal(moduleForPath('/lc/fx-revaluation'), 'lc_finance')
  assert.equal(moduleForPath('/lcx'), null)
  assert.equal(moduleForPath('/purchases/bills'), null)
})

test('moduleForPermission: lc.* permissions are LC management', () => {
  assert.equal(moduleForPermission('lc.view'), 'lc_management')
  assert.equal(moduleForPermission('purchases.view'), null)
})

test('PEP-520: payroll is a plan module', () => {
  assert.equal(moduleForPath('/payroll/employees'), 'payroll')
  assert.equal(moduleForPermission('payroll.view'), 'payroll')
  assert.equal(hasModule(['payroll'], 'payroll'), true)
  assert.equal(hasModule(['lc_management'], 'payroll'), false)
})
