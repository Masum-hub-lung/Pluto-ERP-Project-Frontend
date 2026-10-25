import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Voucher } from '../../api/contract.gen'
import { downloadReceiptPdf, methodLabel, paymentOf, useReceipt } from '../../api/receipts'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { ActivityTimeline } from '../../components/ActivityTimeline'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'
import { shortDate } from '../purchases/BillList'

/**
 * Receipt detail (E14 → one payment; backlog P6.2-FE-04): amount, account, method and cheque, the invoices it settles
 * (links to E5) and the advance left, the ledger entries, the money receipt PDF and the activity.
 */
const TABS = [{ value: 'applied', label: 'Applied to' }, { value: 'ledger', label: 'Ledger entries' }, { value: 'activity', label: 'Activity' }]

export function ReceiptDetails() {
  const id = Number(useParams().id)
  const q = useReceipt(id)
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this payment" back="/sales/payments" backLabel="Payments received" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  return <Details v={q.data} />
}

function Details({ v }: { v: Voucher }) {
  const { Button, Tabs, Card, DataTable, Badge } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const tabs = TABS.filter((t) => t.value !== 'activity' || can('accounting.view')) // voucher audit needs accounting.view
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'applied'
  const p = paymentOf(v)!
  const pdf = () => downloadReceiptPdf(v.id, v.voucher_number).catch(() => toast({ tone: 'negative', title: 'Could not download the receipt', description: 'Try again in a moment.' }))

  const allocCols: DataColumn[] = [
    { key: 'number', label: 'Invoice', render: (_v, r) => <Link to={`/sales/invoices/${r.docId}`} onClick={(e) => e.stopPropagation()} data-testid={`alloc-${r.docId}`}>{r.number}</Link> },
    { key: 'date', label: 'Applied on' },
    { key: 'amount', label: 'Amount (৳)', type: 'amount' },
  ]
  const allocRows = p.allocations.map((a) => ({ id: a.id, docId: a.document_id, number: a.document_number, date: shortDate(a.allocated_on), amount: a.amount }))
  const journalCols: DataColumn[] = [
    { key: 'code', label: 'Ledger', mono: true }, { key: 'name', label: 'Name' },
    { key: 'debit', label: 'Debit (৳)', type: 'amount' }, { key: 'credit', label: 'Credit (৳)', type: 'amount' },
  ]
  const lines = (v.lines ?? []) as unknown as Array<{ line_no: number; ledger_code: string; ledger_name: string; debit: string; credit: string }>
  const journalRows = lines.map((l) => ({ id: l.line_no, code: l.ledger_code, name: l.ledger_name, debit: l.debit === '0.00' ? '' : l.debit, credit: l.credit === '0.00' ? '' : l.credit }))

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="lf-label">Payment received</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, font: '500 28px/34px var(--font-serif)' }} data-testid="receipt-number">{v.voucher_number}</h1>
            {v.status === 'reversed' ? <Badge tone="negative" dot>Cancelled</Badge> : <Badge tone="positive" dot>Posted</Badge>}
          </div>
          <span style={{ color: 'var(--ink-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {p.party && <Link to={`/customers/${p.party.id}`}>{p.party.name}</Link>}
            <span>{shortDate(v.entry_date)}</span>
            <span>{methodLabel(p.method)}{p.cheque_number ? ` · cheque ${p.cheque_number}${p.drawn_on ? `, ${p.drawn_on}` : ''}` : ''}{p.transaction_reference ? ` · ref. ${p.transaction_reference}` : ''}</span>
            <span>Into {p.money_account.name}</span>
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="ghost" icon="arrow-left" onClick={() => navigate('/sales/payments')}>All payments</Button>
          <Button variant="secondary" icon="download" onClick={() => void pdf()} data-testid="receipt-pdf">Receipt PDF</Button>
        </div>
      </div>

      <div className="lf-grid">
        <SummaryTile label="Amount" testId="receipt-amount" value={formatTaka(p.amount, { symbol: true })} sub={v.amount_in_words} />
        <SummaryTile label="Kept as advance" testId="receipt-unapplied" value={formatTaka(p.unapplied_amount, { symbol: true })}
          sub={p.unapplied_amount === '0.00' ? 'All applied to invoices' : 'Can be applied to a later invoice'} />
        {p.bank_charge !== '0.00' && <SummaryTile label="Bank charge" value={formatTaka(p.bank_charge, { symbol: true })} sub={`Net received ${formatTaka(p.net_received, { symbol: true })}`} />}
      </div>
      <div style={{ overflowX: 'auto', margin: '8px 0 16px' }}>
        <Tabs key={tab} items={tabs} value={tab} onChange={(t) => setParams(t === 'applied' ? {} : { tab: t }, { replace: true })} />
      </div>
      {tab === 'applied' && (
        <Card title="Applied to invoices" padding="none">
          {allocRows.length
            ? <div style={{ overflowX: 'auto' }} data-testid="receipt-allocations"><DataTable caption="Applied to" columns={allocCols} rows={allocRows} /></div>
            : <p style={{ padding: '16px 20px', margin: 0, color: 'var(--ink-muted)' }}>Not applied to any invoice; the whole amount is an advance.</p>}
        </Card>
      )}
      {tab === 'ledger' && <Card title="Ledger entries" padding="none"><div style={{ overflowX: 'auto' }} data-testid="ledger-entries"><DataTable caption="Ledger entries" columns={journalCols} rows={journalRows} /></div></Card>}
      {tab === 'activity' && <Card title="Activity"><ActivityTimeline type="journal_entry" id={v.id} /></Card>}
    </>
  )
}
