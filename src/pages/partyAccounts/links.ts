/**
 * Where a ledger line or transaction opens (party accounts, backlog P6.2-FE-07). Journal entries of a document carry
 * the entry id, not the document id, so only receipts link from a ledger line; transactions bring their own `url`.
 */
export function voucherPath(entryType: string, entryId: number): string | null {
  return entryType === 'receipt' ? `/sales/payments/${entryId}` : null
}

export const DOC_LABEL: Record<string, string> = { sales_invoice: 'Invoice', purchase_bill: 'Bill', receipt: 'Receipt', payment: 'Payment' }

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', cancelled: 'Cancelled', unpaid: 'Unpaid', part_paid: 'Part paid', paid: 'Paid', applied: 'Applied', unapplied: 'Advance left',
}
