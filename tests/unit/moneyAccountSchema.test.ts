import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyMoneyAccount, moneyAccountSchema, toMoneyAccountInput, type MoneyAccountFormValues } from '../../src/lib/moneyAccountSchema'

const issues = (v: MoneyAccountFormValues) => { const r = moneyAccountSchema.safeParse(v); return r.success ? [] : r.error.issues.map((i) => i.path.join('.')) }
const sonali = (over: Partial<MoneyAccountFormValues> = {}): MoneyAccountFormValues => ({
  ...emptyMoneyAccount('bank'), bank_name: 'Sonali Bank', account_name: 'Meghna Traders Ltd.', account_number: '0012-3400-4521', opening_balance: '500000.00', ...over,
})

test('a bank account needs its bank, holder and a full account number', () => {
  assert.deepEqual(issues(sonali()), [])
  assert.deepEqual(issues(emptyMoneyAccount('bank')), ['bank_name', 'account_name', 'account_number'])
  assert.deepEqual(issues(sonali({ account_number: '12345' })), ['account_number'])
  assert.deepEqual(issues(sonali({ routing_number: '1234' })), ['routing_number'])
})

test('cash needs nothing; a wallet or card needs a name', () => {
  assert.deepEqual(issues(emptyMoneyAccount('cash')), [])
  assert.deepEqual(issues(emptyMoneyAccount('wallet')), ['name'])
  assert.deepEqual(issues({ ...emptyMoneyAccount('wallet'), name: 'bKash merchant' }), [])
})

test('amounts: overdrafts are never negative, openings may be', () => {
  assert.deepEqual(issues(sonali({ overdraft_limit: '-1' })), ['overdraft_limit'])
  assert.deepEqual(issues(sonali({ opening_balance: '-750000.00', account_type: 'cash_credit' })), [])
  assert.deepEqual(issues(sonali({ opening_balance: '1.234' })), ['opening_balance'])
})

test('toMoneyAccountInput sends bank fields only where a bank exists, strings as typed', () => {
  const bank = toMoneyAccountInput(sonali({ branch_name: ' ', overdraft_limit: '100000.00' }))
  assert.equal(bank.bank_name, 'Sonali Bank')
  assert.equal(bank.branch_name, null)
  assert.equal(bank.overdraft_limit, '100000.00')
  assert.equal(bank.opening_balance, '500000.00')
  const cash = toMoneyAccountInput({ ...emptyMoneyAccount('cash'), overdraft_limit: '5' })
  assert.equal('bank_name' in cash, false)
  assert.equal('opening_balance' in cash, false)
  assert.equal(cash.overdraft_limit, null)
  assert.equal(cash.name, null)
})
