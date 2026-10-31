import { useSearchParams } from 'react-router-dom'
import type { Note, Return } from '../../api/contract.gen'
import { creditNotes, debitNotes, purchaseReturns, salesReturns } from '../../api/trade'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { DocumentList } from '../../components/trade/DocumentList'
import { DocStatusBadge, statusLabel } from '../../components/trade/TradeParts'
import { shortDate } from '../purchases/BillList'
import type { Side } from './ReturnForm'

/**
 * E15 Returns and credit notes / F13 Returns and debit notes (GAP-24; backlog P10.3-FE-03, P10.4-FE-03): one page with
 * two views — the returns (with the note each made) and the notes (from a return or by hand) — each with status tabs,
 * search, party and dates in the URL. A row opens E8/E9 or F6/F7.
 */
const TABS = [{ value: 'all', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'posted', label: 'Posted' }, { value: 'cancelled', label: 'Cancelled' }]

export function ReturnsList({ side }: { side: Side }) {
  const { Segmented } = ds()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'notes' ? 'notes' : 'returns'
  const sales = side === 'sales'
  const perm = sales ? 'sales' : 'purchases'
  const noteName = sales ? 'Credit notes' : 'Debit notes'
  const switcher = (
    <div style={{ marginBottom: 12 }} data-testid="returns-view">
      <Segmented options={[{ value: 'returns', label: 'Returns' }, { value: 'notes', label: noteName }]} value={view}
        onChange={(v: string) => setParams(v === 'notes' ? { view: 'notes' } : {})} />
    </div>
  )

  if (view === 'notes') {
    const columns: DataColumn[] = [
      { key: 'number', label: sales ? 'Credit note' : 'Debit note', mono: true },
      { key: 'date', label: 'Date' },
      { key: 'party', label: sales ? 'Customer' : 'Supplier' },
      { key: 'reason', label: 'Reason' },
      { key: 'usage', label: 'Use' },
      { key: 'status', label: 'Status', render: (v: string) => <DocStatusBadge status={v} /> },
      { key: 'amount', label: 'Amount (৳)', type: 'amount' },
    ]
    return (
      <DocumentList<Note> key="notes" cfg={{
        title: sales ? 'Returns and credit notes' : 'Returns and debit notes', description: sales ? 'Goods customers sent back and the credit given for them.' : 'Goods sent back to suppliers and what they owe you for them.',
        label: noteName, partyType: sales ? 'customer' : 'supplier', tabs: TABS, searchPlaceholder: 'Search note, document or party', above: switcher,
        columns, mobileColumns: ['number', 'party', 'date', 'amount'],
        toRow: (n) => ({ id: n.id, name: n.number, number: n.number, date: shortDate(n.note_date), party: n.party.name, reason: statusLabel(n.reason), usage: statusLabel(n.usage),
          status: n.status, amount: n.amount }),
        open: (r) => `${sales ? '/sales/credit-notes' : '/purchases/debit-notes'}/${r.id}`, useList: (sales ? creditNotes : debitNotes).useList,
        newAction: can(`${perm}.create`) ? { label: sales ? 'New credit note' : 'New debit note', path: sales ? '/sales/credit-notes/new' : '/purchases/debit-notes/new' } : undefined,
        emptyTitle: `No ${noteName.toLowerCase()} yet`, emptyDescription: sales ? 'Posting a sales return makes one; you can also credit a customer for a price correction or goodwill.'
          : 'Posting a purchase return makes one; you can also debit a supplier for a price difference or short supply.',
      }} />
    )
  }

  const columns: DataColumn[] = [
    { key: 'number', label: 'Return', mono: true },
    { key: 'date', label: 'Date' },
    { key: 'party', label: sales ? 'Customer' : 'Supplier' },
    { key: 'against', label: 'Against', mono: true },
    { key: 'note', label: sales ? 'Credit note' : 'Debit note', mono: true },
    { key: 'status', label: 'Status', render: (v: string) => <DocStatusBadge status={v} /> },
    { key: 'total', label: 'Value (৳)', align: 'right', render: (v: string) => <span className="lf-num">{formatTaka(v)}</span> },
  ]
  return (
    <DocumentList<Return> key="returns" cfg={{
      title: sales ? 'Returns and credit notes' : 'Returns and debit notes', description: sales ? 'Goods customers sent back and the credit given for them.' : 'Goods sent back to suppliers and what they owe you for them.',
      label: 'Returns', partyType: sales ? 'customer' : 'supplier', tabs: TABS, searchPlaceholder: `Search return, ${sales ? 'invoice' : 'bill'} or party`, above: switcher,
      columns, mobileColumns: ['number', 'party', 'date', 'total'],
      toRow: (r) => ({ id: r.id, name: r.number, number: r.number, date: shortDate(r.return_date), party: r.party.name, against: r.source_number, note: r.note_number ?? '',
        status: r.status, total: r.total }),
      open: (r) => `${sales ? '/sales/returns' : '/purchases/returns'}/${r.id}`, useList: (sales ? salesReturns : purchaseReturns).useList,
      newAction: can(`${perm}.create`) ? { label: 'New return', path: sales ? '/sales/returns/new' : '/purchases/returns/new' } : undefined,
      emptyTitle: 'No returns yet', emptyDescription: sales ? 'Record goods a customer sends back against a posted invoice.' : 'Record goods you send back to a supplier against a posted bill.',
    }} />
  )
}
