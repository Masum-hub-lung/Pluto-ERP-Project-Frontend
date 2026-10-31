import { z } from 'zod'
import type { IeEntryInput } from '../api/contract.gen'

/**
 * I3 Add income, I6 Add expense (backlog P13.2-FE-02): shape checks only — amount > 0 as a decimal string, a category
 * and an account, and the recurrence fields when "Recurring" is on (BR-054, BR-048). The server posts the voucher,
 * checks the period, funds and the approval limit, and answers 422 with field errors for anything else.
 */
export type IeMethod = IeEntryInput['method']

export interface IeEntryFormValues {
  amount: string
  date: string
  category_id: string
  money_account_id: string
  method: IeMethod
  payee_text: string
  reference: string
  tax_rule_id: string
  notes: string
  recurring: boolean
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  next_run_on: string
  ends_type: 'never' | 'after_count' | 'on_date'
  ends_after_count: string
  ends_on: string
}

const money = /^\d{1,16}(\.\d{1,2})?$/

export const ieEntrySchema = z.object({
  amount: z.string().trim().regex(money, 'Enter the amount in taka, e.g. 1500.00').refine((v) => !/^0+(\.0+)?$/.test(v), 'Enter an amount greater than zero'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date'),
  category_id: z.string().min(1, 'Choose a category'),
  money_account_id: z.string().min(1, 'Choose the cash or bank account'),
  method: z.enum(['cash', 'cheque', 'bank_transfer', 'beftn', 'rtgs', 'npsb', 'bkash', 'nagad', 'card']),
  payee_text: z.string().trim().max(150, 'Use at most 150 characters'),
  reference: z.string().trim().max(60, 'Use at most 60 characters'),
  tax_rule_id: z.string(),
  notes: z.string().trim().max(500, 'Use at most 500 characters'),
  recurring: z.boolean(),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  next_run_on: z.string(),
  ends_type: z.enum(['never', 'after_count', 'on_date']),
  ends_after_count: z.string(),
  ends_on: z.string(),
}).superRefine((v, ctx) => {
  if (!v.recurring) return
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.next_run_on)) ctx.addIssue({ code: 'custom', path: ['next_run_on'], message: 'Choose when the next one is due' })
  else if (v.next_run_on <= v.date) ctx.addIssue({ code: 'custom', path: ['next_run_on'], message: 'The next one must come after this entry\'s date' })
  if (v.ends_type === 'after_count' && !/^[1-9]\d{0,2}$/.test(v.ends_after_count)) ctx.addIssue({ code: 'custom', path: ['ends_after_count'], message: 'Say after how many times it ends' })
  if (v.ends_type === 'on_date' && !/^\d{4}-\d{2}-\d{2}$/.test(v.ends_on)) ctx.addIssue({ code: 'custom', path: ['ends_on'], message: 'Choose the date it ends' })
})

/** Next due date one step after `date` (dates as YYYY-MM-DD; calendar arithmetic, not money). */
export function nextDate(date: string, frequency: IeEntryFormValues['frequency']): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7)
  else {
    const day = d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + (frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12))
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    d.setUTCDate(Math.min(day, last))
  }
  return d.toISOString().slice(0, 10)
}

export function emptyIeEntry(today: string): IeEntryFormValues {
  return { amount: '', date: today, category_id: '', money_account_id: '', method: 'cash', payee_text: '', reference: '', tax_rule_id: '', notes: '', recurring: false,
    frequency: 'monthly', next_run_on: nextDate(today, 'monthly'), ends_type: 'never', ends_after_count: '12', ends_on: '' }
}

export function toIeEntryInput(kind: 'income' | 'expense', v: IeEntryFormValues, attachmentIds: number[], confirmBackdated = false): IeEntryInput {
  const blank = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    kind, amount: v.amount.trim(), date: v.date, category_id: Number(v.category_id), money_account_id: Number(v.money_account_id), method: v.method,
    payee_text: blank(v.payee_text), reference: blank(v.reference), tax_rule_id: v.tax_rule_id ? Number(v.tax_rule_id) : null, notes: blank(v.notes),
    attachment_ids: attachmentIds, confirm_backdated: confirmBackdated,
    recurrence: v.recurring ? { frequency: v.frequency, next_run_on: v.next_run_on, ends_type: v.ends_type,
      ends_after_count: v.ends_type === 'after_count' ? Number(v.ends_after_count) : null, ends_on: v.ends_type === 'on_date' ? v.ends_on : null } : null,
  }
}
