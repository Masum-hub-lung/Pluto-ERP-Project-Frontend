import { useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Product } from '../../api/contract.gen'
import { useProduct, useWarehouses } from '../../api/inventory'
import { dhakaToday } from '../../api/platform'
import { stockTransfers, type StockTransfer, type TransferLine } from '../../api/stock'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DeleteDialog } from '../../components/DeleteDialog'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProductPicker } from '../../components/pickers/ProductPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { Forbidden, NotFound } from '../../components/states'
import { ActionBar, DocStatusBadge, ReasonDialog } from '../../components/trade/TradeParts'
import { shortDate } from '../purchases/BillList'

/**
 * D11 Stock transfer (02 #page-d11; backlog P11.2-FE-04; 06 §11.4; BR-030): route (from → to), the products and
 * quantities, vehicle and driver. Draft → Dispatched → Received: dispatch takes the stock out of the source at its average
 * cost; receive brings it into the destination — less if some was lost on the way (posted as a transit loss). A draft
 * or a dispatched transfer can be cancelled; a received one cannot. The API checks different warehouses and quantities
 * against what the source holds (shown per line once saved); value at cost only with inventory.view_costs (BR-052).
 */
const STEPS = [['draft', 'Draft'], ['dispatched', 'Dispatched'], ['received', 'Received']] as const

interface Line { key: number; product: Product | null; qty: string }
let seq = 0
const blank = (product: Product | null = null, qty = ''): Line => ({ key: ++seq, product, qty })

export function TransferForm({ mode }: { mode: 'new' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const t = stockTransfers.useOne(mode === 'edit' ? id : 0)
  const [params] = useSearchParams()
  const productId = Number(params.get('product_id')) || 0
  const preset = useProduct(mode === 'new' ? productId : 0)
  if (mode === 'new' && !can('inventory.create')) return <Forbidden permission="inventory.create" what="transferring stock" />
  if (mode === 'edit') {
    if (t.error instanceof ApiError && t.error.status === 404) return <NotFound what="this transfer" back="/inventory/transfers" backLabel="Transfers" />
    if (t.error) return <ProblemBanner error={t.error} onRetry={() => void t.refetch()} />
    if (!t.data) return <PageSkeleton template="form" />
  }
  if (mode === 'new' && productId && !preset.data && !preset.error) return <PageSkeleton template="form" />
  return <Form key={mode === 'edit' ? `${id}-${t.data?.status}` : 'new'} initial={t.data ?? null} preset={preset.data?.product ?? null} fromParam={params.get('from') ?? ''} />
}

function Form({ initial, preset, fromParam }: { initial: StockTransfer | null; preset: Product | null; fromParam: string }) {
  const { Card, Field, Input, Select, PageHeader, Button, Banner, DataTable, IconButton } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const costs = can('inventory.view_costs')
  const warehouses = useWarehouses()
  const [current, setCurrent] = useState(initial)
  const editable = !current || current.status === 'draft'
  const saved = (current?.lines ?? []) as unknown as TransferLine[]
  const [from, setFrom] = useState(current ? String(current.from_warehouse_id) : fromParam)
  const [to, setTo] = useState(current ? String(current.to_warehouse_id) : '')
  const [date, setDate] = useState(current?.dispatch_date ?? dhakaToday())
  const [vehicle, setVehicle] = useState(current?.vehicle ?? '')
  const [driver, setDriver] = useState(current?.driver ?? '')
  const [notes, setNotes] = useState(current?.notes ?? '')
  const [lines, setLines] = useState<Line[]>(() => current
    ? saved.map((l) => blank({ id: l.product_id, code: l.product_code, name: l.product_name, unit: l.unit } as unknown as Product, l.quantity.replace(/\.?0+$/, '')))
    : [blank(preset)])
  const [error, setError] = useState<unknown>(null)
  const [dialog, setDialog] = useState<null | 'dispatch' | 'receive' | 'cancel' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const create = stockTransfers.useCreate()
  const update = stockTransfers.useUpdate(current?.id ?? 0)
  const del = stockTransfers.useDelete(current?.id ?? 0)
  const dispatch = stockTransfers.useAction(current?.id ?? 0, 'dispatch')
  const cancel = stockTransfers.useAction<{ reason: string }>(current?.id ?? 0, 'cancel')
  const saveIdem = useIdempotencyKey()
  const dispatchIdem = useIdempotencyKey()
  const cancelIdem = useIdempotencyKey()

  const chosen = lines.filter((l) => l.product && l.qty.trim() !== '')
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const name = (wid: string | number) => warehouses.data?.find((w) => String(w.id) === String(wid))?.name ?? ''

  async function save() {
    if (busyRef.current) return
    if (!from || !to || chosen.length === 0) { setError(new Error('Choose both warehouses and enter at least one quantity.')); return }
    busyRef.current = true; setBusy(true); setError(null)
    const input = { from_warehouse_id: Number(from), to_warehouse_id: Number(to), dispatch_date: date || null, vehicle: vehicle.trim() || null, driver: driver.trim() || null,
      notes: notes.trim() || null, lines: chosen.map((l) => ({ product_id: l.product!.id, quantity: l.qty.trim() })) }
    try {
      const s = current ? await update.mutateAsync({ input, version: current.version }) : await create.mutateAsync({ input, idempotencyKey: saveIdem.key })
      if (!current) saveIdem.reset()
      setCurrent(s)
      toast({ tone: 'positive', title: `Draft ${s.number} saved`, description: `${s.total_units} units from ${s.from_warehouse_name} to ${s.to_warehouse_name} · not sent yet` })
      if (!current) navigate(`/inventory/transfers/${s.id}`, { replace: true })
    } catch (e) {
      setError(e)
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }

  async function doDispatch() {
    try {
      const d = await dispatch.mutateAsync({ idempotencyKey: dispatchIdem.key })
      dispatchIdem.reset(); setDialog(null); setCurrent(d)
      toast({ tone: 'positive', title: `${d.number} dispatched`, description: `On its way to ${d.to_warehouse_name}. Receive it when it arrives.` })
    } catch (e) {
      setDialog(null); setError(e)
    }
  }

  const fieldErrors = error instanceof ApiError ? Object.values(error.fieldErrors).flat() : []
  const whOptions = (other: string) => [{ value: '', label: 'Choose…' }, ...(warehouses.data ?? []).filter((w) => w.status !== 'inactive' && String(w.id) !== other)
    .map((w) => ({ value: String(w.id), label: w.name }))]
  const step = current?.status === 'cancelled' ? -1 : STEPS.findIndex((s) => s[0] === (current?.status ?? 'draft'))
  const rows = lines.map((l, i) => {
    const s = saved.find((x) => x.product_id === l.product?.id)
    return { id: l.key, i, l, available: s?.available ?? '', received: s?.received_quantity ?? '', cost: s?.unit_cost ?? '' }
  })

  return (
    <>
      <PageHeader eyebrow="Inventory · Stock transfer" title={current ? current.number : 'New stock transfer'}
        description={current ? `${current.from_warehouse_name} → ${current.to_warehouse_name}${current.dispatch_date ? ` · sent ${shortDate(current.dispatch_date)}` : ''}`
          : 'Move stock from one warehouse to another.'} />
      <ol style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 16px', flexWrap: 'wrap' }} aria-label="Progress" data-testid="transfer-steps">
        {STEPS.map(([k, label], i) => (
          <li key={k} aria-current={i === step ? 'step' : undefined} style={{ padding: '4px 12px', borderRadius: 999, fontSize: 13,
            background: i <= step ? 'var(--brand-soft)' : 'var(--surface-2, var(--surface))', color: i <= step ? 'var(--brand-ink)' : 'var(--ink-muted)', border: '1px solid var(--line)' }}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {current && (
        <ActionBar>
          <DocStatusBadge status={current.status} />
          {editable && can('inventory.create') && <Button variant="primary" size="sm" icon="truck" onClick={() => setDialog('dispatch')} data-testid="dispatch-transfer">Dispatch transfer</Button>}
          {current.status === 'dispatched' && can('inventory.create') && <Button variant="primary" size="sm" icon="package-check" onClick={() => setDialog('receive')} data-testid="receive-transfer">Receive</Button>}
          {['draft', 'dispatched'].includes(current.status) && can('inventory.edit') && <Button variant="ghost" size="sm" onClick={() => setDialog('cancel')} data-testid="cancel-transfer">Cancel transfer</Button>}
          {editable && can('inventory.delete') && <Button variant="ghost" size="sm" icon="trash-2" onClick={() => setDialog('delete')}>Delete draft</Button>}
        </ActionBar>
      )}
      {current?.status === 'cancelled' && <div style={{ marginBottom: 12 }}><Banner tone="warning" title="Cancelled">Anything sent came back to {current.from_warehouse_name}.</Banner></div>}
      <ProblemBanner error={error} />
      {fieldErrors.length > 0 && (
        <ul style={{ margin: '8px 0 12px', paddingLeft: 18, color: 'var(--negative)', fontSize: 14 }} data-testid="transfer-errors">{fieldErrors.map((m, i) => <li key={i}>{m}</li>)}</ul>
      )}

      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ minWidth: 0, display: 'grid', gap: 16 }}>
          <Card title="Route">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <Field label="From" htmlFor="tr-from-wh"><Select key={`f${warehouses.data?.length}`} id="tr-from-wh" options={whOptions(to)} value={from} disabled={!editable} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To" htmlFor="tr-to-wh"><Select key={`t${warehouses.data?.length}`} id="tr-to-wh" options={whOptions(from)} value={to} disabled={!editable} onChange={(e) => setTo(e.target.value)} /></Field>
              <Field label="Transfer number" hint="Given when first saved"><Input mono readOnly value={current?.number ?? 'TRF-…'} aria-label="Transfer number" /></Field>
              <Field label="Dispatch date" htmlFor="tr-date"><Input id="tr-date" type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Vehicle" htmlFor="tr-vehicle"><Input id="tr-vehicle" value={vehicle} disabled={!editable} onChange={(e) => setVehicle(e.target.value)} placeholder="Optional" /></Field>
              <Field label="Driver" htmlFor="tr-driver"><Input id="tr-driver" value={driver} disabled={!editable} onChange={(e) => setDriver(e.target.value)} placeholder="Optional" /></Field>
            </div>
          </Card>
          <Card title="Items" padding="none">
            <div style={{ overflowX: 'auto' }}>
              <DataTable caption="Items to move" rows={rows} columns={[
                { key: 'product', label: 'Product', render: (_v: unknown, r: (typeof rows)[number]) => editable
                  ? <div style={{ minWidth: 220 }}><ProductPicker value={r.l.product} onChange={(p) => setLine(r.l.key, { product: p })} aria-label={`Product, line ${r.i + 1}`} /></div>
                  : <span>{r.l.product?.name} <span className="lf-code">{r.l.product?.code}</span></span> },
                ...(editable ? [{ key: 'available', label: `Available${from ? ` in ${name(from)}` : ''}`, align: 'right' as const,
                  render: (v: unknown) => <span className="lf-num">{(v as string) || '—'}</span> }] : []),
                { key: 'qty', label: 'Transfer', render: (_v: unknown, r: (typeof rows)[number]) => (
                  <Input aria-label={`Quantity, line ${r.i + 1}`} inputMode="decimal" style={{ maxWidth: 120 }} value={r.l.qty} disabled={!editable}
                    onChange={(e) => setLine(r.l.key, { qty: e.target.value })} />) },
                ...(current?.status === 'received' ? [{ key: 'received', label: 'Received', align: 'right' as const, render: (v: unknown) => <span className="lf-num">{v as string}</span> }] : []),
                ...(costs && !editable ? [{ key: 'cost', label: 'Unit cost (৳)', type: 'amount' as const }] : []),
                ...(editable ? [{ key: 'remove', label: '', render: (_v: unknown, r: (typeof rows)[number]) => (
                  <IconButton icon="x" size="sm" label={`Remove line ${r.i + 1}`} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== r.l.key) : [blank()]))} />) }] : []),
              ]} />
            </div>
            {editable && <div style={{ padding: 12 }}><Button variant="ghost" size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, blank()])} data-testid="add-line">Add product</Button></div>}
          </Card>
          <Card title="Notes"><Input aria-label="Notes" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Card>
        </div>
        <aside className="lf-c4 lf-form-aside">
          <Card title="Summary">
            <div style={{ display: 'grid', gap: 8 }} data-testid="transfer-summary">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-muted)' }}>Units</span><span className="lf-num">{current?.total_units ?? '—'}</span></div>
              {costs && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-muted)' }}>Value at cost</span>
                <span className="lf-num">{current?.value_at_cost ? formatTaka(current.value_at_cost, { symbol: true }) : '—'}</span></div>}
              {costs && current?.transit_loss_value && current.transit_loss_value !== '0.00' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--negative)' }}><span>Lost on the way</span>
                  <span className="lf-num" data-testid="transit-loss">{formatTaka(current.transit_loss_value, { symbol: true })}</span></div>)}
              {current?.received_date && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-muted)' }}>Received</span><span>{shortDate(current.received_date)}</span></div>}
            </div>
          </Card>
        </aside>
      </div>

      {editable && (
        <div className="lf-form-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button variant="secondary" onClick={() => navigate('/inventory/transfers')}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()} data-testid="save-transfer">Save draft</Button>
        </div>
      )}

      {dialog === 'dispatch' && current && (
        <ConfirmDialog title={`Dispatch ${current.number}?`} confirmLabel="Dispatch" tone="info" loading={dispatch.isPending} onConfirm={() => void doDispatch()} onClose={() => setDialog(null)}
          description={`${current.total_units} units leave ${current.from_warehouse_name} now and stay on the way until ${current.to_warehouse_name} receives them.`} />
      )}
      {dialog === 'receive' && current && <ReceiveDialog transfer={current} onClose={() => setDialog(null)} onDone={(r) => { setCurrent(r); setDialog(null) }} />}
      {dialog === 'cancel' && current && (
        <ReasonDialog title={`Cancel ${current.number}?`} confirmLabel="Cancel transfer" loading={cancel.isPending} onClose={() => setDialog(null)}
          description={current.status === 'dispatched' ? `The stock goes back into ${current.from_warehouse_name} and its entry is reversed.` : 'The draft is kept, marked cancelled.'}
          onConfirm={async (r) => {
            const c = await cancel.mutateAsync({ body: { reason: r }, idempotencyKey: cancelIdem.key })
            cancelIdem.reset(); setCurrent(c); setDialog(null)
            toast({ tone: 'positive', title: `${c.number} cancelled` })
          }} />
      )}
      {dialog === 'delete' && current && (
        <DeleteDialog name={current.number} what="draft" description="Its number is voided and never reused." loading={del.isPending} onClose={() => setDialog(null)}
          onConfirm={() => void del.mutateAsync().then(() => { toast({ tone: 'positive', title: 'Draft deleted' }); navigate('/inventory/transfers') }).catch((e) => { setDialog(null); setError(e) })} />
      )}
    </>
  )
}

/** Receive: the date and, per product, what arrived (default everything sent); a shortfall is posted as a transit loss. */
function ReceiveDialog({ transfer, onClose, onDone }: { transfer: StockTransfer; onClose: () => void; onDone: (t: StockTransfer) => void }) {
  const { Field, Input, Button } = ds()
  const toast = useToast()
  const lines = transfer.lines as unknown as TransferLine[]
  const [date, setDate] = useState(dhakaToday())
  const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(lines.map((l) => [l.product_id, l.quantity.replace(/\.?0+$/, '')])))
  const [error, setError] = useState<unknown>(null)
  const receive = stockTransfers.useAction<{ received_date: string; lines: { product_id: number; quantity: string }[] }>(transfer.id, 'receive')
  const idem = useIdempotencyKey()
  const submit = async () => {
    setError(null)
    try {
      const r = await receive.mutateAsync({ body: { received_date: date, lines: lines.map((l) => ({ product_id: l.product_id, quantity: (qty[l.product_id] ?? '').trim() || '0' })) },
        idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `${r.number} received`, description: r.transit_loss_value && r.transit_loss_value !== '0.00'
        ? `Lost on the way: ${formatTaka(r.transit_loss_value, { symbol: true })}` : `Stock is in ${r.to_warehouse_name}.` })
      onDone(r)
    } catch (e) {
      setError(e)
    }
  }
  const fieldErrors = error instanceof ApiError ? Object.values(error.fieldErrors).flat() : []
  return (
    <ResponsiveDialog title={`Receive ${transfer.number}`} onClose={onClose} testId="receive-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button>
        <Button variant="primary" loading={receive.isPending} onClick={() => void submit()} data-testid="confirm-receive">Receive</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Enter what arrived. Anything short is posted as lost on the way.</p>
        <ProblemBanner error={error} />
        {fieldErrors.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--negative)', fontSize: 14 }}>{fieldErrors.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        <Field label="Received on" htmlFor="rcv-date"><Input id="rcv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {lines.map((l) => (
          <Field key={l.product_id} label={`${l.product_name} — sent ${l.quantity.replace(/\.?0+$/, '')} ${l.unit ?? ''}`} htmlFor={`rcv-${l.product_id}`}>
            <Input id={`rcv-${l.product_id}`} inputMode="decimal" value={qty[l.product_id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.product_id]: e.target.value }))}
              aria-label={`Received, ${l.product_name}`} />
          </Field>
        ))}
      </div>
    </ResponsiveDialog>
  )
}
