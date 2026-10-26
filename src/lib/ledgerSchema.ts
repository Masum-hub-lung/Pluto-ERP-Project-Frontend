import { z } from 'zod'
import type { Ledger, LedgerInput } from '../api/contract.gen'

/**
 * H4/H5 ledger form (backlog P7.2-FE-03): shape checks only; the server checks the code range, uniqueness, the locks
 * once the ledger has entries (BR-027, BR-028) and the nature when regrouping.
 */
export interface LedgerFormValues {
  name: string
  account_group_id: string
  code: string
  description: string
  opening_balance: string
  opening_side: 'dr' | 'cr'
  track_bills: boolean
  show_in_cash_vouchers: boolean
}

const money = /^\d{1,16}(\.\d{1,2})?$/

export const ledgerSchema = z.object({
  name: z.string().trim().min(1, 'Enter a ledger name').max(150, 'Use at most 150 characters'),
  account_group_id: z.string().min(1, 'Choose the group'),
  code: z.union([z.literal(''), z.string().trim().max(20, 'Use at most 20 characters').regex(/^[A-Za-z0-9][A-Za-z0-9.-]*$/, 'Use letters, digits, dots or dashes')]),
  description: z.string().trim().max(255, 'Use at most 255 characters'),
  opening_balance: z.union([z.literal(''), z.string().trim().regex(money, 'Enter an amount with up to 2 decimals')]),
  opening_side: z.enum(['dr', 'cr']),
  track_bills: z.boolean(),
  show_in_cash_vouchers: z.boolean(),
})

export const emptyLedger = (groupId = ''): LedgerFormValues => ({
  name: '', account_group_id: groupId, code: '', description: '', opening_balance: '', opening_side: 'dr', track_bills: false, show_in_cash_vouchers: false,
})

export const ledgerToForm = (l: Ledger): LedgerFormValues => ({
  name: l.name, account_group_id: String(l.account_group_id), code: l.code, description: l.description ?? '',
  opening_balance: l.opening_balance && l.opening_balance !== '0.00' ? l.opening_balance : '', opening_side: l.opening_side ?? 'dr',
  track_bills: l.track_bills, show_in_cash_vouchers: l.show_in_cash_vouchers,
})

/** Create: empty code lets the server pick the next free one. Edit: a locked code/opening is not sent at all. */
export function toLedgerInput(v: LedgerFormValues, locked = false): LedgerInput {
  const input: LedgerInput = {
    name: v.name.trim(), account_group_id: Number(v.account_group_id), description: v.description.trim() || null,
    track_bills: v.track_bills, show_in_cash_vouchers: v.show_in_cash_vouchers,
  }
  if (!locked) {
    if (v.code.trim()) input.code = v.code.trim()
    input.opening_balance = v.opening_balance.trim() || '0'
    input.opening_side = v.opening_side
  }
  return input
}
