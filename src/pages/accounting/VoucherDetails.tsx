import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Voucher } from '../../api/contract.gen'
import { downloadVoucherPdf, useDeleteVoucher, usePostVoucher, useReverseVoucher, useSubmitVoucher, useVoucher } from '../../api/accounting'
import { dhakaToday } from '../../api/platform'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ApprovalDrawer } from '../../components/ApprovalDrawer'
import { AttachmentUploader } from '../../components/AttachmentUploader'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DeleteDialog } from '../../components/DeleteDialog'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'
import { shortDate } from '../purchases/BillList'
import { canEnter, entryTypeLabel, VOUCHER_TYPES, VoucherStatusBadge, type VoucherType } from './common'

/**
 * H13 Voucher details (Acc-Voucher.dc.html; backlog P7.2-FE-07): status, amount, lines, narration, the approval
 * waiting on it, the audit trail and what it is linked to. Drafts can be edited, posted, sent for approval or deleted;
 * a posted voucher is reversed through the dialog (Acc-DlgReverse, BR-003); entries made by documents point to them.
 */
export function VoucherDetails() {
  const id = Number(useParams().id)
  const q = useVoucher(id)
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this voucher" back="/accounting/vouchers" backLabel="Vouchers" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  return <Details v={q.data} />
}

const SOURCE_LINKS: Record<string, (id: number) => string> = {
  sales_invoices: (id) => `/sales/invoices/${id}`, purchase_bills: (id) => `/purchases/bills/${id}`, parties: (id) => `/customers/${id}`,
}

function Details({ v }: { v: Voucher }) {
  const { Button, Card, DataTable, Banner } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const [dialog, setDialog] = useState<null | 'reverse' | 'delete' | 'post' | 'approval'>(null)
  const [error, setError] = useState<unknown>(null)
  const post = usePostVoucher(v.id)
  const submit = useSubmitVoucher(v.id)
  const del = useDeleteVoucher(v.id)
  const idem = useIdempotencyKey()
  const isVoucher = VOUCHER_TYPES.some((t) => t.value === v.entry_type) && !v.source
  // Expense and income entries (I3/I6, recurring drafts) post, submit, delete and reverse like a payment / receipt;
  // they are changed by deleting the draft and entering again, not in the voucher editor.
  const isIe = (v.entry_type === 'expense' || v.entry_type === 'income') && !v.source
  const actionable = isVoucher || isIe
  const type = (isIe ? (v.entry_type === 'income' ? 'receipt' : 'payment') : v.entry_type) as VoucherType
  const cash = type !== 'journal' && !v.source
  const filesEditable = can(cash ? 'banking.edit' : 'accounting.edit') || (v.status === 'draft' && can(cash ? 'banking.create' : 'accounting.create'))
  const editable = isVoucher && (v.status === 'draft' || v.status === 'rejected') && canEnter(can, type, 'edit')
  const p = v.payment as null | { money_account: { name: string }; party: { id: number; name: string } | null; method: string; cheque_number: string | null; direction: string }

  const doPost = async (confirm = false) => {
    setError(null)
    try {
      const r = await post.mutateAsync({ confirmBackdated: confirm, idempotencyKey: idem.key })
      idem.reset()
      setDialog(null)
      toast(r.approval ? { tone: 'info', title: `${v.voucher_number} sent for approval` } : { tone: 'positive', title: `${v.voucher_number} posted` })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'backdated_confirmation_required') { idem.reset(); setDialog('post'); return }
      setDialog(null)
      setError(e)
    }
  }
  const doSubmit = async () => {
    setError(null)
    try { await submit.mutateAsync(); toast({ tone: 'info', title: `${v.voucher_number} sent for approval` }) } catch (e) { setError(e) }
  }
  const doDelete = async () => {
    try { await del.mutateAsync(); toast({ tone: 'positive', title: `Draft ${v.voucher_number} deleted` }); navigate('/accounting/vouchers') } catch (e) { setDialog(null); setError(e) }
  }
  const pdf = () => downloadVoucherPdf(v.id, v.voucher_number).catch(() => toast({ tone: 'negative', title: 'Could not download the voucher', description: 'Try again in a moment.' }))

  const cols: DataColumn[] = [
    { key: 'code', label: 'Code', mono: true },
    { key: 'name', label: 'Ledger', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <Link to={`/accounting/ledgers/${r.ledgerId}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
        {r.narration && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.narration}</span>}
      </span>) },
    { key: 'debit', label: 'Debit (৳)', type: 'amount' },
    { key: 'credit', label: 'Credit (৳)', type: 'amount' },
  ]
  const rows = v.lines.map((l) => ({ id: l.line_no, ledgerId: l.ledger_id, code: l.ledger_code, name: l.ledger_name, narration: l.line_narration ?? '',
    debit: l.debit === '0.00' ? '' : l.debit, credit: l.credit === '0.00' ? '' : l.credit }))
  const source = v.source as { type?: string; id?: number } | null

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="lf-label">{entryTypeLabel(v.entry_type)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, font: '500 28px/34px var(--font-serif)' }} data-testid="voucher-number">{v.voucher_number}</h1>
            <span data-testid="voucher-status"><VoucherStatusBadge status={v.status} /></span>
          </div>
          <span style={{ color: 'var(--ink-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            <span>{shortDate(v.entry_date)}</span>
            {v.reference && <span>Ref. {v.reference}</span>}
            {p && <span>{p.direction === 'in' ? 'Into' : 'From'} {p.money_account.name}</span>}
            {p?.party && <span>{p.party.name}</span>}
            {v.created_by && <span>By {v.created_by.name}</span>}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="ghost" icon="chevron-left" onClick={() => navigate('/accounting/vouchers')}>Vouchers</Button>
          <Button variant="secondary" icon="download" onClick={() => void pdf()} data-testid="voucher-pdf">PDF</Button>
          {isVoucher && canEnter(can, type) && <Button variant="secondary" icon="copy" onClick={() => navigate(`/accounting/vouchers/new/${type}?from=${v.id}`)}>Duplicate</Button>}
          {editable && <Button variant="secondary" icon="pencil" onClick={() => navigate(`/accounting/vouchers/${v.id}/edit`)} data-testid="edit-voucher">Edit</Button>}
          {actionable && v.status === 'draft' && can('accounting.delete') && <Button variant="danger" icon="trash-2" onClick={() => setDialog('delete')} data-testid="delete-voucher">Delete</Button>}
          {actionable && (v.status === 'draft' || v.status === 'rejected') && canEnter(can, type) && <Button variant="secondary" icon="arrow-up-right" loading={submit.isPending} onClick={() => void doSubmit()}>Submit for approval</Button>}
          {actionable && v.status === 'draft' && canEnter(can, type) && <Button variant="primary" icon="check" loading={post.isPending} onClick={() => void doPost()} data-testid="post-voucher">Post</Button>}
          {actionable && v.status === 'posted' && can('accounting.create') && <Button variant="primary" icon="refresh-cw" onClick={() => setDialog('reverse')} data-testid="reverse-voucher">Reverse</Button>}
        </div>
      </div>
      <ProblemBanner error={error} />
      {v.status === 'submitted' && v.approval && (
        <Banner tone="warning" title="Waiting for approval" action={<Button variant="secondary" size="sm" onClick={() => setDialog('approval')} data-testid="open-approval">Open request</Button>}>
          Above {v.approval.requested_by.name}'s limit; it posts when an approver accepts it.
        </Banner>
      )}
      {v.status === 'rejected' && v.approval?.comment && <Banner tone="negative" title="Rejected">{v.approval.comment}</Banner>}
      {v.reverses_entry_id && <Banner tone="info">This entry reverses <Link to={`/accounting/vouchers/${v.reverses_entry_id}`}>the original voucher</Link>.</Banner>}
      {v.reversed_by_entry_id && <Banner tone="info">Reversed by <Link to={`/accounting/vouchers/${v.reversed_by_entry_id}`}>its reversal entry</Link>.</Banner>}
      {source?.type && source.id && (
        <Banner tone="info">Posted by a document{SOURCE_LINKS[source.type] ? <> — <Link to={SOURCE_LINKS[source.type](source.id)}>open it</Link></> : ''}; it is corrected through that document.</Banner>
      )}
      <div className="lf-grid" style={{ marginTop: 12 }}>
        <SummaryTile label="Amount" testId="voucher-amount" value={formatTaka(v.total_debit, { symbol: true })} sub={v.amount_in_words} />
        <SummaryTile label="Lines" value={String(v.lines.length)} sub={`Dr ${formatTaka(v.total_debit)} · Cr ${formatTaka(v.total_credit)}`} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', marginTop: 16 }}>
        <div style={{ flex: '2 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Entries" padding="none"><div style={{ overflowX: 'auto' }} data-testid="voucher-lines"><DataTable caption="Entries" columns={cols} rows={rows} /></div></Card>
          {v.narration && <Card title="Narration"><p style={{ margin: 0 }}>{v.narration}</p></Card>}
          <Card title="Attachments"><AttachmentUploader type="voucher" recordId={v.id} canEdit={filesEditable} compact testId="voucher-attachments" /></Card>
        </div>
        <div style={{ flex: '1 1 260px' }}>
          <Card title="Activity">
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="audit-trail">
              {(v.audit_trail ?? []).map((a) => (
                <li key={a.id}><strong>{a.action.replace(/_/g, ' ')}</strong> <span style={{ color: 'var(--ink-muted)' }}>{a.user?.name ?? 'System'} · {new Date(a.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</span></li>
              ))}
              {(v.audit_trail ?? []).length === 0 && <li style={{ listStyle: 'none', marginLeft: -18, color: 'var(--ink-muted)' }}>No activity recorded.</li>}
            </ol>
          </Card>
        </div>
      </div>
      {dialog === 'reverse' && <ReverseDialog v={v} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteDialog name={v.voucher_number} what="draft voucher" loading={del.isPending} onConfirm={() => void doDelete()} onClose={() => setDialog(null)} />}
      {dialog === 'post' && <ConfirmDialog title="Post a back-dated voucher?" confirmLabel="Yes, post it" tone="warning" loading={post.isPending}
        description={`It is dated ${shortDate(v.entry_date)}, older than the company's back-date window.`} onConfirm={() => void doPost(true)} onClose={() => setDialog(null)} />}
      {dialog === 'approval' && v.approval && <ApprovalDrawer id={v.approval.id} onClose={() => setDialog(null)} />}
    </>
  )
}

/** Acc-DlgReverse: the reversal date (open period, not before the voucher) and the reason; 201 opens the reversal. */
function ReverseDialog({ v, onClose }: { v: Voucher; onClose: () => void }) {
  const { Field, Input, Button } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const reverse = useReverseVoucher(v.id)
  const idem = useIdempotencyKey()
  const [date, setDate] = useState(dhakaToday())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const fe = error instanceof ApiError && error.status === 422 ? error.fieldErrors : {}
  const go = async () => {
    setError(null)
    try {
      const r = await reverse.mutateAsync({ input: { reversal_date: date, reason: reason.trim() }, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `${v.voucher_number} reversed`, description: `Reversal ${r.voucher_number}` })
      onClose()
      navigate(`/accounting/vouchers/${r.id}`)
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title={`Reverse ${v.voucher_number}?`} description="A new entry with the sides swapped cancels it in the books. Bills it settled open again." tone="warning" onClose={onClose}
      testId="reverse-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={reverse.isPending} onClick={() => void go()} data-testid="confirm-reverse">Reverse</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!Object.keys(fe).length && <ProblemBanner error={error} />}
        <Field label="Reversal date" required error={fe.reversal_date?.[0]} htmlFor="rv-date"><Input id="rv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reason" required error={fe.reason?.[0]} htmlFor="rv-reason"><Input id="rv-reason" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </ResponsiveDialog>
  )
}
