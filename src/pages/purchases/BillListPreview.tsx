import { useNavigate } from 'react-router-dom'
import { useBill } from '../../api/purchases'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { ALLOCATION_KIND } from '../../components/document/PaymentsPanel'
import { DocPreview, stamp, type PreviewEvent, type PreviewLine } from '../../components/SplitView'
import { WidgetError } from '../../components/WidgetError'
import { compareDecimal } from '../../lib/decimal'
import { formatTaka } from '../../lib/format'
import type { BillLine } from './BillDetails'
import { shortDate } from './BillList'
import { BillStatusBadge } from './BillStatusBadge'

const MAX_LINES = 6

/**
 * F2 split-view preview (A+ redesign, PEP-479): the bill beside the list — what is still owed, pay action, lines,
 * payments and history — all from GET /purchase-bills/{id}. "Open full bill" goes to F4.
 */
export function BillListPreview({ id, onClose, onOpen }: { id: number; onClose: () => void; onOpen: () => void }) {
  const { Button } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const q = useBill(id)
  const b = q.data
  const posted = b?.status === 'posted'
  const owes = posted && compareDecimal(b.balance_due, '0') > 0
  const foreign = b && b.currency_code !== 'BDT' && b.total_foreign

  const events: PreviewEvent[] = b ? [
    ...(b.status === 'cancelled' ? [{ key: 'cancel', tone: 'negative' as const, text: 'Cancelled' }] : []),
    ...(b.allocations ?? []).map((a) => ({ key: `a${a.id}`, tone: a.reversed ? 'muted' as const : 'brand' as const,
      text: `${ALLOCATION_KIND[a.kind] ?? a.kind} ${a.voucher_number} · ${shortDate(a.date)} · ${formatTaka(a.amount, { symbol: true })}${a.reversed ? ' · reversed' : ''}` })),
    ...(b.posted_at ? [{ key: 'posted', tone: 'brand' as const, text: `Posted · ${stamp(b.posted_at)}` }] : []),
    { key: 'created', text: `Created${b.created_by ? ` by ${b.created_by.name}` : ''} · ${stamp(b.created_at)}` },
  ] : []

  const all = (b?.lines ?? []) as unknown as BillLine[]
  const lines: PreviewLine[] = all.slice(0, MAX_LINES).map((l) => ({
    key: l.line_no, label: l.product_name, note: `${l.quantity} ${l.unit} × ${formatTaka(l.unit_cost)}`, value: formatTaka(l.line_total),
  }))
  if (all.length > MAX_LINES) lines.push({ key: 'more', label: `${all.length - MAX_LINES} more ${all.length - MAX_LINES === 1 ? 'line' : 'lines'} on the full bill`, value: '' })

  return (
    <DocPreview label="Bill preview" testId="bill-preview" loading={q.isPending} onClose={onClose} onOpen={onOpen} openLabel="Open full bill"
      error={q.error ? <WidgetError title="Could not load this bill" onRetry={() => void q.refetch()} /> : undefined}
      number={b?.number} title={b?.party.name} badge={b && <BillStatusBadge bill={b} />}
      figureLabel={owes ? 'You still owe' : posted ? 'Paid in full' : b?.status === 'draft' ? 'Draft total' : 'Total'}
      figure={b && formatTaka(owes ? b.balance_due : b.total, { symbol: true })}
      figureNote={b && (b.status === 'draft' ? 'Not posted yet: nothing is owed or in stock until it is posted.'
        : `Due ${shortDate(b.due_date)}${b.overdue ? ' · overdue' : ''}`)}
      actions={b && <>
        {owes && can('purchases.create') && <Button variant="primary" size="sm" icon="banknote" data-testid="preview-pay-bill"
          onClick={() => navigate(`/purchases/payments/new?party_id=${b.party.id}&bill_id=${b.id}`)}>Pay this bill</Button>}
        {b.status === 'draft' && can('purchases.edit') && <Button variant="secondary" size="sm" icon="pencil" onClick={() => navigate(`/purchases/bills/${b.id}/edit`)}>Edit</Button>}
      </>}
      facts={b ? [
        { label: 'Bill date', value: shortDate(b.bill_date) },
        { label: 'Supplier ref', value: <span className="lf-mono">{b.supplier_bill_no}</span> },
        { label: 'Total', value: <span className="lf-num">{formatTaka(b.total, { symbol: true })}</span> },
        { label: 'Paid', value: <span className="lf-num">{formatTaka(b.amount_settled, { symbol: true })}</span> },
        ...(foreign ? [{ label: `Total in ${b.currency_code}`, value: <span className="lf-num">{b.currency_code} {formatTaka(b.total_foreign)}</span> }] : []),
      ] : undefined}
      lines={lines} events={events} />
  )
}
