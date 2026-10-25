import { z } from 'zod'
import type { MoneyAccountInput } from '../api/contract.gen'

/**
 * G4 Add account (backlog P6.2-FE-02): shape checks only. Bank and cash-credit accounts need the bank, the name on the
 * account and its number (at least 10 digits, 02 G4); cash, wallets and cards do not. The server creates the ledger
 * and posts the opening balance (BR-028).
 */
export type AccountType = MoneyAccountInput['account_type']

export interface MoneyAccountFormValues {
  account_type: AccountType
  name: string
  bank_name: string
  branch_name: string
  account_name: string
  account_number: string
  routing_number: string
  overdraft_limit: string
  opening_balance: string
  opening_date: string
  use_for_receipts: boolean
  use_for_payments: boolean
  show_on_invoices: boolean
}

const money = /^\d{1,16}(\.\d{1,2})?$/
const signedMoney = /^-?\d{1,16}(\.\d{1,2})?$/
export const needsBank = (t: AccountType) => t === 'bank' || t === 'cash_credit'

export const moneyAccountSchema = z.object({
  account_type: z.enum(['cash', 'bank', 'wallet', 'card', 'cash_credit']),
  name: z.string().trim().max(120, 'Use at most 120 characters'),
  bank_name: z.string().trim().max(120, 'Use at most 120 characters'),
  branch_name: z.string().trim().max(120, 'Use at most 120 characters'),
  account_name: z.string().trim().max(150, 'Use at most 150 characters'),
  account_number: z.string().trim().max(40, 'Use at most 40 characters'),
  routing_number: z.union([z.literal(''), z.string().trim().regex(/^\d{9}$/, 'The routing number has 9 digits')]),
  overdraft_limit: z.union([z.literal(''), z.string().trim().regex(money, 'Enter an amount of 0 or more with up to 2 decimals')]),
  opening_balance: z.union([z.literal(''), z.string().trim().regex(signedMoney, 'Enter an amount with up to 2 decimals; minus for an overdrawn account')]),
  opening_date: z.string(),
  use_for_receipts: z.boolean(),
  use_for_payments: z.boolean(),
  show_on_invoices: z.boolean(),
}).superRefine((v, ctx) => {
  if (!needsBank(v.account_type)) {
    if (v.account_type === 'cash' || v.name.trim() || v.bank_name.trim()) return
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'Name the account, e.g. "bKash merchant 01711…"' })
    return
  }
  if (!v.bank_name.trim()) ctx.addIssue({ code: 'custom', path: ['bank_name'], message: 'Enter the bank' })
  if (!v.account_name.trim()) ctx.addIssue({ code: 'custom', path: ['account_name'], message: 'Enter the name on the account' })
  if ((v.account_number.match(/\d/g) ?? []).length < 10) ctx.addIssue({ code: 'custom', path: ['account_number'], message: 'Enter the full account number, at least 10 digits' })
})

export const emptyMoneyAccount = (type: AccountType = 'bank'): MoneyAccountFormValues => ({
  account_type: type, name: '', bank_name: '', branch_name: '', account_name: '', account_number: '', routing_number: '', overdraft_limit: '',
  opening_balance: '', opening_date: '', use_for_receipts: true, use_for_payments: true, show_on_invoices: false,
})

/** Form → POST body; empty optional fields are left out, bank fields only where a bank exists. */
export function toMoneyAccountInput(v: MoneyAccountFormValues): MoneyAccountInput {
  const bank = needsBank(v.account_type) || !!v.bank_name.trim()
  const opt = (s: string) => s.trim() || null
  return {
    account_type: v.account_type,
    name: opt(v.name),
    ...(bank ? { bank_name: v.bank_name.trim(), branch_name: opt(v.branch_name), account_name: v.account_name.trim(), account_number: v.account_number.trim(),
      routing_number: opt(v.routing_number) } : {}),
    overdraft_limit: (v.account_type === 'bank' || v.account_type === 'cash_credit') ? opt(v.overdraft_limit) : null,
    ...(v.opening_balance.trim() ? { opening_balance: v.opening_balance.trim(), opening_date: opt(v.opening_date) } : {}),
    use_for_receipts: v.use_for_receipts, use_for_payments: v.use_for_payments, show_on_invoices: v.show_on_invoices,
  } as MoneyAccountInput
}

export const ACCOUNT_TYPES: Array<{ value: AccountType; label: string }> = [
  { value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'wallet', label: 'Mobile wallet' }, { value: 'card', label: 'Card' }, { value: 'cash_credit', label: 'Cash credit' },
]
export const accountTypeLabel = (t: string) => ACCOUNT_TYPES.find((x) => x.value === t)?.label ?? t
