import type { PurchaseBill } from '../../api/contract.gen'
import { ds } from '../../ds'

/** One badge for a bill's state (02 F2 status column): Draft, Cancelled, or — once posted — Overdue / Unpaid / Part paid / Paid. */
export function BillStatusBadge({ bill }: { bill: Pick<PurchaseBill, 'status' | 'payment_status' | 'overdue'> }) {
  const { Badge } = ds()
  if (bill.status === 'draft') return <Badge tone="neutral" dot>Draft</Badge>
  if (bill.status === 'cancelled') return <Badge tone="negative" dot>Cancelled</Badge>
  if (bill.overdue) return <Badge tone="warning" dot>Overdue</Badge>
  if (bill.payment_status === 'paid') return <Badge tone="positive" dot>Paid</Badge>
  return <Badge tone="info" dot>{bill.payment_status === 'part_paid' ? 'Part paid' : 'Unpaid'}</Badge>
}
