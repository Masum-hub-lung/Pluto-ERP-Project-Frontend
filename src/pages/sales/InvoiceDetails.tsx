import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { CancelRequest, SalesInvoice } from '../../api/contract.gen'
import { useWarehouses } from '../../api/inventory'
import { useCancelInvoice, useInvoice, usePostInvoice, useSendInvoice, useUpdateDelivery } from '../../api/sales'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { deliveryToForm, toDeliveryUpdate } from '../../lib/invoiceSchema'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { PHONE, useMediaQuery } from '../../lib/useMediaQuery'
import { ActivityTimeline } from '../../components/ActivityTimeline'
import { ConflictBanner } from '../../components/ConflictBanner'
import { PostDialog } from '../../components/document/PostDialog'
import { totalsRows } from '../../components/document/totals'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'
import { PaymentsPanel } from '../../components/document/PaymentsPanel'
import { shortDate } from '../purchases/BillList'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'

/**
 * E5 Invoice details (Sal-Details.dc.html; backlog P5.2-FE-06): header with status and amounts, then tabs — Invoice
 * (lines and totals, read-only), Ledger entries (the posted journal), Delivery (challan, vehicle, time; editable after
 * posting, PATCH …/delivery), Activity, and Payments (receipts and advances applied, remove/apply; P6). Actions: Edit and
 * Post for drafts, Record payment, Preview, E-mail to customer, Cancel with a reason for posted invoices. Attachments wait for P13.
 */
const TABS = [{ value: 'invoice', label: 'Invoice' }, { value: 'ledger', label: 'Ledger entries' }, { value: 'delivery', label: 'Delivery' },
  { value: 'activity', label: 'Activity' }, { value: 'payments', label: 'Payments' }]
const REASONS: Array<{ value: CancelRequest['reason'] | ''; label: string }> = [
  { value: '', label: 'Choose a reason…' }, { value: 'customer_cancelled', label: 'Customer cancelled' }, { value: 'entered_by_mistake', label: 'Entered by mistake' },
  { value: 'wrong_party', label: 'Wrong customer' }, { value: 'duplicate', label: 'Duplicate invoice' }, { value: 'other', label: 'Other' },
]

export function InvoiceDetails() {
  const id = Number(useParams().id)
  const invoice = useInvoice(id)
  if (invoice.error instanceof ApiError && invoice.error.status === 404) return <NotFound what="this invoice" back="/sales/invoices" backLabel="Sales invoices" />
  if (invoice.error) return <ProblemBanner error={invoice.error} onRetry={() => void invoice.refetch()} />
  if (!invoice.data) return <PageSkeleton template="detail" />
  return <Details inv={invoice.data} />
}

function Details({ inv }: { inv: SalesInvoice }) {
  const { Button, IconButton, Menu, Tabs, Card, DataTable, Badge } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const phone = useMediaQuery(PHONE)
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'invoice'
  const warehouses = useWarehouses()
  const post = usePostInvoice(inv.id)
  const postIdem = useIdempotencyKey()
  const [posting, setPosting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [sending, setSending] = useState(false)
  const [more, setMore] = useState(false)

  const warehouse = warehouses.data?.find((w) => w.id === inv.warehouse_id)?.name ?? '—'
  const actions = [
    { icon: 'eye', label: 'Preview', onClick: () => navigate(`/sales/invoices/${inv.id}/preview`), testId: 'preview-invoice', primary: false },
    ...(inv.status === 'posted' && inv.balance_due !== '0.00' && can('sales.create') ? [{ icon: 'hand-coins', label: 'Record payment', onClick: () => navigate(`/sales/payments/new?party_id=${inv.party.id}&invoice_id=${inv.id}`), testId: 'header-record-payment', primary: true }] : []),
    ...(inv.status === 'posted' && can('sales.edit') ? [{ icon: 'arrow-up-right', label: 'E-mail', onClick: () => setSending(true), testId: 'send-invoice', primary: false }] : []),
    ...(inv.status === 'draft' && can('sales.edit') ? [{ icon: 'pencil', label: 'Edit', onClick: () => navigate(`/sales/invoices/${inv.id}/edit`), testId: 'edit-invoice', primary: false }] : []),
    ...(inv.status === 'draft' && can('sales.create') ? [{ icon: 'check', label: 'Post', onClick: () => setPosting(true), testId: 'post-invoice', primary: true }] : []),
    ...(inv.status === 'posted' && can('sales.edit') ? [{ icon: 'x', label: 'Cancel invoice', onClick: () => setCancelling(true), testId: 'cancel-invoice', primary: false }] : []),
  ]

  async function doPost(confirmBackdated: boolean) {
    const r = await post.mutateAsync({ body: { confirm_backdated: confirmBackdated || undefined }, idempotencyKey: postIdem.key })
    postIdem.reset()
    setPosting(false)
    toast({ tone: 'positive', title: `${r.number} posted`, description: 'Stock and the customer balance are updated.' })
  }

  const costs = inv.lines.some((l) => l.cost_amount != null)
  const lineCols: DataColumn[] = [
    { key: 'no', label: '#', width: 40 },
    { key: 'item', label: 'Item', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.item}</span>
        <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}{r.description ? ` · ${r.description}` : ''}</span>
      </span>) },
    { key: 'qty', label: 'Qty', mono: true, align: 'right' },
    { key: 'price', label: 'Price (৳)', type: 'amount' },
    { key: 'disc', label: 'Disc %', mono: true, align: 'right' },
    { key: 'tax', label: 'Tax (৳)', type: 'amount' },
    { key: 'total', label: 'Amount (৳)', type: 'amount' },
    ...(costs ? [{ key: 'cost', label: 'Cost of sale (৳)', type: 'amount' as const }] : []),
  ]
  const lineRows = inv.lines.map((l) => ({
    id: l.line_no, no: l.line_no, item: l.product_name, code: l.product_code, description: l.description, qty: `${l.quantity} ${l.unit}`,
    price: l.unit_price, disc: l.discount_pct && !/^0+(\.0+)?$/.test(l.discount_pct) ? l.discount_pct : '—', tax: l.tax_amount, total: l.line_total, cost: l.cost_amount ?? '',
  }))
  const journalCols: DataColumn[] = [
    { key: 'code', label: 'Ledger', mono: true }, { key: 'name', label: 'Name' },
    { key: 'debit', label: 'Debit (৳)', type: 'amount' }, { key: 'credit', label: 'Credit (৳)', type: 'amount' },
  ]
  const journalRows = (inv.journal ?? []).map((j, i) => ({ id: i, code: j.ledger_code, name: j.ledger_name, debit: j.debit === '0.00' ? '' : j.debit, credit: j.credit === '0.00' ? '' : j.credit }))

  return (
    <>
      <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="lf-label">Sales invoice</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, font: '500 28px/34px var(--font-serif)' }} data-testid="invoice-number">{inv.number}</h1>
            <span data-testid="invoice-status"><InvoiceStatusBadge invoice={inv} /></span>
          </div>
          <span style={{ color: 'var(--ink-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            <a href={`/customers/${inv.party.id}`} onClick={(e) => { e.preventDefault(); navigate(`/customers/${inv.party.id}`) }}>{inv.party.name}</a>
            {inv.customer_po_ref && <span>PO <span className="lf-code">{inv.customer_po_ref}</span></span>}
            <span>Dated {shortDate(inv.invoice_date)} · due {shortDate(inv.due_date)}</span>
            <span>From {warehouse}</span>
          </span>
        </div>
        {phone ? (
          <div style={{ position: 'absolute', top: 0, right: 0 }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setMore(false) }}>
            <IconButton icon="ellipsis" label="More actions" onClick={() => setMore((o) => !o)} />
            {more && <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 200, zIndex: 20 }}
              items={[...actions.map((a) => ({ icon: a.icon, label: a.label, onClick: a.onClick })), { icon: 'list', label: 'All invoices', onClick: () => navigate('/sales/invoices') }]} />}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button variant="ghost" icon="arrow-left" onClick={() => navigate('/sales/invoices')}>All invoices</Button>
            {actions.map((a) => <Button key={a.label} variant={a.primary ? 'primary' : 'secondary'} icon={a.icon} onClick={a.onClick} data-testid={a.testId}>{a.label}</Button>)}
          </div>
        )}
      </div>

      <div className="lf-grid">
        <SummaryTile label="Total" testId="invoice-total" value={formatTaka(inv.total, { symbol: true })} sub={inv.amount_in_words} />
        <SummaryTile label="Balance due" testId="invoice-balance" value={inv.status === 'posted' ? formatTaka(inv.balance_due, { symbol: true }) : '—'}
          sub={inv.status === 'draft' ? 'Not posted yet' : inv.status === 'cancelled' ? 'Cancelled' : `Received ${formatTaka(inv.amount_settled, { symbol: true })}`} />
      </div>

      <div style={{ overflowX: 'auto', margin: '8px 0 16px' }}>
        <Tabs key={tab} items={TABS} value={tab} onChange={(v) => setParams(v === 'invoice' ? {} : { tab: v }, { replace: true })} />
      </div>

      {tab === 'invoice' && (
        <div className="lf-grid" style={{ alignItems: 'start' }}>
          <div className="lf-c8" style={{ minWidth: 0 }}>
            <Card title="Items" padding="none"><div style={{ overflowX: 'auto' }}><DataTable caption="Invoice lines" columns={lineCols} rows={lineRows} /></div></Card>
          </div>
          <aside className="lf-c4">
            <Card title="Totals">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="invoice-totals">
                {totalsRows({ ...inv, lines: [], warnings: [], effects: [] }).map((r) => (
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
        <Card title="Ledger entries" subtitle={inv.status === 'draft' ? undefined : 'The journal this invoice posted'} padding="none">
          {journalRows.length
            ? <div style={{ overflowX: 'auto' }} data-testid="ledger-entries"><DataTable caption="Ledger entries" columns={journalCols} rows={journalRows} /></div>
            : <p style={{ padding: '16px 20px', margin: 0, color: 'var(--ink-muted)' }}>{inv.status === 'draft' ? 'A draft has no ledger entries. They are made when the invoice is posted.' : 'No ledger entries.'}</p>}
          {inv.status === 'cancelled' && <div style={{ padding: '0 20px 16px' }}><Badge tone="negative">Reversed by the cancellation</Badge></div>}
        </Card>
      )}
      {tab === 'delivery' && <DeliveryCard inv={inv} editable={inv.status !== 'cancelled' && can('sales.edit')} />}
      {tab === 'activity' && <Card title="Activity"><ActivityTimeline type="sales_invoice" id={inv.id} /></Card>}
      {tab === 'payments' && <PaymentsPanel type="sales_invoice" id={inv.id} number={inv.number} partyId={inv.party.id} status={inv.status} balance={inv.balance_due} allocations={inv.allocations ?? []} />}

      {posting && <PostDialog title={`Post ${inv.number}?`} number={inv.number} total={inv.total} loading={post.isPending} onPost={doPost} onClose={() => setPosting(false)} />}
      {cancelling && <CancelDialog inv={inv} onClose={() => setCancelling(false)} />}
      {sending && <SendDialog inv={inv} onClose={() => setSending(false)} />}
    </>
  )
}

/** Delivery details (GAP-12, R-31): not financial, so they can change after posting; each save is audited. */
function DeliveryCard({ inv, editable }: { inv: SalesInvoice; editable: boolean }) {
  const { Card, Field, Input, Button } = ds()
  const toast = useToast()
  const update = useUpdateDelivery(inv.id)
  const qc = useQueryClient()
  const [v, setV] = useState(() => deliveryToForm(inv.delivery))
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState(false)
  const stored = deliveryToForm(inv.delivery)
  const dirty = v.challan_no.trim() !== stored.challan_no || v.vehicle_no.trim() !== stored.vehicle_no || v.delivered_at !== stored.delivered_at

  async function save() {
    setError(null); setConflict(false)
    try {
      const r = await update.mutateAsync({ body: toDeliveryUpdate(v), version: inv.version })
      setV(deliveryToForm(r.delivery))
      toast({ tone: 'positive', title: 'Delivery details saved', description: `${r.number}${r.delivery?.challan_no ? ` · challan ${String(r.delivery.challan_no)}` : ''}` })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else setError(e)
    }
  }

  return (
    <Card title="Delivery" subtitle="Challan, vehicle and delivery time; printed on the delivery challan">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="delivery-card">
        {conflict && <ConflictBanner onReload={() => { setConflict(false); setError(null); void qc.invalidateQueries({ queryKey: ['company', api.getCompany(), 'sales-invoices', inv.id] }) }} />}
        <ProblemBanner error={error} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
          <Field label="Challan number" htmlFor="d-challan"><Input id="d-challan" mono value={v.challan_no} readOnly={!editable} onChange={(e) => setV({ ...v, challan_no: e.target.value })} /></Field>
          <Field label="Vehicle" htmlFor="d-vehicle"><Input id="d-vehicle" value={v.vehicle_no} readOnly={!editable} onChange={(e) => setV({ ...v, vehicle_no: e.target.value })} /></Field>
          <Field label="Delivered at" htmlFor="d-at"><Input id="d-at" type="datetime-local" value={v.delivered_at} readOnly={!editable} onChange={(e) => setV({ ...v, delivered_at: e.target.value })} /></Field>
        </div>
        {editable && (
          <div><Button variant="primary" icon="check" loading={update.isPending} disabled={!dirty || update.isPending} onClick={() => void save()} data-testid="save-delivery">Save delivery details</Button></div>
        )}
      </div>
    </Card>
  )
}

/** E-mail the invoice PDF (queued). Empty "To" sends to the customer's e-mail on file. */
function SendDialog({ inv, onClose }: { inv: SalesInvoice; onClose: () => void }) {
  const { Button, Field, Input } = ds()
  const toast = useToast()
  const send = useSendInvoice(inv.id)
  const idem = useIdempotencyKey()
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<unknown>(null)
  const list = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)
  const fieldError = (k: string) => (error instanceof ApiError ? Object.entries(error.fieldErrors).find(([p]) => p === k || p.startsWith(`${k}.`))?.[1][0] : undefined)

  async function confirm() {
    setError(null)
    try {
      await send.mutateAsync({ body: { to: list(to), cc: list(cc), message: message.trim() || null }, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `${inv.number} is on its way`, description: list(to).length ? `Sent to ${list(to).join(', ')}` : `Sent to ${inv.party.name}` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <ResponsiveDialog title={`E-mail ${inv.number}`} tone="info" width={520} onClose={onClose} testId="send-dialog"
      description="The invoice PDF is attached. Leave “To” empty to use the customer's e-mail on file."
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button>
        <Button variant="primary" icon="arrow-up-right" loading={send.isPending} disabled={send.isPending} onClick={() => void confirm()} data-testid="confirm-send">Send</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="To" hint="Separate addresses with commas" error={fieldError('to')} htmlFor="send-to"><Input id="send-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="accounts@customer.com" /></Field>
        <Field label="Cc" error={fieldError('cc')} htmlFor="send-cc"><Input id="send-cc" type="email" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Message" htmlFor="send-message"><Input id="send-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional note in the e-mail" /></Field>
        {!(error instanceof ApiError && error.status === 422) && <ProblemBanner error={error} />}
      </div>
    </ResponsiveDialog>
  )
}

/** Cancel a posted invoice (BR-024, Sal-DlgCancel): a reason is required; the server reverses stock and the journal. */
function CancelDialog({ inv, onClose }: { inv: SalesInvoice; onClose: () => void }) {
  const { Button, Field, Select, Input } = ds()
  const toast = useToast()
  const cancel = useCancelInvoice(inv.id)
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
      toast({ tone: 'positive', title: `${inv.number} cancelled`, description: 'The stock is back and the customer balance is reversed.' })
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <ResponsiveDialog title={`Cancel ${inv.number}?`} tone="negative" onClose={onClose} testId="cancel-dialog"
      description="The invoice stays on record as cancelled. Its stock comes back and its ledger entries are reversed; any payment on it becomes an advance. This cannot be undone."
      footer={<><Button variant="ghost" onClick={onClose}>Keep invoice</Button>
        <Button variant="danger" loading={cancel.isPending} disabled={cancel.isPending} onClick={() => void confirm()} data-testid="confirm-cancel">Cancel invoice</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Reason" required error={tried && !reason ? 'Choose why the invoice is cancelled' : undefined} htmlFor="cancel-reason">
          <Select id="cancel-reason" options={REASONS} value={reason} onChange={(e) => setReason(e.target.value as CancelRequest['reason'] | '')} invalid={tried && !reason} />
        </Field>
        <Field label="Note" htmlFor="cancel-note"><Input id="cancel-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
        <ProblemBanner error={error} />
      </div>
    </ResponsiveDialog>
  )
}
