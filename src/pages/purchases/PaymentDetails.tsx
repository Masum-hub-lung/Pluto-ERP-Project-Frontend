import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Voucher } from '../../api/contract.gen'
import { methodLabel, paymentOf } from '../../api/receipts'
import { downloadSupplierPaymentPdf, useSupplierPayment } from '../../api/supplierPayments'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { ApprovalDrawer } from '../../components/ApprovalDrawer'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'
import { VoucherStatusBadge } from '../accounting/common'
import { shortDate } from './BillList'

/**
 * F12 → one supplier payment (backlog P8.2-FE-03): amount, account, method, the bills it settled (links to F4) and the
 * advance left, its approval while it waits, the ledger entries, the A4 voucher PDF and the activity.
 */
const TABS = [{ value: 'applied', label: 'Applied to' }, { value: 'ledger', label: 'Ledger entries' }, { value: 'activity', label: 'Activity' }]

export function PaymentDetails() {
  const id = Number(useParams().id)
  const q = useSupplierPayment(id)
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this payment" back="/purchases/payments" backLabel="Payments made" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  return <Details v={q.data} />
}

function Details({ v }: { v: Voucher }) {
  const { Button, Tabs, Card, DataTable, Banner } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const [tab, setTab] = useState('applied')
  const [approval, setApproval] = useState(false)
  const p = paymentOf(v)!
  const pdf = () => downloadSupplierPaymentPdf(v.id, v.voucher_number).catch(() => toast({ tone: 'negative', title: 'Could not download the voucher', description: 'Try again in a moment.' }))
  const allocCols: DataColumn[] = [
    { key: 'number', label: 'Bill', render: (_v, r) => <Link to={`/purchases/bills/${r.docId}`} onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
    { key: 'date', label: 'Applied on' },
    { key: 'amount', label: 'Amount (৳)', type: 'amount' },
  ]
  const allocRows = p.allocations.map((a) => ({ id: a.id, docId: a.document_id, number: a.document_number, date: shortDate(a.allocated_on), amount: a.amount }))
  const journalCols: DataColumn[] = [{ key: 'code', label: 'Ledger', mono: true }, { key: 'name', label: 'Name' }, { key: 'debit', label: 'Debit (৳)', type: 'amount' }, { key: 'credit', label: 'Credit (৳)', type: 'amount' }]
  const journalRows = v.lines.map((l) => ({ id: l.line_no, code: l.ledger_code, name: l.ledger_name, debit: l.debit === '0.00' ? '' : l.debit, credit: l.credit === '0.00' ? '' : l.credit }))
  const posted = v.status === 'posted'

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="lf-label">Payment made</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, font: '500 28px/34px var(--font-serif)' }} data-testid="payment-number">{v.voucher_number}</h1>
            <span data-testid="payment-status"><VoucherStatusBadge status={v.status} /></span>
          </div>
          <span style={{ color: 'var(--ink-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {p.party && <Link to={`/suppliers/${p.party.id}`}>{p.party.name}</Link>}
            <span>{shortDate(v.entry_date)}</span>
            <span>{methodLabel(p.method)}{p.cheque_number ? ` · cheque ${p.cheque_number}` : ''}{p.transaction_reference ? ` · ref. ${p.transaction_reference}` : ''}</span>
            <span>From {p.money_account.name}</span>
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="ghost" icon="chevron-left" onClick={() => navigate('/purchases/payments')}>All payments</Button>
          <Button variant="secondary" icon="download" onClick={() => void pdf()} data-testid="payment-pdf">Voucher PDF</Button>
          {can('accounting.view') && <Button variant="secondary" onClick={() => navigate(`/accounting/vouchers/${v.id}`)}>Open voucher</Button>}
        </div>
      </div>
      {v.status === 'submitted' && v.approval && (
        <Banner tone="warning" title="Waiting for approval" action={<Button variant="secondary" size="sm" onClick={() => setApproval(true)} data-testid="open-approval">Open request</Button>}>
          Above {v.approval.requested_by.name}'s payment limit. Nothing is paid until an approver accepts it; it then settles the oldest bills first.
        </Banner>
      )}
      {v.status === 'rejected' && v.approval?.comment && <Banner tone="negative" title="Rejected">{v.approval.comment}</Banner>}
      <div className="lf-grid" style={{ marginTop: 12 }}>
        <SummaryTile label="Amount" testId="payment-amount" value={formatTaka(p.amount, { symbol: true })} sub={v.amount_in_words} />
        {posted && <SummaryTile label="Advance left" testId="payment-unapplied" value={formatTaka(p.unapplied_amount, { symbol: true })}
          sub={p.unapplied_amount === '0.00' ? 'All applied to bills' : 'Can be applied to a later bill'} />}
        {p.bank_charge !== '0.00' && <SummaryTile label="Bank charge" value={formatTaka(p.bank_charge, { symbol: true })} sub="Charged on top" />}
      </div>
      <div style={{ overflowX: 'auto', margin: '8px 0 16px' }}><Tabs items={TABS} value={tab} onChange={setTab} /></div>
      {tab === 'applied' && (
        <Card title="Applied to bills" padding="none">
          {allocRows.length
            ? <div style={{ overflowX: 'auto' }} data-testid="payment-allocations"><DataTable caption="Applied to" columns={allocCols} rows={allocRows} /></div>
            : <p style={{ padding: '16px 20px', margin: 0, color: 'var(--ink-muted)' }}>{posted ? 'Not applied to any bill; the whole amount is an advance.' : 'Applied when it is posted.'}</p>}
        </Card>
      )}
      {tab === 'ledger' && <Card title="Ledger entries" padding="none"><div style={{ overflowX: 'auto' }}><DataTable caption="Ledger entries" columns={journalCols} rows={journalRows} /></div></Card>}
      {tab === 'activity' && (
        <Card title="Activity">
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(v.audit_trail ?? []).map((a) => <li key={a.id}><strong>{a.action.replace(/_/g, ' ')}</strong> <span style={{ color: 'var(--ink-muted)' }}>{a.user?.name ?? 'System'} · {new Date(a.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</span></li>)}
          </ol>
        </Card>
      )}
      {approval && v.approval && <ApprovalDrawer id={v.approval.id} onClose={() => setApproval(false)} />}
    </>
  )
}
