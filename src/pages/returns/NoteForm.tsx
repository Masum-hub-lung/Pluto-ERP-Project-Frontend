import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Note, NoteInput, Party } from '../../api/contract.gen'
import { useMoneyAccounts } from '../../api/money'
import { useParty } from '../../api/parties'
import { dhakaToday } from '../../api/platform'
import { useBills } from '../../api/purchases'
import { useInvoices } from '../../api/sales'
import { creditNotes, debitNotes, openPdf } from '../../api/trade'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DeleteDialog } from '../../components/DeleteDialog'
import { PageSkeleton } from '../../components/PageSkeleton'
import { PartyPicker } from '../../components/pickers/PartyPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden, NotFound } from '../../components/states'
import { ActionBar, DocStatusBadge, ReasonDialog } from '../../components/trade/TradeParts'
import { shortDate } from '../purchases/BillList'
import type { Side } from './ReturnForm'

/**
 * E9 Credit note and F7 Debit note (backlog P10.3-FE-02, P10.4-FE-02; 06 §7, §10; BR-023; R-04): reason, amount and how
 * it is used — apply to an invoice or bill of the same party (at most its balance), keep as credit, or refund (sales:
 * paid out now from a money account; purchases: the supplier pays later). A return's credit note arrives here as a draft
 * to check and post; a return's debit note is posted with its return and read-only here. A posted note shows its journal
 * and allocations, and can be cancelled with a reason (the invoice or bill opens again).
 */
const COPY = {
  sales: {
    title: 'Credit note', party: 'customer' as const, doc: 'invoice', base: '/sales/credit-notes', list: '/sales/returns?view=notes', perm: 'sales',
    reasons: [['price_correction', 'Price correction'], ['damaged_on_delivery', 'Damaged on delivery'], ['goodwill', 'Goodwill'], ['goods_returned', 'Goods returned']],
  },
  purchases: {
    title: 'Debit note', party: 'supplier' as const, doc: 'bill', base: '/purchases/debit-notes', list: '/purchases/returns?view=notes', perm: 'purchases',
    reasons: [['price_difference', 'Price difference'], ['short_supply', 'Short supply'], ['quality_claim', 'Quality claim'], ['goods_returned', 'Goods returned']],
  },
}
const METHODS = [['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['bkash', 'bKash'], ['nagad', 'Nagad'], ['beftn', 'BEFTN'], ['npsb', 'NPSB'], ['rtgs', 'RTGS'], ['card', 'Card']]

export function NoteForm({ side, mode }: { side: Side; mode: 'new' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const n$ = side === 'sales' ? creditNotes : debitNotes
  const note = n$.useOne(mode === 'edit' ? id : 0)
  const party = useParty(note.data?.party.id ?? 0)
  const c = COPY[side]
  if (mode === 'new' && !can(`${c.perm}.create`)) return <Forbidden permission={`${c.perm}.create`} what={`creating ${c.title.toLowerCase()}s`} />
  if (mode === 'edit') {
    if (note.error instanceof ApiError && note.error.status === 404) return <NotFound what={`this ${c.title.toLowerCase()}`} back={c.list} backLabel="Notes" />
    if (note.error) return <ProblemBanner error={note.error} onRetry={() => void note.refetch()} />
    if (!note.data || (!party.data && !party.error)) return <PageSkeleton template="form" />
  }
  return <Form key={mode === 'edit' ? `${id}-${note.data?.status}` : 'new'} side={side} initial={note.data ?? null} initialParty={party.data?.party ?? null} />
}

function Form({ side, initial, initialParty }: { side: Side; initial: Note | null; initialParty: Party | null }) {
  const { Card, Field, Input, Select, PageHeader, Button, Banner, Segmented, DataTable } = ds()
  const c = COPY[side]
  const n$ = side === 'sales' ? creditNotes : debitNotes
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const [current, setCurrent] = useState(initial)
  const fromReturn = !!current?.return_id
  const editable = (!current || current.status === 'draft') && !(side === 'purchases' && fromReturn)
  const refund = (current?.refund ?? null) as { money_account_id?: number; method?: string; reference?: string | null } | null
  const [party, setParty] = useState<Party | null>(initialParty)
  const [date, setDate] = useState(current?.note_date ?? dhakaToday())
  const [reason, setReason] = useState(current?.reason ?? c.reasons[0]![0])
  const [amount, setAmount] = useState(current?.amount ?? '')
  const [usage, setUsage] = useState<string>(current?.usage ?? 'apply')
  const [applyTo, setApplyTo] = useState(current?.apply_to_document_id ? String(current.apply_to_document_id) : '')
  const [account, setAccount] = useState(refund?.money_account_id ? String(refund.money_account_id) : '')
  const [method, setMethod] = useState(refund?.method ?? 'cash')
  const [error, setError] = useState<unknown>(null)
  const [dialog, setDialog] = useState<null | 'post' | 'cancel' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const create = n$.useCreate()
  const update = n$.useUpdate(current?.id ?? 0)
  const del = n$.useDelete(current?.id ?? 0)
  const post = n$.useAction(current?.id ?? 0, 'post')
  const cancel = n$.useAction<{ reason: string }>(current?.id ?? 0, 'cancel')
  const saveIdem = useIdempotencyKey()
  const postIdem = useIdempotencyKey()
  const cancelIdem = useIdempotencyKey()
  const accounts = useMoneyAccounts({ purpose: 'payments' })
  const invoices = useInvoices({ party_id: party?.id, status: 'posted', per_page: 50, sort: '-invoice_date' }, side === 'sales' && !!party)
  const bills = useBills({ party_id: party?.id, status: 'posted', per_page: 50, sort: '-bill_date' } as never, side === 'purchases' && !!party)
  const docs = !party ? [] : side === 'sales' ? invoices.data?.data ?? [] : bills.data?.data ?? []
  useEffect(() => { if (!applyTo && current?.source_document_id && usage === 'apply') setApplyTo(String(current.source_document_id)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function input(): NoteInput {
    return {
      party_id: party?.id ?? 0, source_document_id: current?.source_document_id ?? (applyTo ? Number(applyTo) : null), note_date: date, reason, amount: amount.trim(),
      usage: usage as NoteInput['usage'], apply_to_document_id: usage === 'apply' && applyTo ? Number(applyTo) : null,
      refund: side === 'sales' && usage === 'refund' ? { money_account_id: Number(account), method: method as never } : null,
    }
  }

  async function save() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(null)
    try {
      const saved = current ? await update.mutateAsync({ input: input(), version: current.version }) : await create.mutateAsync({ input: input(), idempotencyKey: saveIdem.key })
      if (!current) saveIdem.reset()
      setCurrent(saved)
      toast({ tone: 'positive', title: `Draft ${saved.number} saved`, description: `${formatTaka(saved.amount, { symbol: true })} · not posted yet` })
      if (!current) navigate(`${c.base}/${saved.id}`, { replace: true })
    } catch (e) {
      setError(e)
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }

  async function doPost() {
    try {
      const posted = await post.mutateAsync({ idempotencyKey: postIdem.key })
      postIdem.reset(); setDialog(null); setCurrent(posted)
      toast({ tone: 'positive', title: `${posted.number} posted`, description: `${posted.party.name} is ${side === 'sales' ? 'credited' : 'debited'} ${formatTaka(posted.amount, { symbol: true })}.` })
    } catch (e) {
      setDialog(null); setError(e)
    }
  }

  const docOptions = [{ value: '', label: party ? `Choose the ${c.doc}` : `Choose the ${c.party} first` },
    ...docs.map((d) => ({ value: String(d.id), label: `${d.number} · balance ${formatTaka(d.balance_due)}` }))]
  if (applyTo && !docs.some((d) => String(d.id) === applyTo)) docOptions.push({ value: applyTo, label: current?.source_number ?? `#${applyTo}` })
  const accountOptions = [{ value: '', label: 'Choose…' }, ...(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))]
  const effects = (current?.effects ?? []) as { text?: string }[]

  return (
    <>
      <PageHeader eyebrow={side === 'sales' ? 'Sales' : 'Purchases'} title={current ? `${c.title} ${current.number}` : `New ${c.title.toLowerCase()}`}
        description={current ? `${current.party.name} · ${shortDate(current.note_date)}${current.return_number ? ` · from return ${current.return_number}` : ''}`
          : side === 'sales' ? 'Credit a customer for a price correction, damage on delivery or goodwill.' : 'Debit a supplier for a price difference, short supply or a quality claim.'} />
      {current && (
        <ActionBar>
          <DocStatusBadge status={current.status} />
          <Button variant="secondary" size="sm" icon="file-text" onClick={() => void openPdf(() => n$.pdf(current.id), `${current.number}.pdf`)
            .catch(() => toast({ tone: 'negative', title: 'Could not open the PDF' }))}>Preview PDF</Button>
          {current.return_id && <Button variant="secondary" size="sm" onClick={() => navigate(`${side === 'sales' ? '/sales/returns' : '/purchases/returns'}/${current.return_id}`)}>Open return {current.return_number}</Button>}
          {editable && current.status === 'draft' && can(`${c.perm}.create`) && <Button variant="primary" size="sm" onClick={() => setDialog('post')} data-testid="post-note">Post {c.title.toLowerCase()}</Button>}
          {current.status === 'posted' && !(side === 'purchases' && fromReturn) && can(`${c.perm}.edit`) && <Button variant="ghost" size="sm" onClick={() => setDialog('cancel')} data-testid="cancel-note">Cancel note</Button>}
          {editable && current.status === 'draft' && !fromReturn && can(`${c.perm}.delete`) && <Button variant="ghost" size="sm" icon="trash-2" onClick={() => setDialog('delete')}>Delete draft</Button>}
        </ActionBar>
      )}
      {side === 'purchases' && fromReturn && <div style={{ marginBottom: 12 }}><Banner tone="info" title="Posted with its return">This debit note shares the return's entry, so the supplier is debited once. Cancel the return to undo it.</Banner></div>}
      {current?.cancel_reason && <div style={{ marginBottom: 12 }}><Banner tone="warning" title="Cancelled">{current.cancel_reason}</Banner></div>}
      <ProblemBanner error={error} />
      {error instanceof ApiError && Object.keys(error.fieldErrors).length > 0 && (
        <ul style={{ margin: '8px 0 12px', paddingLeft: 18, color: 'var(--negative)', fontSize: 14 }} data-testid="note-errors">
          {Object.values(error.fieldErrors).flat().map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
      <Card title={`${c.title} details`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <Field label={side === 'sales' ? 'Customer' : 'Supplier'}>
            <PartyPicker type={c.party} value={party} disabled={!editable || fromReturn} onChange={(p) => { setParty(p); setApplyTo('') }} aria-label={c.party} />
          </Field>
          <Field label="Date" htmlFor="note-date"><Input id="note-date" type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Reason" htmlFor="note-reason">
            <Select id="note-reason" options={c.reasons.map(([v, l]) => ({ value: v!, label: l! }))} value={reason} disabled={!editable || fromReturn} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Amount (৳)" htmlFor="note-amount"><Input id="note-amount" mono inputMode="decimal" value={amount} disabled={!editable} onChange={(e) => setAmount(e.target.value)} data-testid="note-amount" /></Field>
        </div>
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          <Field label="Use it to">
            <Segmented options={[{ value: 'apply', label: `Apply to ${c.doc}` }, { value: 'credit', label: 'Keep as credit' }, { value: 'refund', label: 'Refund' }]}
              value={usage} onChange={(v: string) => { if (editable) setUsage(v) }} />
          </Field>
          {usage === 'apply' && (
            <Field label={`${c.doc === 'invoice' ? 'Invoice' : 'Bill'} it settles`} hint="At most its balance" htmlFor="note-apply">
              <Select key={docOptions.length} id="note-apply" options={docOptions} value={applyTo} disabled={!editable} onChange={(e) => setApplyTo(e.target.value)} data-testid="note-apply" />
            </Field>
          )}
          {usage === 'refund' && side === 'sales' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <Field label="Pay from" htmlFor="note-acct"><Select key={accountOptions.length} id="note-acct" options={accountOptions} value={account} disabled={!editable} onChange={(e) => setAccount(e.target.value)} /></Field>
              <Field label="Method" htmlFor="note-method"><Select id="note-method" options={METHODS.map(([v, l]) => ({ value: v!, label: l! }))} value={method} disabled={!editable} onChange={(e) => setMethod(e.target.value)} /></Field>
            </div>
          )}
          {usage === 'refund' && side === 'purchases' && <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-muted)' }}>Record the supplier's money as a receipt when it arrives.</p>}
        </div>
      </Card>
      {current && current.status !== 'draft' && (
        <>
          <div style={{ height: 16 }} />
          <Card title="What posting did">
            <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="note-effects">{effects.map((e, i) => <li key={i}>{e.text}</li>)}</ul>
            {(current.journal ?? []).length > 0 && (
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <DataTable caption="Journal" rows={(current.journal ?? []).map((l, i) => ({ id: i, ledger: `${l.ledger_code} ${l.ledger_name}`, debit: l.debit, credit: l.credit }))}
                  columns={[{ key: 'ledger', label: 'Ledger' }, { key: 'debit', label: 'Debit (৳)', type: 'amount' }, { key: 'credit', label: 'Credit (৳)', type: 'amount' }]} />
              </div>
            )}
          </Card>
        </>
      )}
      {editable && (
        <div className="lf-form-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button variant="secondary" onClick={() => navigate(c.list)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()} data-testid="save-note">Save draft</Button>
        </div>
      )}

      {dialog === 'post' && current && (
        <ConfirmDialog title={`Post ${current.number}?`} confirmLabel="Post" tone="info" loading={post.isPending} onConfirm={() => void doPost()} onClose={() => setDialog(null)}
          description={`${current.party.name} is ${side === 'sales' ? 'credited' : 'debited'} ${formatTaka(current.amount, { symbol: true })}${usage === 'apply' ? ` and it is applied to the ${c.doc}` : usage === 'refund' && side === 'sales' ? ' and the refund is paid out' : ''}.`} />
      )}
      {dialog === 'cancel' && current && (
        <ReasonDialog title={`Cancel ${current.number}?`} confirmLabel="Cancel note" loading={cancel.isPending} onClose={() => setDialog(null)}
          description={`A mirror entry reverses it; any ${c.doc} it settled is open again${current.refund ? ' and the refund is reversed' : ''}.`}
          onConfirm={async (r) => {
            const n = await cancel.mutateAsync({ body: { reason: r }, idempotencyKey: cancelIdem.key })
            cancelIdem.reset(); setCurrent(n); setDialog(null)
            toast({ tone: 'positive', title: `${n.number} cancelled` })
          }} />
      )}
      {dialog === 'delete' && current && (
        <DeleteDialog name={current.number} what="draft" description="Its number is voided and never reused." loading={del.isPending} onClose={() => setDialog(null)}
          onConfirm={() => void del.mutateAsync().then(() => { toast({ tone: 'positive', title: 'Draft deleted' }); navigate(c.list) }).catch((e) => { setDialog(null); setError(e) })} />
      )}
    </>
  )
}
