import { useNavigate } from 'react-router-dom'
import type { Party } from '../../api/contract.gen'
import type { PartyType } from '../../api/parties'
import { useBills } from '../../api/purchases'
import { methodLabel, paymentOf, useOpenDocuments, useReceipts } from '../../api/receipts'
import { useInvoices } from '../../api/sales'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { ProblemBanner } from '../../components/ProblemBanner'
import { InvoiceStatusBadge } from '../sales/InvoiceStatusBadge'
import { BillStatusBadge } from '../purchases/BillStatusBadge'
import { shortDate } from '../purchases/BillList'

/**
 * B4/C4 party detail parts (backlog P6.2-FE-06), shared by customers and suppliers: the documents tab (invoices or
 * bills of the party), the payments tab (receipts; supplier payments arrive in P8), the open-items panel (open
 * documents oldest due first and unapplied advances, from GET /parties/{id}/open-documents) and the links to the
 * history, ledger and statement pages. Every amount is the server's.
 */
export function PartyAccountLinks({ type, id }: { type: PartyType; id: number }) {
  const { Button } = ds()
  const navigate = useNavigate()
  const base = `/${type}s/${id}`
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} data-testid="party-account-links">
      <Button size="sm" variant="secondary" icon="list-tree" onClick={() => navigate(`${base}/history`)}>History</Button>
      <Button size="sm" variant="secondary" icon="book-open-text" onClick={() => navigate(`${base}/ledger`)} data-testid="open-ledger">Ledger</Button>
      <Button size="sm" variant="secondary" icon="file-text" onClick={() => navigate(`${base}/statement`)} data-testid="open-statement">Statement</Button>
    </div>
  )
}

export function PartyOpenItems({ type, party }: { type: PartyType; party: Party }) {
  const { Card, Button, Badge } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const open = useOpenDocuments(party.id)
  const d = open.data
  const path = type === 'customer' ? '/sales/invoices/' : '/purchases/bills/'
  return (
    <Card title="Open items" subtitle={d ? `${formatTaka(d.total_open, { symbol: true })} open${d.unapplied_credit !== '0.00' ? ` · ${formatTaka(d.unapplied_credit, { symbol: true })} advance` : ''}` : undefined}
      actions={type === 'customer' && can('sales.create') ? <Button size="sm" variant="primary" icon="hand-coins" onClick={() => navigate(`/sales/payments/new?party_id=${party.id}`)} data-testid="party-record-payment">Record payment</Button> : undefined}>
      <ProblemBanner error={open.error} onRetry={() => void open.refetch()} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="open-items">
        {d && d.documents.length === 0 && <span style={{ color: 'var(--ink-muted)' }}>Nothing open.</span>}
        {d?.documents.slice(0, 6).map((x) => (
          <a key={x.id} href={`${path}${x.id}`} onClick={(e) => { e.preventDefault(); navigate(`${path}${x.id}`) }}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: '1px solid var(--line)', color: 'inherit', textDecoration: 'none' }}>
            <span><span className="lf-code">{x.number}</span> <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>due {shortDate(x.due_date)}</span>
              {x.days_overdue > 0 && <> <Badge tone="warning">{x.days_overdue} days late</Badge></>}</span>
            <span className="lf-num">{formatTaka(x.balance, { symbol: true })}</span>
          </a>
        ))}
        {d && d.documents.length > 6 && <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>and {d.documents.length - 6} more</span>}
        {d?.credits.map((c) => (
          <div key={c.journal_line_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
            <span><span className="lf-code">{c.number}</span> <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>unapplied {c.kind === 'receipt' ? 'receipt' : c.kind.replace('_', ' ')}</span></span>
            <span className="lf-num">{formatTaka(c.unapplied, { symbol: true })}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function PartyDocumentsTab({ type, partyId }: { type: PartyType; partyId: number }) {
  return type === 'customer' ? <InvoicesOf partyId={partyId} /> : <BillsOf partyId={partyId} />
}

function InvoicesOf({ partyId }: { partyId: number }) {
  const { Card, DataTable, EmptyState } = ds()
  const navigate = useNavigate()
  const list = useInvoices({ party_id: partyId, per_page: 50 })
  const rows = (list.data?.data ?? []).map((i) => ({ id: i.id, number: i.number, date: shortDate(i.invoice_date), due: shortDate(i.due_date), inv: i, total: i.total,
    balance: i.status === 'posted' ? i.balance_due : '' }))
  const cols: DataColumn[] = [
    { key: 'number', label: 'Invoice', mono: true }, { key: 'date', label: 'Date' }, { key: 'due', label: 'Due' },
    { key: 'status', label: 'Status', render: (_v, r) => <InvoiceStatusBadge invoice={r.inv} /> },
    { key: 'total', label: 'Amount (৳)', type: 'amount' },
    { key: 'balance', label: 'Balance (৳)', align: 'right', render: (v: string) => (v ? <span className="lf-num">{formatTaka(v)}</span> : '') },
  ]
  return (
    <Card title="Invoices" padding="none">
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <div style={{ overflowX: 'auto' }} data-testid="party-invoices">
        <DataTable caption="Invoices" columns={cols} rows={rows} loading={list.isPending} onRowClick={(r: { id: number }) => navigate(`/sales/invoices/${r.id}`)}
          emptyState={<EmptyState icon="receipt-text" title="No invoices yet" description="Invoices to this customer appear here." />} />
      </div>
    </Card>
  )
}

function BillsOf({ partyId }: { partyId: number }) {
  const { Card, DataTable, EmptyState } = ds()
  const navigate = useNavigate()
  const list = useBills({ party_id: partyId, per_page: 50 })
  const rows = (list.data?.data ?? []).map((b) => ({ id: b.id, number: b.number, ref: b.supplier_bill_no, date: shortDate(b.bill_date), due: shortDate(b.due_date), bill: b, total: b.total,
    balance: b.status === 'posted' ? b.balance_due : '' }))
  const cols: DataColumn[] = [
    { key: 'number', label: 'Bill', mono: true }, { key: 'ref', label: 'Supplier ref', mono: true }, { key: 'date', label: 'Date' }, { key: 'due', label: 'Due' },
    { key: 'status', label: 'Status', render: (_v, r) => <BillStatusBadge bill={r.bill} /> },
    { key: 'total', label: 'Amount (৳)', type: 'amount' },
    { key: 'balance', label: 'Balance (৳)', align: 'right', render: (v: string) => (v ? <span className="lf-num">{formatTaka(v)}</span> : '') },
  ]
  return (
    <Card title="Bills" padding="none">
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <div style={{ overflowX: 'auto' }} data-testid="party-bills">
        <DataTable caption="Bills" columns={cols} rows={rows} loading={list.isPending} onRowClick={(r: { id: number }) => navigate(`/purchases/bills/${r.id}`)}
          emptyState={<EmptyState icon="shopping-cart" title="No bills yet" description="Bills from this supplier appear here." />} />
      </div>
    </Card>
  )
}

export function PartyPaymentsTab({ type, partyId }: { type: PartyType; partyId: number }) {
  const { Card, EmptyState } = ds()
  if (type === 'supplier') {
    return <Card title="Payments"><EmptyState icon="hand-coins" title="Supplier payments arrive in phase 8" description="Advances applied to bills already show on each bill's Payments tab." /></Card>
  }
  return <ReceiptsOf partyId={partyId} />
}

function ReceiptsOf({ partyId }: { partyId: number }) {
  const { Card, DataTable, EmptyState } = ds()
  const navigate = useNavigate()
  const list = useReceipts({ party_id: partyId, per_page: 50 })
  const rows = (list.data?.data ?? []).map((v) => {
    const p = paymentOf(v)
    return { id: v.id, number: v.voucher_number, date: shortDate(v.entry_date), method: p ? methodLabel(p.method) : '', account: p?.money_account.name ?? '', amount: p?.amount ?? v.total_debit,
      advance: p && p.unapplied_amount !== '0.00' ? p.unapplied_amount : '' }
  })
  const cols: DataColumn[] = [
    { key: 'number', label: 'Receipt', mono: true }, { key: 'date', label: 'Date' }, { key: 'method', label: 'Method' }, { key: 'account', label: 'Deposited to' },
    { key: 'amount', label: 'Amount (৳)', type: 'amount' },
    { key: 'advance', label: 'Advance (৳)', align: 'right', render: (v: string) => (v ? <span className="lf-num">{formatTaka(v)}</span> : '') },
  ]
  return (
    <Card title="Payments received" padding="none">
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <div style={{ overflowX: 'auto' }} data-testid="party-receipts">
        <DataTable caption="Payments received" columns={cols} rows={rows} loading={list.isPending} onRowClick={(r: { id: number }) => navigate(`/sales/payments/${r.id}`)}
          emptyState={<EmptyState icon="hand-coins" title="No payments yet" description="Money received from this customer appears here." />} />
      </div>
    </Card>
  )
}
