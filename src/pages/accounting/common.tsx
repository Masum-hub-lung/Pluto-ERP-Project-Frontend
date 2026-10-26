import type { Voucher } from '../../api/contract.gen'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'

/** Shared bits of the accounting pages (H1–H14): Dr/Cr amounts, voucher type names and the status badge. */

/** An amount the API already split into amount + side, e.g. "38,000.00 Dr". */
export function DrCr({ amount, side, testId }: { amount: string; side: 'dr' | 'cr'; testId?: string }) {
  return (
    <span className="lf-num" data-testid={testId} style={{ whiteSpace: 'nowrap' }}>
      {formatTaka(amount)} <span style={{ color: 'var(--ink-muted)', fontSize: '0.85em' }}>{side === 'cr' ? 'Cr' : 'Dr'}</span>
    </span>
  )
}

export const drCrText = (amount: string, side: 'dr' | 'cr') => `${formatTaka(amount)} ${side === 'cr' ? 'Cr' : 'Dr'}`

export const VOUCHER_TYPES = [
  { value: 'journal', label: 'Journal', prefix: 'JV', path: 'journal' },
  { value: 'payment', label: 'Payment', prefix: 'PV', path: 'payment' },
  { value: 'receipt', label: 'Receipt', prefix: 'RV', path: 'receipt' },
  { value: 'contra', label: 'Contra', prefix: 'CV', path: 'contra' },
] as const
export type VoucherType = (typeof VOUCHER_TYPES)[number]['value']

const ENTRY_TYPES: Record<string, string> = {
  journal: 'Journal', payment: 'Payment', receipt: 'Receipt', contra: 'Contra', reversal: 'Reversal', opening_balance: 'Opening balance',
  sales_invoice: 'Sales invoice', purchase_bill: 'Purchase bill', cancellation: 'Cancellation', year_end_close: 'Year-end close', sales_return: 'Sales return',
  credit_note: 'Credit note', purchase_return: 'Purchase return', debit_note: 'Debit note', stock_adjustment: 'Stock adjustment', stock_transfer: 'Stock transfer',
  expense: 'Expense', income: 'Income', lc_charge: 'LC charge', lc_payment: 'LC payment', landed_cost: 'Landed cost', cash_count: 'Cash count',
}
export const entryTypeLabel = (t: string) => ENTRY_TYPES[t] ?? t.replace(/_/g, ' ')

/** Voucher types the user may enter: journals need accounting.create; cash vouchers banking.create or accounting.create (R-09). */
export const canEnter = (can: (p: string) => boolean, type: VoucherType, action: 'create' | 'edit' = 'create') =>
  type === 'journal' ? can(`accounting.${action}`) : can(`banking.${action}`) || can(`accounting.${action}`)

export function VoucherStatusBadge({ status }: { status: Voucher['status'] }) {
  const { Badge } = ds()
  const map: Record<Voucher['status'], [string, 'neutral' | 'positive' | 'negative' | 'warning' | 'info']> = {
    draft: ['Draft', 'neutral'], submitted: ['Awaiting approval', 'warning'], approved: ['Approved', 'info'], rejected: ['Rejected', 'negative'],
    posted: ['Posted', 'positive'], reversed: ['Reversed', 'negative'],
  }
  const [label, tone] = map[status] ?? [status, 'neutral']
  return <Badge tone={tone} dot>{label}</Badge>
}

export const NATURES = ['asset', 'liability', 'equity', 'income', 'expense'] as const
export const natureLabel = (n: string) => n.charAt(0).toUpperCase() + n.slice(1)
