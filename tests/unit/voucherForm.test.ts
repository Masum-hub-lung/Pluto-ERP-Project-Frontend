import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Voucher, VoucherPreview } from '../../src/api/contract.gen'
import { compareDecimal, isPositiveAmount } from '../../src/lib/decimal'
import { differenceLine, emptyVoucher, fromVoucher, isComplete, newLine, readyToCalculate, toVoucherInput } from '../../src/lib/voucherForm'

test('compareDecimal orders amounts as strings, never as floats', () => {
  assert.equal(compareDecimal('100.10', '100.1'), 0)
  assert.equal(compareDecimal('99.99', '100'), -1)
  assert.equal(compareDecimal('1000000000000000.01', '1000000000000000.00'), 1)
  assert.equal(compareDecimal('-5', '0'), -1)
  assert.equal(compareDecimal('-0.00', '0'), 0)
  assert.equal(compareDecimal('-10', '-2'), -1)
  assert.equal(isPositiveAmount('0.01'), true)
  assert.equal(isPositiveAmount('0'), false)
  assert.equal(isPositiveAmount('1.234'), false)
  assert.equal(isPositiveAmount(''), false)
})

test('a journal sends only complete lines, each with one side', () => {
  const s = emptyVoucher('journal', '2026-10-26')
  s.narration = ' Depreciation '
  s.lines = [newLine({ ledgerId: 1, debit: '5000' }), newLine({ ledgerId: 2, credit: '5000.00', line_narration: 'Vans' }),
    newLine({ ledgerId: 3, debit: '1', credit: '1' }), newLine({ ledgerId: null, debit: '9' })]
  assert.equal(isComplete('journal', s.lines[2]), false)
  assert.equal(readyToCalculate({ ...s, lines: [s.lines[0]] }), false, 'a journal needs a debit and a credit line first')
  assert.equal(readyToCalculate(s), true)
  const input = toVoucherInput(s, 'post')
  assert.deepEqual(input.lines, [
    { ledger_id: 1, line_narration: null, against_reference: null, debit: '5000' },
    { ledger_id: 2, line_narration: 'Vans', against_reference: null, credit: '5000.00' },
  ])
  assert.equal(input.narration, 'Depreciation')
  assert.equal(input.payment, undefined)
  assert.equal(toVoucherInput(s, 'post', true).confirm_backdated, true)
})

test('cash vouchers send amounts and the account; contra its receiving account', () => {
  const s = emptyVoucher('payment', '2026-10-26')
  assert.equal(readyToCalculate(s), false)
  s.payment.money_account_id = '7'
  s.payment.bank_charge = '50.00'
  s.lines = [newLine({ ledgerId: 4, amount: '25000' })]
  assert.equal(readyToCalculate(s), true)
  const p = toVoucherInput(s, 'draft')
  assert.deepEqual(p.payment, { money_account_id: 7, method: 'cash', payee_text: null, cheque_number: null, cheque_date: null, transaction_reference: null, bank_charge: '50.00' })
  assert.deepEqual(p.lines, [{ ledger_id: 4, line_narration: null, against_reference: null, amount: '25000' }])
  const c = { ...emptyVoucher('contra', '2026-10-26'), lines: [newLine({ ledgerId: 9, amount: '100' })] }
  c.payment.money_account_id = '7'
  c.payment.counter_money_account_id = '8'
  assert.equal(toVoucherInput(c, 'post').payment?.counter_money_account_id, 8)
})

test('the difference goes on the short side, from the server preview', () => {
  const preview = (dr: string, cr: string, diff: string, balanced = false) => ({ total_debit: dr, total_credit: cr, difference: diff, balanced } as VoucherPreview)
  assert.equal(differenceLine(preview('5000.00', '4000.00', '1000.00'))?.credit, '1000.00')
  assert.equal(differenceLine(preview('4000.00', '5000.00', '1000.00'))?.debit, '1000.00')
  assert.equal(differenceLine(preview('5000.00', '5000.00', '0.00', true)), null)
  assert.equal(differenceLine(null), null)
})

test('editing a saved payment keeps only the lines the user entered', () => {
  const v = { entry_type: 'payment', entry_date: '2026-10-20', reference: null, narration: 'Rent',
    payment: { money_account: { id: 7 }, method: 'cheque', bank_charge: '50.00', cheque_number: '448812', cheque_date: null, transaction_reference: null },
    lines: [
      { line_no: 1, ledger_id: 4, ledger_code: '6101', ledger_name: 'Rent', debit: '25000.00', credit: '0.00', line_narration: null },
      { line_no: 2, ledger_id: 5, ledger_code: '6702', ledger_name: 'Bank charges', debit: '50.00', credit: '0.00', line_narration: 'Bank charge' },
      { line_no: 3, ledger_id: 70, ledger_code: '1102-01', ledger_name: 'Sonali', debit: '0.00', credit: '25050.00', line_narration: null },
    ] } as unknown as Voucher
  const s = fromVoucher(v, 70)
  assert.equal(s.type, 'payment')
  assert.equal(s.payment.money_account_id, '7')
  assert.equal(s.payment.bank_charge, '50.00')
  assert.deepEqual(s.lines.map((l) => [l.ledgerId, l.amount]), [[4, '25000.00']])
  assert.equal(fromVoucher(v, 70, '2026-10-26').date, '2026-10-26', 'a duplicate takes a new date')
})
