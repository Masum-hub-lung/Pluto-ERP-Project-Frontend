import type { SalesInvoice } from '../../api/contract.gen'
import { ds } from '../../ds'

/** One badge for an invoice's state (02 E2 status column): Draft, Cancelled, or — once posted — Overdue / Unpaid / Part paid / Paid. */
export function InvoiceStatusBadge({ invoice }: { invoice: Pick<SalesInvoice, 'status' | 'payment_status' | 'overdue'> }) {
  const { Badge } = ds()
  if (invoice.status === 'draft') return <Badge tone="neutral" dot>Draft</Badge>
  if (invoice.status === 'cancelled') return <Badge tone="negative" dot>Cancelled</Badge>
  if (invoice.overdue) return <Badge tone="warning" dot>Overdue</Badge>
  if (invoice.payment_status === 'paid') return <Badge tone="positive" dot>Paid</Badge>
  return <Badge tone="info" dot>{invoice.payment_status === 'part_paid' ? 'Part paid' : 'Unpaid'}</Badge>
}
