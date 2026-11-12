import { useNavigate } from 'react-router-dom'
import { downloadInvoicePdf, useInvoice } from '../../api/sales'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { ALLOCATION_KIND } from '../../components/document/PaymentsPanel'
import { DocPreview, stamp, type PreviewEvent, type PreviewLine } from '../../components/SplitView'
import { WidgetError } from '../../components/WidgetError'
import { compareDecimal } from '../../lib/decimal'
import { formatTaka } from '../../lib/format'
import { shortDate } from '../purchases/BillList'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'

const MAX_LINES = 6

/**
 * E2 split-view preview (A+ redesign, PEP-479): the invoice beside the list — balance due, the next action, lines,
 * payments and history — all from GET /sales-invoices/{id}. "Open full invoice" goes to E5.
 */
export function InvoiceListPreview({ id, onClose, onOpen }: { id: number; onClose: () => void; onOpen: () => void }) {
  const { Button } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const q = useInvoice(id)
  const inv = q.data
  const posted = inv?.status === 'posted'
  const owes = posted && compareDecimal(inv.balance_due, '0') > 0

  const events: PreviewEvent[] = inv ? [
    ...(inv.status === 'cancelled' ? [{ key: 'cancel', tone: 'negative' as const, text: `Cancelled${inv.cancel_reason ? ` · ${inv.cancel_reason}` : ''}` }] : []),
    ...(inv.allocations ?? []).map((a) => ({ key: `a${a.id}`, tone: a.reversed ? 'muted' as const : 'brand' as const,
      text: `${ALLOCATION_KIND[a.kind] ?? a.kind} ${a.voucher_number} · ${shortDate(a.date)} · ${formatTaka(a.amount, { symbol: true })}${a.reversed ? ' · reversed' : ''}` })),
    ...(inv.posted_at ? [{ key: 'posted', tone: 'brand' as const, text: `Posted · ${stamp(inv.posted_at)}` }] : []),
    { key: 'created', text: `Created${inv.created_by ? ` by ${inv.created_by.name}` : ''} · ${stamp(inv.created_at)}` },
  ] : []

  const lines: PreviewLine[] = (inv?.lines ?? []).slice(0, MAX_LINES).map((l) => ({
    key: l.line_no, label: l.product_name, note: `${l.quantity} ${l.unit} × ${formatTaka(l.unit_price)}`, value: formatTaka(l.line_total),
  }))
  const more = (inv?.lines.length ?? 0) - MAX_LINES
  if (more > 0) lines.push({ key: 'more', label: `${more} more ${more === 1 ? 'line' : 'lines'} on the full invoice`, value: '' })

  return (
    <DocPreview label="Invoice preview" testId="invoice-preview" loading={q.isPending} onClose={onClose} onOpen={onOpen} openLabel="Open full invoice"
      error={q.error ? <WidgetError title="Could not load this invoice" onRetry={() => void q.refetch()} /> : undefined}
      number={inv?.number} title={inv?.party.name} badge={inv && <InvoiceStatusBadge invoice={inv} />}
      figureLabel={owes ? 'Balance due' : posted ? 'Paid in full' : inv?.status === 'draft' ? 'Draft total' : 'Total'}
      figure={inv && formatTaka(owes ? inv.balance_due : inv.total, { symbol: true })}
      figureNote={inv && (inv.status === 'draft' ? 'Not posted yet: the customer owes nothing until it is posted.'
        : `Due ${shortDate(inv.due_date)}${inv.overdue ? ' · overdue' : ''}`)}
      actions={inv && <>
        {owes && can('sales.create') && <Button variant="primary" size="sm" icon="hand-coins" data-testid="preview-record-payment"
          onClick={() => navigate(`/sales/payments/new?party_id=${inv.party.id}&invoice_id=${inv.id}`)}>Record payment</Button>}
        {inv.status === 'draft' && can('sales.edit') && <Button variant="secondary" size="sm" icon="pencil" onClick={() => navigate(`/sales/invoices/${inv.id}/edit`)}>Edit</Button>}
        <Button variant="secondary" size="sm" icon="download" onClick={() => void downloadInvoicePdf(inv.id, inv.number)
          .catch(() => toast({ tone: 'negative', title: `Could not download ${inv.number}`, description: 'Try again in a moment.' }))}>PDF</Button>
        <Button variant="ghost" size="sm" icon="eye" onClick={() => navigate(`/sales/invoices/${inv.id}/preview`)}>Print view</Button>
      </>}
      facts={inv ? [
        { label: 'Invoice date', value: shortDate(inv.invoice_date) },
        { label: 'Total', value: <span className="lf-num">{formatTaka(inv.total, { symbol: true })}</span> },
        { label: 'Received', value: <span className="lf-num">{formatTaka(inv.amount_settled, { symbol: true })}</span> },
        ...(inv.customer_po_ref ? [{ label: 'Customer PO', value: inv.customer_po_ref }] : []),
      ] : undefined}
      lines={lines} events={events} />
  )
}
