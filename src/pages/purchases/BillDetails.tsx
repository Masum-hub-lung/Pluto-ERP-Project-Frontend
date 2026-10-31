import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { CancelRequest, PurchaseBill } from '../../api/contract.gen'
import { useWarehouses } from '../../api/inventory'
import { useBill, useCancelBill, usePostBill } from '../../api/purchases'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { PHONE, useMediaQuery } from '../../lib/useMediaQuery'
import { ActivityTimeline } from '../../components/ActivityTimeline'
import { PostDialog } from '../../components/document/PostDialog'
import { totalsRows } from '../../components/document/totals'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'
import { PaymentsPanel } from '../../components/document/PaymentsPanel'
import { BillStatusBadge } from './BillStatusBadge'
import { shortDate } from './BillList'

/**
 * F4 Purchase bill details (Pur-Details.dc.html; backlog P4.5-FE-04): header with status and amounts, then tabs —
 * Bill (lines and totals, read-only), Ledger entries (the posted journal from the bill resource), Activity, and
 * Payments (supplier payments, advances and credits applied, apply/remove, Record payment → F5). Actions: Edit and Post for drafts, Cancel with a reason for posted bills.
 * Print waits for P10.
 */
const TABS = [{ value: 'bill', label: 'Bill' }, { value: 'ledger', label: 'Ledger entries' }, { value: 'activity', label: 'Activity' }, { value: 'payments', label: 'Payments' }]
const REASONS: Array<{ value: CancelRequest['reason'] | ''; label: string }> = [
  { value: '', label: 'Choose a reason…' }, { value: 'entered_by_mistake', label: 'Entered by mistake' }, { value: 'wrong_party', label: 'Wrong supplier' },
  { value: 'duplicate', label: 'Duplicate bill' }, { value: 'customer_cancelled', label: 'Supplier cancelled the bill' }, { value: 'other', label: 'Other' },
]

interface BillLine { line_no: number; product_code: string; product_name: string; unit: string; description: string | null; quantity: string; unit_cost: string
  discount_pct: string | null; tax_amount: string; line_total: string }

export function BillDetails() {
  const id = Number(useParams().id)
  const bill = useBill(id)
  if (bill.error instanceof ApiError && bill.error.status === 404) return <NotFound what="this bill" back="/purchases/bills" backLabel="Purchase bills" />
  if (bill.error) return <ProblemBanner error={bill.error} onRetry={() => void bill.refetch()} />
  if (!bill.data) return <PageSkeleton template="detail" />
  return <Details b={bill.data} />
}

function Details({ b }: { b: PurchaseBill }) {
  const { Button, IconButton, Menu, Tabs, Card, DataTable, Badge } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const phone = useMediaQuery(PHONE)
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'bill'
  const warehouses = useWarehouses()
  const post = usePostBill(b.id)
  const postIdem = useIdempotencyKey()
  const [posting, setPosting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [more, setMore] = useState(false)

  const warehouse = warehouses.data?.find((w) => w.id === b.warehouse_id)?.name ?? '—'
  const actions = [
    ...(b.status === 'draft' && can('purchases.edit') ? [{ icon: 'pencil', label: 'Edit', onClick: () => navigate(`/purchases/bills/${b.id}/edit`), testId: 'edit-bill' }] : []),
    ...(b.status === 'draft' && can('purchases.create') ? [{ icon: 'check', label: 'Post', onClick: () => setPosting(true), testId: 'post-bill' }] : []),
    ...(b.status === 'posted' && can('purchases.create') ? [{ icon: 'undo-2', label: 'Return to supplier', onClick: () => navigate(`/purchases/returns/new?bill=${b.id}`), testId: 'return-goods' }] : []),
    ...(b.status === 'posted' && can('purchases.edit') ? [{ icon: 'x', label: 'Cancel bill', onClick: () => setCancelling(true), testId: 'cancel-bill' }] : []),
  ]

  async function doPost(confirmBackdated: boolean) {
    const r = await post.mutateAsync({ body: { confirm_backdated: confirmBackdated || undefined }, idempotencyKey: postIdem.key })
    postIdem.reset()
    setPosting(false)
    toast({ tone: 'positive', title: `${r.number} posted`, description: 'Stock and the supplier balance are updated.' })
  }

  const lineCols: DataColumn[] = [
    { key: 'no', label: '#', width: 40 },
    { key: 'item', label: 'Item', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.item}</span>
        <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}{r.description ? ` · ${r.description}` : ''}</span>
      </span>) },
    { key: 'qty', label: 'Qty', mono: true, align: 'right' },
    { key: 'cost', label: 'Cost (৳)', type: 'amount' },
    { key: 'disc', label: 'Disc %', mono: true, align: 'right' },
    { key: 'tax', label: 'Tax (৳)', type: 'amount' },
    { key: 'total', label: 'Amount (৳)', type: 'amount' },
  ]
  const lineRows = (b.lines as unknown as BillLine[]).map((l) => ({
    id: l.line_no, no: l.line_no, item: l.product_name, code: l.product_code, description: l.description, qty: `${l.quantity} ${l.unit}`,
    cost: l.unit_cost, disc: l.discount_pct && !/^0+(\.0+)?$/.test(l.discount_pct) ? l.discount_pct : '—', tax: l.tax_amount, total: l.line_total,
  }))
  const journalCols: DataColumn[] = [
    { key: 'code', label: 'Ledger', mono: true }, { key: 'name', label: 'Name' },
    { key: 'debit', label: 'Debit (৳)', type: 'amount' }, { key: 'credit', label: 'Credit (৳)', type: 'amount' },
  ]
  const journalRows = (b.journal ?? []).map((j, i) => ({ id: i, code: j.ledger_code, name: j.ledger_name, debit: j.debit === '0.00' ? '' : j.debit, credit: j.credit === '0.00' ? '' : j.credit }))

  return (
    <>
      <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="lf-label">Purchase bill</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, font: '500 28px/34px var(--font-serif)' }} data-testid="bill-number">{b.number}</h1>
            <span data-testid="bill-status"><BillStatusBadge bill={b} /></span>
          </div>
          <span style={{ color: 'var(--ink-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            <a href={`/suppliers/${b.party.id}`} onClick={(e) => { e.preventDefault(); navigate(`/suppliers/${b.party.id}`) }}>{b.party.name}</a>
            <span>Supplier ref <span className="lf-code">{b.supplier_bill_no}</span></span>
            <span>Dated {shortDate(b.bill_date)} · due {shortDate(b.due_date)}</span>
            <span>Into {warehouse}</span>
          </span>
        </div>
        {phone ? (
          <div style={{ position: 'absolute', top: 0, right: 0 }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setMore(false) }}>
            <IconButton icon="ellipsis" label="More actions" onClick={() => setMore((o) => !o)} />
            {more && <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 200, zIndex: 20 }}
              items={[...actions.map((a) => ({ icon: a.icon, label: a.label, onClick: a.onClick })), { icon: 'list', label: 'All bills', onClick: () => navigate('/purchases/bills') }]} />}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button variant="ghost" icon="arrow-left" onClick={() => navigate('/purchases/bills')}>All bills</Button>
            {actions.map((a, i) => (
              <Button key={a.label} variant={i === actions.length - 1 && a.testId !== 'cancel-bill' ? 'primary' : 'secondary'} icon={a.icon} onClick={a.onClick} data-testid={a.testId}>{a.label}</Button>
            ))}
          </div>
        )}
      </div>

      <div className="lf-grid">
        <SummaryTile label="Total" testId="bill-total" value={formatTaka(b.total, { symbol: true })} sub={b.amount_in_words} />
        <SummaryTile label="Balance due" testId="bill-balance" value={b.status === 'posted' ? formatTaka(b.balance_due, { symbol: true }) : '—'}
          sub={b.status === 'draft' ? 'Not posted yet' : b.status === 'cancelled' ? 'Cancelled' : `Paid ${formatTaka(b.amount_settled, { symbol: true })}`} />
      </div>

      <div style={{ overflowX: 'auto', margin: '8px 0 16px' }}>
        <Tabs key={tab} items={TABS} value={tab} onChange={(v) => setParams(v === 'bill' ? {} : { tab: v }, { replace: true })} />
      </div>

      {tab === 'bill' && (
        <div className="lf-grid" style={{ alignItems: 'start' }}>
          <div className="lf-c8" style={{ minWidth: 0 }}>
            <Card title="Items" padding="none"><div style={{ overflowX: 'auto' }}><DataTable caption="Bill lines" columns={lineCols} rows={lineRows} /></div></Card>
          </div>
          <aside className="lf-c4">
            <Card title="Totals">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="bill-totals">
                {totalsRows({ ...b, lines: [], warnings: [], effects: [] }).map((r) => (
                  <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', ...(r.strong ? { fontWeight: 600, borderTop: '1px solid var(--line)', paddingTop: 8 } : {}) }}>
                    <span>{r.label}</span><span className="lf-num">{r.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          </aside>
        </div>
      )}
      {tab === 'ledger' && (
        <Card title="Ledger entries" subtitle={b.status === 'draft' ? undefined : 'The journal this bill posted'} padding="none">
          {journalRows.length
            ? <div style={{ overflowX: 'auto' }} data-testid="ledger-entries"><DataTable caption="Ledger entries" columns={journalCols} rows={journalRows} /></div>
            : <p style={{ padding: '16px 20px', margin: 0, color: 'var(--ink-muted)' }}>{b.status === 'draft' ? 'A draft has no ledger entries. They are made when the bill is posted.' : 'No ledger entries.'}</p>}
          {b.status === 'cancelled' && <div style={{ padding: '0 20px 16px' }}><Badge tone="negative">Reversed by the cancellation</Badge></div>}
        </Card>
      )}
      {tab === 'activity' && <Card title="Activity"><ActivityTimeline type="purchase_bill" id={b.id} /></Card>}
      {tab === 'payments' && <PaymentsPanel type="purchase_bill" id={b.id} number={b.number} partyId={b.party.id} status={b.status} balance={b.balance_due} allocations={b.allocations ?? []} />}

      {posting && <PostDialog title={`Post ${b.number}?`} number={b.number} total={b.total} loading={post.isPending} onPost={doPost} onClose={() => setPosting(false)} />}
      {cancelling && <CancelDialog bill={b} onClose={() => setCancelling(false)} />}
    </>
  )
}

/** Cancel a posted bill (BR-009): a reason is required; the server reverses stock and the journal. */
function CancelDialog({ bill, onClose }: { bill: PurchaseBill; onClose: () => void }) {
  const { Button, Field, Select, Input } = ds()
  const toast = useToast()
  const cancel = useCancelBill(bill.id)
  const idem = useIdempotencyKey()
  const [reason, setReason] = useState<CancelRequest['reason'] | ''>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [tried, setTried] = useState(false)

  async function confirm() {
    setTried(true)
    if (!reason) return
    setError(null)
    try {
      await cancel.mutateAsync({ body: { reason, note: note.trim() || null }, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `${bill.number} cancelled`, description: 'Stock and the supplier balance are reversed.' })
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <ResponsiveDialog title={`Cancel ${bill.number}?`} tone="negative" onClose={onClose} testId="cancel-dialog"
      description="The bill stays on record as cancelled; its stock and ledger entries are reversed. This cannot be undone."
      footer={<><Button variant="ghost" onClick={onClose}>Keep bill</Button>
        <Button variant="danger" loading={cancel.isPending} disabled={cancel.isPending} onClick={() => void confirm()} data-testid="confirm-cancel">Cancel bill</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Reason" required error={tried && !reason ? 'Choose why the bill is cancelled' : undefined} htmlFor="cancel-reason">
          <Select id="cancel-reason" options={REASONS} value={reason} onChange={(e) => setReason(e.target.value as CancelRequest['reason'] | '')} invalid={tried && !reason} />
        </Field>
        <Field label="Note" htmlFor="cancel-note"><Input id="cancel-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
        <ProblemBanner error={error} />
      </div>
    </ResponsiveDialog>
  )
}
