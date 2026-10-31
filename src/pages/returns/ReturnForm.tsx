import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { Party, PurchaseBill, Return, ReturnInput, SalesInvoice } from '../../api/contract.gen'
import { useWarehouses } from '../../api/inventory'
import { useParty } from '../../api/parties'
import { dhakaToday } from '../../api/platform'
import { useBills } from '../../api/purchases'
import { useInvoices } from '../../api/sales'
import { purchaseReturns, salesReturns } from '../../api/trade'
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

/**
 * E8 Sales return and F6 Purchase return (backlog P10.3-FE-01, P10.4-FE-01; 06 §7, §10; BR-022): pick the customer's
 * posted invoice (or the supplier's posted bill), then per line the quantity coming back — at most what is still
 * returnable, shown from the document — and why; restock or write off (sales), send back or already disposed
 * (purchases); and how the note it makes is used. The value of each line is computed by the API when the draft is saved.
 * Posting a sales return makes a draft credit note (opened in E9); posting a purchase return makes its debit note posted
 * with it (R-04). A posted return can be cancelled with a reason.
 */
export type Side = 'sales' | 'purchases'

const COPY = {
  sales: {
    party: 'customer' as const, doc: 'invoice', docs: 'Invoice', note: 'credit note', base: '/sales/returns', noteBase: '/sales/credit-notes', perm: 'sales',
    reasons: [['leaking', 'Leaking'], ['damaged_in_transit', 'Damaged in transit'], ['expired', 'Expired'], ['wrong_item', 'Wrong item'], ['not_needed', 'Not needed']],
    actions: [['restock', 'Restock', 'The goods go back into stock at their original cost'], ['write_off', 'Write off', 'Damaged or expired: nothing comes back into stock']],
  },
  purchases: {
    party: 'supplier' as const, doc: 'bill', docs: 'Bill', note: 'debit note', base: '/purchases/returns', noteBase: '/purchases/debit-notes', perm: 'purchases',
    reasons: [['leaking', 'Leaking'], ['broken', 'Broken'], ['short_supply', 'Short supply'], ['stale_stock', 'Stale stock'], ['torn_packs', 'Torn packs'], ['quality_claim', 'Quality claim']],
    actions: [['send_back', 'Send back', 'The goods leave your stock at the cost they came in at'], ['already_disposed', 'Already disposed', 'Nothing leaves stock; the cost is recovered from the supplier']],
  },
}

interface SourceLine { id: number; product_name: string; product_code: string; unit: string; quantity: string; returned_quantity?: string }
interface ReturnLine { source_line_id: number; quantity: string; reason: string; value?: string }

const api$ = (side: Side) => (side === 'sales' ? salesReturns : purchaseReturns)

export function ReturnForm({ side, mode }: { side: Side; mode: 'new' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const ret = api$(side).useOne(mode === 'edit' ? id : 0)
  const c = COPY[side]
  if (mode === 'new' && !can(`${c.perm}.create`)) return <Forbidden permission={`${c.perm}.create`} what="creating returns" />
  if (mode === 'edit') {
    if (ret.error instanceof ApiError && ret.error.status === 404) return <NotFound what="this return" back={c.base} backLabel="Returns" />
    if (ret.error) return <ProblemBanner error={ret.error} onRetry={() => void ret.refetch()} />
    if (!ret.data) return <PageSkeleton template="form" />
  }
  return <Form key={mode === 'edit' ? `${id}-${ret.data?.status}` : 'new'} side={side} initial={ret.data ?? null} />
}

function Form({ side, initial }: { side: Side; initial: Return | null }) {
  const { Card, Field, Input, Select, PageHeader, Button, Banner, Segmented, DataTable } = ds()
  const c = COPY[side]
  const r$ = api$(side)
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const [params] = useSearchParams()
  const warehouses = useWarehouses()
  const [current, setCurrent] = useState(initial)
  const editable = !current || current.status === 'draft'
  const sourceParty = useParty(current?.party.id ?? 0)
  const [party, setParty] = useState<Party | null>(null)
  useEffect(() => { if (sourceParty.data && !party) setParty(sourceParty.data.party) }, [sourceParty.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const [sourceId, setSourceId] = useState<number>(current?.source_document_id ?? (Number(params.get(c.doc)) || 0))
  const [source, setSource] = useState<SalesInvoice | PurchaseBill | null>(null)
  const [date, setDate] = useState(current?.return_date ?? dhakaToday())
  const [warehouse, setWarehouse] = useState(current ? String(current.warehouse_id) : '')
  const [action, setAction] = useState(current?.stock_action ?? c.actions[0]![0])
  const [usage, setUsage] = useState<string>(current?.usage ?? '')
  const [notes, setNotes] = useState(current?.notes ?? '')
  const [lines, setLines] = useState<Record<number, ReturnLine>>(() => Object.fromEntries(((current?.lines ?? []) as unknown as ReturnLine[]).map((l) => [l.source_line_id, l])))
  const [error, setError] = useState<unknown>(null)
  const [dialog, setDialog] = useState<null | 'post' | 'cancel' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const create = r$.useCreate()
  const update = r$.useUpdate(current?.id ?? 0)
  const del = r$.useDelete(current?.id ?? 0)
  const post = r$.useAction(current?.id ?? 0, 'post')
  const cancel = r$.useAction<{ reason: string }>(current?.id ?? 0, 'cancel')
  const saveIdem = useIdempotencyKey()
  const postIdem = useIdempotencyKey()
  const cancelIdem = useIdempotencyKey()

  // The documents of the chosen party to return against, and the chosen one's lines.
  const invoices = useInvoices({ party_id: party?.id, status: 'posted', per_page: 50, sort: '-invoice_date' }, side === 'sales' && !!party)
  const bills = useBills({ party_id: party?.id, status: 'posted', per_page: 50, sort: '-bill_date' } as never, side === 'purchases' && !!party)
  const docs = side === 'sales' ? (party ? invoices.data?.data ?? [] : []) : (party ? bills.data?.data ?? [] : [])
  useEffect(() => {
    if (!sourceId) { setSource(null); return }
    void api.request<{ data: SalesInvoice | PurchaseBill }>('GET', `/${side === 'sales' ? 'sales-invoices' : 'purchase-bills'}/${sourceId}`).then((res) => {
      setSource(res.data.data)
      if (!warehouse) setWarehouse(String(res.data.data.warehouse_id))
      if (!party) void api.request<{ data: { party: Party } }>('GET', `/parties/${res.data.data.party.id}`).then((p) => setParty(p.data.data.party))
    }).catch(setError)
  }, [sourceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const sourceLines = (source?.lines ?? []) as unknown as SourceLine[]
  const returnable = (l: SourceLine) => {
    const left = Number(l.quantity) - Number(l.returned_quantity ?? 0) // display only: the API checks BR-022 with exact decimals
    return left > 0 ? String(Math.round(left * 1000) / 1000) : '0'
  }
  const setLine = (id: number, patch: Partial<ReturnLine>) =>
    setLines((ls) => ({ ...ls, [id]: { ...(ls[id] ?? { source_line_id: id, quantity: '', reason: c.reasons[0]![0] }), ...patch } }))
  const chosen = Object.values(lines).filter((l) => l.quantity.trim() && !/^0*(\.0*)?$/.test(l.quantity.trim()))

  function input(): ReturnInput {
    return {
      source_document_id: sourceId, return_date: date, warehouse_id: Number(warehouse), stock_action: action as ReturnInput['stock_action'],
      usage: (usage || undefined) as ReturnInput['usage'], notes: notes.trim() || null,
      lines: chosen.map((l) => ({ source_line_id: l.source_line_id, quantity: l.quantity.trim(), reason: l.reason })),
    }
  }

  async function save(then?: (r: Return) => void) {
    if (busyRef.current) return
    if (!sourceId || chosen.length === 0) { setError(new Error(`Choose the ${c.doc} and enter at least one quantity to return.`)); return }
    busyRef.current = true; setBusy(true); setError(null)
    try {
      const saved = current ? await update.mutateAsync({ input: input(), version: current.version }) : await create.mutateAsync({ input: input(), idempotencyKey: saveIdem.key })
      if (!current) saveIdem.reset()
      setCurrent(saved)
      setLines(Object.fromEntries((saved.lines as unknown as ReturnLine[]).map((l) => [l.source_line_id, l])))
      if (then) then(saved)
      else {
        toast({ tone: 'positive', title: `Draft ${saved.number} saved`, description: `Value ${formatTaka(saved.total, { symbol: true })} · not posted yet` })
        if (!current) navigate(`${c.base}/${saved.id}`, { replace: true })
      }
    } catch (e) {
      setError(e)
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }

  async function doPost() {
    try {
      const posted = await post.mutateAsync({ idempotencyKey: postIdem.key })
      postIdem.reset()
      setDialog(null); setCurrent(posted)
      toast({ tone: 'positive', title: `${posted.number} posted`, description: side === 'sales' ? `Draft credit note ${posted.note_number} is ready to check and post.`
        : `Debit note ${posted.note_number} posted with it.` })
      if (side === 'sales' && posted.note_id) navigate(`${c.noteBase}/${posted.note_id}`)
      else navigate(`${c.base}/${posted.id}`, { replace: true })
    } catch (e) {
      setDialog(null); setError(e)
    }
  }

  const docOptions = [{ value: '', label: party ? (docs.length ? `Choose the ${c.doc}` : `No posted ${c.doc}s`) : `Choose the ${c.party} first` },
    ...docs.map((d) => ({ value: String(d.id), label: `${d.number} · ${shortDate('invoice_date' in d ? d.invoice_date : d.bill_date)} · ${formatTaka(d.total)}` }))]
  if (sourceId && !docs.some((d) => d.id === sourceId)) docOptions.push({ value: String(sourceId), label: source?.number ?? `${c.docs} #${sourceId}` })
  const whOptions = [{ value: '', label: 'Choose…' }, ...(warehouses.data ?? []).filter((w) => w.status !== 'inactive').map((w) => ({ value: String(w.id), label: w.name }))]
  const usageOptions = [{ value: '', label: `Default (apply to the ${c.doc} if it has a balance)` }, { value: 'apply', label: `Apply to the ${c.doc}` },
    { value: 'credit', label: `Keep as ${c.party} credit` }, { value: 'refund', label: 'Refund' }]
  const valueOf = (id: number) => (lines[id]?.value ? formatTaka(lines[id]!.value!) : '')

  return (
    <>
      <PageHeader eyebrow={side === 'sales' ? 'Sales · Return' : 'Purchases · Return'} title={current ? current.number : side === 'sales' ? 'New sales return' : 'New purchase return'}
        description={current ? `${current.party.name} · against ${current.source_number} · ${shortDate(current.return_date)}` : `Goods coming back against a posted ${c.doc}.`} />
      {current && (
        <ActionBar>
          <DocStatusBadge status={current.status} />
          {current.note_id && <Button variant="secondary" size="sm" onClick={() => navigate(`${c.noteBase}/${current.note_id}`)}>Open {c.note} {current.note_number}</Button>}
          {editable && can(`${c.perm}.create`) && <Button variant="primary" size="sm" onClick={() => setDialog('post')} data-testid="post-return">Post return</Button>}
          {current.status === 'posted' && can(`${c.perm}.edit`) && <Button variant="ghost" size="sm" onClick={() => setDialog('cancel')} data-testid="cancel-return">Cancel return</Button>}
          {editable && can(`${c.perm}.delete`) && <Button variant="ghost" size="sm" icon="trash-2" onClick={() => setDialog('delete')}>Delete draft</Button>}
        </ActionBar>
      )}
      {current?.cancel_reason && <div style={{ marginBottom: 12 }}><Banner tone="warning" title="Cancelled">{current.cancel_reason}</Banner></div>}
      <ProblemBanner error={error} />
      {error instanceof ApiError && Object.keys(error.fieldErrors).length > 0 && (
        <ul style={{ margin: '8px 0 12px', paddingLeft: 18, color: 'var(--negative)', fontSize: 14 }} data-testid="return-errors">
          {Object.values(error.fieldErrors).flat().map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
      <Card title="Return details">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <Field label={side === 'sales' ? 'Customer' : 'Supplier'}>
            <PartyPicker type={c.party} value={party} disabled={!!current} onChange={(p) => { setParty(p); setSourceId(0); setLines({}) }} aria-label={c.party} />
          </Field>
          <Field label={c.docs} htmlFor="ret-doc">
            <Select key={docOptions.length} id="ret-doc" options={docOptions} value={sourceId ? String(sourceId) : ''} disabled={!!current || !party}
              onChange={(e) => { setSourceId(Number(e.target.value)); setLines({}) }} data-testid="return-source" />
          </Field>
          <Field label="Return date" htmlFor="ret-date"><Input id="ret-date" type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={side === 'sales' ? 'Back into' : 'Leaves from'} htmlFor="ret-wh">
            <Select key={whOptions.length} id="ret-wh" options={whOptions} value={warehouse} disabled={!editable} onChange={(e) => setWarehouse(e.target.value)} />
          </Field>
        </div>
        <div style={{ marginTop: 16 }}>
          <Field label="Stock">
            <Segmented options={c.actions.map(([v, l]) => ({ value: v!, label: l! }))} value={action} onChange={(v: string) => { if (editable) setAction(v) }} />
          </Field>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-muted)' }}>{c.actions.find((a) => a[0] === action)?.[2]}</p>
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Card title="What comes back" padding="none">
        {!source ? <p style={{ padding: 16, color: 'var(--ink-muted)' }}>Choose the {c.doc} to see its lines.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <DataTable caption="Returned lines" rows={sourceLines.map((l) => ({ id: l.id, item: `${l.product_name} · ${l.product_code}`, sold: `${l.quantity} ${l.unit}`, left: returnable(l), l }))}
              columns={[
                { key: 'item', label: 'Item' },
                { key: 'sold', label: side === 'sales' ? 'Invoiced' : 'Billed', align: 'right' },
                { key: 'left', label: 'Returnable', align: 'right' },
                { key: 'qty', label: 'Return', render: (_v: unknown, r: { id: number; left: string }) => (
                  <Input aria-label="Quantity to return" inputMode="decimal" style={{ maxWidth: 110 }} disabled={!editable || r.left === '0'}
                    value={lines[r.id]?.quantity ?? ''} onChange={(e) => setLine(r.id, { quantity: e.target.value })} data-testid={`return-qty-${r.id}`} />) },
                { key: 'reason', label: 'Reason', render: (_v: unknown, r: { id: number }) => (
                  <Select aria-label="Reason" options={c.reasons.map(([v, l]) => ({ value: v!, label: l! }))} disabled={!editable}
                    value={lines[r.id]?.reason ?? c.reasons[0]![0]} onChange={(e) => setLine(r.id, { reason: e.target.value })} />) },
                { key: 'value', label: 'Value (৳)', align: 'right', render: (_v: unknown, r: { id: number }) => <span className="lf-num">{valueOf(r.id)}</span> },
              ]} />
          </div>
        )}
      </Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0', fontWeight: 600 }} data-testid="return-total">
        {current ? `Value ${formatTaka(current.total, { symbol: true })}` : 'The value is worked out when you save'}
      </div>
      <Card title={`The ${c.note}`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <Field label="Use it to" htmlFor="ret-usage"><Select id="ret-usage" options={usageOptions} value={usage} disabled={!editable} onChange={(e) => setUsage(e.target.value)} /></Field>
          <Field label="Notes" htmlFor="ret-notes"><Input id="ret-notes" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
        </div>
      </Card>
      {editable && (
        <div className="lf-form-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button variant="secondary" onClick={() => navigate(c.base)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()} data-testid="save-return">Save draft</Button>
        </div>
      )}

      {dialog === 'post' && current && (
        <ConfirmDialog title={`Post ${current.number}?`} confirmLabel="Post" tone="info" loading={post.isPending} onConfirm={() => void doPost()} onClose={() => setDialog(null)}
          description={side === 'sales'
            ? (action === 'restock' ? 'The goods go back into stock at their original cost and a draft credit note is made for you to post.' : 'Nothing comes back into stock; a draft credit note is made for you to post.')
            : 'The goods leave stock at their bill cost and the supplier is debited by a debit note, in one entry.'} />
      )}
      {dialog === 'cancel' && current && (
        <ReasonDialog title={`Cancel ${current.number}?`} confirmLabel="Cancel return" loading={cancel.isPending} onClose={() => setDialog(null)}
          description={side === 'sales' ? 'The stock entry is reversed. Its credit note is cancelled too, unless it was applied or refunded (cancel the note first).'
            : 'The stock comes back at the same cost, the supplier is credited again and the debit note is cancelled.'}
          onConfirm={async (reason) => {
            const r = await cancel.mutateAsync({ body: { reason }, idempotencyKey: cancelIdem.key })
            cancelIdem.reset(); setCurrent(r); setDialog(null)
            toast({ tone: 'positive', title: `${r.number} cancelled` })
          }} />
      )}
      {dialog === 'delete' && current && (
        <DeleteDialog name={current.number} what="draft" description="Its number is voided and never reused." loading={del.isPending} onClose={() => setDialog(null)}
          onConfirm={() => void del.mutateAsync().then(() => { toast({ tone: 'positive', title: 'Draft deleted' }); navigate(c.base) }).catch((e) => { setDialog(null); setError(e) })} />
      )}
    </>
  )
}
