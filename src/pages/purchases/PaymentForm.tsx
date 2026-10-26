import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Party, PartyPaymentInput } from '../../api/contract.gen'
import { useMoneyAccounts } from '../../api/money'
import { useParty } from '../../api/parties'
import { dhakaToday } from '../../api/platform'
import { METHODS, methodLabel, paymentOf, useOpenDocuments } from '../../api/receipts'
import { useCreateSupplierPayment } from '../../api/supplierPayments'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PartyPicker } from '../../components/pickers/PartyPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden } from '../../components/states'
import { shortDate } from '../purchases/BillList'

/**
 * F5 Supplier payment + Pur-DlgPay (Pur-Payment.dc.html; backlog P8.2-FE-02; FR-052): a copy of E7 for money out. Pay
 * from an account switched on for payments, then settle the supplier's open bills oldest due first (auto_allocate),
 * by chosen amounts (BR-020) or keep it as an advance. The server checks the account can cover it (BR-031) and the
 * user's payment limit: 201 posted, or 202 saved and sent for approval (BR-007). Back-dated payments ask first (BR-053).
 * Prefill: ?party_id= (C4) and ?bill_id= (F4 "Record payment": that bill, its balance as the amount).
 */
type Mode = 'auto' | 'manual' | 'advance'
const money = /^\d{1,16}(\.\d{1,2})?$/

export function PaymentForm() {
  const { can } = useSession()
  if (!can('purchases.create')) return <Forbidden permission="purchases.create" what="paying suppliers" />
  return <Form />
}

function Form() {
  const { PageHeader, Card, Field, Input, Select, Segmented, Button, Banner, DataTable, EmptyState } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const prefillParty = useParty(Number(params.get('party_id')) || 0)
  const billId = Number(params.get('bill_id')) || 0
  const accounts = useMoneyAccounts({ purpose: 'payments' })
  const create = useCreateSupplierPayment()
  const [backdated, setBackdated] = useState(false)
  const idem = useIdempotencyKey()
  const [party, setParty] = useState<Party | null>(null)
  const [date, setDate] = useState(dhakaToday())
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [method, setMethod] = useState<PartyPaymentInput['method']>('cash')
  const [cheque, setCheque] = useState({ number: '', date: '', drawnOn: '' })
  const [reference, setReference] = useState('')
  const [charge, setCharge] = useState('')
  const [narration, setNarration] = useState('')
  const [mode, setMode] = useState<Mode>(billId ? 'manual' : 'auto')
  const [apply, setApply] = useState<Record<number, string>>({})
  const [tried, setTried] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [dirty, setDirty] = useState(false)
  const busy = useRef(false)
  const guard = useUnsavedChangesBlocker(dirty, 'This payment has not been saved.')
  const open = useOpenDocuments(party?.id ?? 0)

  useEffect(() => { if (prefillParty.data && !party) setParty(prefillParty.data.party) }, [prefillParty.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // the first account switched on for payments is the default "Pay from"
    if (!accountId && accounts.data?.length) setAccountId(String(accounts.data[0]!.id))
  }, [accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // F4 "Record payment": that bill, its open balance as the amount
    const doc = open.data?.documents.find((d) => d.id === billId)
    if (doc && !amount) { setAmount(doc.balance); setApply({ [doc.id]: doc.balance }) }
  }, [open.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true) }
  const fieldErrors = error instanceof ApiError && error.status === 422 ? error.fieldErrors : {}
  const serverErr = (k: string) => fieldErrors[k]?.[0]
  const local: Record<string, string | undefined> = {
    party: !party ? 'Choose the supplier' : undefined,
    amount: !money.test(amount.trim()) || /^0*(\.0*)?$/.test(amount.trim()) ? 'Enter an amount greater than zero' : undefined,
    money_account_id: !accountId ? 'Choose the account it is paid from' : undefined,
    cheque_number: method === 'cheque' && !cheque.number.trim() ? 'Enter the cheque number' : undefined,
    cheque_date: method === 'cheque' && !cheque.date ? 'Enter the cheque date' : undefined,
    drawn_on: method === 'cheque' && !cheque.drawnOn.trim() ? 'Enter the bank the cheque is drawn on' : undefined,
    bank_charge: charge.trim() && !money.test(charge.trim()) ? 'Enter an amount with up to 2 decimals' : undefined,
  }
  const rows = open.data?.documents ?? []
  const applyErr = (i: number, id: number) => serverErr(`allocations.${i}.amount`) ?? (apply[id]?.trim() && !money.test(apply[id]!.trim()) ? 'Up to 2 decimals' : undefined)
  const manual = rows.filter((d) => apply[d.id]?.trim() && !/^0*(\.0*)?$/.test(apply[d.id]!.trim()))
  const msg = (k: string) => (tried ? local[k] : undefined) ?? serverErr(k)
  const invalid = Object.values(local).some(Boolean) || (mode === 'manual' && manual.some((d) => !money.test(apply[d.id]!.trim())))

  function input(confirm = false): PartyPaymentInput {
    return {
      party_id: party!.id, date, amount: amount.trim(), money_account_id: Number(accountId), method,
      cheque_number: method === 'cheque' ? cheque.number.trim() : null, cheque_date: method === 'cheque' ? cheque.date : null,
      drawn_on: method === 'cheque' ? cheque.drawnOn.trim() : null, transaction_reference: reference.trim() || null,
      ...(charge.trim() ? { bank_charge: charge.trim() } : {}), narration: narration.trim() || null,
      ...(mode === 'auto' ? { auto_allocate: true } : {}),
      ...(mode === 'manual' ? { allocations: manual.map((d) => ({ document_id: d.id, amount: apply[d.id]!.trim() })) } : {}),
      ...(confirm ? { confirm_backdated: true } : {}),
    }
  }

  async function save(confirm = false) {
    if (busy.current) return
    busy.current = true
    setError(null)
    try {
      const { voucher: v, approval } = await create.mutateAsync({ input: input(confirm), idempotencyKey: idem.key })
      idem.reset()
      const p = paymentOf(v)
      const applied = p?.allocations.map((a) => `${a.document_number} ${formatTaka(a.amount, { symbol: true })}`).join(', ')
      toast(approval
        ? { tone: 'info', title: `${v.voucher_number} sent for approval`, description: 'Above your payment limit: it is paid when an approver accepts it, against the oldest bills first.' }
        : { tone: 'positive', title: `${v.voucher_number} paid`, description: [applied ? `Applied to ${applied}` : null,
          p && p.unapplied_amount !== '0.00' ? `${formatTaka(p.unapplied_amount, { symbol: true })} kept as advance` : null].filter(Boolean).join(' · ') })
      guard.allowNavigation()
      navigate(`/purchases/payments/${v.id}`)
    } catch (e) {
      setConfirming(false)
      if (e instanceof ApiError && e.code === 'backdated_confirmation_required') { idem.reset(); setBackdated(true); return }
      setError(e)
    } finally {
      busy.current = false
    }
  }

  const docCols: DataColumn[] = [
    { key: 'number', label: 'Bill', mono: true },
    { key: 'date', label: 'Date' },
    { key: 'due', label: 'Due', render: (_v, r) => <span>{r.due}{r.late > 0 && <span style={{ color: 'var(--negative)', fontSize: 12 }}> · {r.late} days late</span>}</span> },
    { key: 'balance', label: 'Balance (৳)', type: 'amount' },
    ...(mode === 'manual' ? [{ key: 'apply', label: 'Apply (৳)', align: 'right' as const, render: (_v: unknown, r: { id: number; idx: number }) => {
      const e = applyErr(manual.findIndex((d) => d.id === r.id), r.id)
      return (
        <div style={{ minWidth: 120 }}>
          <Input mono align="right" inputMode="decimal" value={apply[r.id] ?? ''} invalid={!!e} aria-label={`Apply to ${rows[r.idx]!.number}`}
            onChange={(ev) => { setApply((a) => ({ ...a, [r.id]: ev.target.value })); setDirty(true) }} />
          {e && <div role="alert" style={{ color: 'var(--negative)', fontSize: 12 }}>{e}</div>}
        </div>
      )
    } }] : []),
  ]
  const docRows = rows.map((d, idx) => ({ id: d.id, idx, number: d.number, date: shortDate(d.date), due: shortDate(d.due_date), late: d.days_overdue, balance: d.balance }))
  const account = accounts.data?.find((a) => String(a.id) === accountId)

  return (
    <form onSubmit={(e) => { e.preventDefault(); setTried(true); if (!invalid) setConfirming(true) }} noValidate data-testid="payment-form">
      <PageHeader eyebrow="Purchases" title="Supplier payment" description="Pay a supplier and apply it to their open bills." />
      <ProblemBanner error={error instanceof ApiError && error.status === 422 && Object.keys(fieldErrors).length ? null : error} />
      {error instanceof ApiError && error.code === 'allocation_exceeds_balance' && <div style={{ marginBottom: 12 }}><Banner tone="negative" title="Too much applied">{error.problem.detail}</Banner></div>}
      {error instanceof ApiError && error.code === 'insufficient_funds' && <div style={{ marginBottom: 12 }}><Banner tone="negative" title="More than the account holds">{error.problem.detail}</Banner></div>}
      <Card title="Payment">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <Field label="Pay to" required error={msg('party')} htmlFor="rc-party">
            <PartyPicker id="rc-party" type="supplier" value={party} onChange={(p) => { setParty(p); setApply({}); setDirty(true) }} invalid={!!msg('party')} aria-label="Pay to" />
          </Field>
          <Field label="Voucher number" hint="Given when saved"><Input mono readOnly value="PV-…" aria-label="Voucher number" /></Field>
          <Field label="Date" required error={serverErr('date')} htmlFor="rc-date"><Input id="rc-date" type="date" value={date} onChange={(e) => touch(setDate)(e.target.value)} /></Field>
          <Field label="Amount paid (৳)" required error={msg('amount')} htmlFor="rc-amount">
            <Input id="rc-amount" mono align="right" inputMode="decimal" value={amount} invalid={!!msg('amount')} onChange={(e) => touch(setAmount)(e.target.value)} />
          </Field>
          <Field label="Pay from" required error={msg('money_account_id')} htmlFor="rc-account"
            hint={accounts.data && accounts.data.length === 0 ? 'No account makes payments yet: add one in Cash and bank'
              : account?.book_balance ? `Balance ${formatTaka(account.book_balance, { symbol: true })}` : undefined}>
            <Select key={accounts.data?.length ?? 0} id="rc-account" value={accountId} onChange={(e) => touch(setAccountId)(e.target.value)} invalid={!!msg('money_account_id')}
              options={[{ value: '', label: 'Choose…' }, ...(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} />
          </Field>
          <Field label="Method" required htmlFor="rc-method">
            <Select id="rc-method" value={method} onChange={(e) => touch(setMethod)(e.target.value as PartyPaymentInput['method'])} options={METHODS} />
          </Field>
          {method === 'cheque' && <>
            <Field label="Cheque number" required error={msg('cheque_number')} htmlFor="rc-chq"><Input id="rc-chq" mono value={cheque.number} invalid={!!msg('cheque_number')} onChange={(e) => touch(setCheque)({ ...cheque, number: e.target.value })} /></Field>
            <Field label="Cheque date" required error={msg('cheque_date')} htmlFor="rc-chqdate"><Input id="rc-chqdate" type="date" value={cheque.date} invalid={!!msg('cheque_date')} onChange={(e) => touch(setCheque)({ ...cheque, date: e.target.value })} /></Field>
            <Field label="Drawn on" required error={msg('drawn_on')} htmlFor="rc-drawn"><Input id="rc-drawn" value={cheque.drawnOn} invalid={!!msg('drawn_on')} placeholder="Bank and branch" onChange={(e) => touch(setCheque)({ ...cheque, drawnOn: e.target.value })} /></Field>
          </>}
          {method !== 'cash' && method !== 'cheque' && (
            <Field label="Transaction reference" error={serverErr('transaction_reference')} htmlFor="rc-ref"><Input id="rc-ref" mono value={reference} onChange={(e) => touch(setReference)(e.target.value)} /></Field>
          )}
          {method !== 'cash' && (
            <Field label="Bank charge (৳)" hint="Fee the bank takes on top" error={msg('bank_charge')} htmlFor="rc-charge">
              <Input id="rc-charge" mono align="right" inputMode="decimal" value={charge} invalid={!!msg('bank_charge')} onChange={(e) => touch(setCharge)(e.target.value)} />
            </Field>
          )}
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Apply to bills" subtitle={party ? `${party.name}'s open bills, oldest due first` : 'Choose the supplier first'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ overflowX: 'auto' }} data-testid="apply-mode">
            <Segmented value={mode} onChange={(m) => { setMode(m as Mode); setDirty(true) }}
              options={[{ value: 'auto', label: 'Oldest first' }, { value: 'manual', label: 'Choose amounts' }, { value: 'advance', label: 'Keep as advance' }]} />
          </div>
          {mode === 'auto' && <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>The payment settles the bills below from the oldest due date. Anything left over stays with the supplier as an advance.</span>}
          {mode === 'advance' && <Banner tone="info">The whole amount is an advance to the supplier. You can apply it to bills later.</Banner>}
          {serverErr('allocations') && <Banner tone="negative">{serverErr('allocations')}</Banner>}
          {party && (open.data && rows.length === 0
            ? <EmptyState icon="circle-check" title="No open bills" description="The whole payment will be an advance." />
            : <div style={{ overflowX: 'auto' }} data-testid="open-bills"><DataTable caption="Open bills" columns={docCols} rows={docRows} loading={open.isPending} /></div>)}
          {open.data && open.data.unapplied_credit !== '0.00' && (
            <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>This supplier already has {formatTaka(open.data.unapplied_credit, { symbol: true })} unapplied from earlier payments or notes.</span>
          )}
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Narration">
        <textarea aria-label="Narration" value={narration} onChange={(e) => touch(setNarration)(e.target.value)} placeholder="Optional, e.g. against BILL-…"
          style={{ width: '100%', minHeight: 64, boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', font: '14px/20px var(--font-sans)', color: 'var(--ink)', background: 'var(--surface)' }} />
      </Card>
      <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, margin: '16px -24px -48px', padding: '12px 24px', background: 'var(--surface)',
        borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
        <Button variant="primary" icon="check" onClick={() => { setTried(true); if (!invalid) setConfirming(true) }} data-testid="save-payment">Save payment</Button>
      </div>
      {confirming && party && (
        <ConfirmDialog title="Save this payment?" confirmLabel="Save payment" tone="info" loading={create.isPending} onConfirm={() => void save()} onClose={() => setConfirming(false)}
          description={`To ${party.name}: ${formatTaka(amount.trim(), { symbol: true })} from ${account?.name ?? 'the chosen account'} by ${methodLabel(method)}. ${
            mode === 'auto' ? 'It settles the oldest bills first; any excess is an advance.' : mode === 'manual' ? `Applied to ${manual.length} bill${manual.length === 1 ? '' : 's'} as entered; the rest is an advance.` : 'All of it is an advance.'}`} />
      )}
      {backdated && party && (
        <ConfirmDialog title="Save a back-dated payment?" confirmLabel="Yes, save it" tone="warning" loading={create.isPending} onConfirm={() => { setBackdated(false); void save(true) }}
          onClose={() => setBackdated(false)} description={`It is dated ${shortDate(date)}, older than the company's back-date window.`} />
      )}
      {guard.dialog}
    </form>
  )
}
