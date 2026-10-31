import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { PageMeta, PostingLine, Product, StockLevel } from '../../api/contract.gen'
import { useProduct, useWarehouses } from '../../api/inventory'
import { dhakaToday } from '../../api/platform'
import { stockAdjustments, useCountSheet, type AdjustmentLine, type StockAdjustment } from '../../api/stock'
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
import { Forbidden, NotFound } from '../../components/states'
import { ActionBar, DocStatusBadge, ReasonDialog } from '../../components/trade/TradeParts'

/**
 * D10 Stock adjustment (02 #page-d10, 05 #actions-d10; backlog P11.2-FE-03; 06 §11.3; BR-029): the warehouse, why, and
 * per product the counted quantity. The API reads the system quantity and values the difference when the draft is
 * saved, so "In system", "Difference" and the value appear after saving; posting re-reads the system quantity and asks
 * for a recount when stock moved since (the API names the lines). A count sheet (CSV of code and counted quantity) can
 * fill the lines; the blank sheet of a warehouse is downloaded with today's products. Posted adjustments can be
 * reversed (inventory.approve). Costs, values and "What gets posted" only with inventory.view_costs (BR-052).
 */
export const REASONS = [['count_difference', 'Count difference'], ['damaged', 'Damaged'], ['expired', 'Expired'], ['theft_or_loss', 'Theft or loss'], ['free_samples', 'Free samples']]

interface Line { key: number; product: Product | null; counted: string }
let seq = 0
const blank = (product: Product | null = null, counted = ''): Line => ({ key: ++seq, product, counted })

export function AdjustmentForm({ mode }: { mode: 'new' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const adj = stockAdjustments.useOne(mode === 'edit' ? id : 0)
  const [params] = useSearchParams()
  const productId = Number(params.get('product_id')) || 0
  const preset = useProduct(mode === 'new' ? productId : 0)
  if (mode === 'new' && !can('inventory.create')) return <Forbidden permission="inventory.create" what="adjusting stock" />
  if (mode === 'edit') {
    if (adj.error instanceof ApiError && adj.error.status === 404) return <NotFound what="this adjustment" back="/inventory/adjustments" backLabel="Adjustments" />
    if (adj.error) return <ProblemBanner error={adj.error} onRetry={() => void adj.refetch()} />
    if (!adj.data) return <PageSkeleton template="form" />
  }
  if (mode === 'new' && productId && !preset.data && !preset.error) return <PageSkeleton template="form" />
  return <Form key={mode === 'edit' ? `${id}-${adj.data?.status}` : 'new'} initial={adj.data ?? null} preset={preset.data?.product ?? null} warehouseParam={params.get('warehouse_id') ?? ''} />
}

function Form({ initial, preset, warehouseParam }: { initial: StockAdjustment | null; preset: Product | null; warehouseParam: string }) {
  const { Card, Field, Input, Select, PageHeader, Button, Banner, DataTable, IconButton } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const costs = can('inventory.view_costs')
  const warehouses = useWarehouses()
  const [current, setCurrent] = useState(initial)
  const editable = !current || current.status === 'draft'
  const saved = (current?.lines ?? []) as unknown as AdjustmentLine[]
  const [date, setDate] = useState(current?.adjustment_date ?? dhakaToday())
  const [warehouse, setWarehouse] = useState(current ? String(current.warehouse_id) : warehouseParam)
  const [reason, setReason] = useState(current?.reason ?? 'count_difference')
  const [notes, setNotes] = useState(current?.notes ?? '')
  const [lines, setLines] = useState<Line[]>(() => current
    ? saved.map((l) => blank({ id: l.product_id, code: l.product_code, name: l.product_name, unit: l.unit } as unknown as Product, l.counted_qty.replace(/\.?0+$/, '') || '0'))
    : [blank(preset)])
  const [error, setError] = useState<unknown>(null)
  const [dialog, setDialog] = useState<null | 'post' | 'reverse' | 'delete'>(null)
  const [unknown, setUnknown] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const create = stockAdjustments.useCreate()
  const update = stockAdjustments.useUpdate(current?.id ?? 0)
  const del = stockAdjustments.useDelete(current?.id ?? 0)
  const post = stockAdjustments.useAction(current?.id ?? 0, 'post')
  const reverse = stockAdjustments.useAction<{ reason: string }>(current?.id ?? 0, 'reverse')
  const sheet = useCountSheet()
  const saveIdem = useIdempotencyKey()
  const postIdem = useIdempotencyKey()
  const reverseIdem = useIdempotencyKey()
  useEffect(() => { if (!warehouse && warehouses.data?.length === 1) setWarehouse(String(warehouses.data[0]!.id)) }, [warehouses.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = lines.filter((l) => l.product && l.counted.trim() !== '')
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const savedFor = (productId?: number) => saved.find((l) => l.product_id === productId)

  async function save() {
    if (busyRef.current) return
    if (!warehouse || chosen.length === 0) { setError(new Error('Choose the warehouse and enter at least one counted quantity.')); return }
    busyRef.current = true; setBusy(true); setError(null)
    const input = { adjustment_date: date, warehouse_id: Number(warehouse), reason: reason as never, notes: notes.trim() || null,
      lines: chosen.map((l) => ({ product_id: l.product!.id, counted_qty: l.counted.trim() })) }
    try {
      const s = current ? await update.mutateAsync({ input, version: current.version }) : await create.mutateAsync({ input, idempotencyKey: saveIdem.key })
      if (!current) saveIdem.reset()
      setCurrent(s)
      toast({ tone: 'positive', title: `Draft ${s.number} saved`, description: costs && s.net_value ? `Value change ${formatTaka(s.net_value, { symbol: true })} · not posted yet` : 'Not posted yet' })
      if (!current) navigate(`/inventory/adjustments/${s.id}`, { replace: true })
    } catch (e) {
      setError(e)
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }

  async function doPost() {
    try {
      const p = await post.mutateAsync({ idempotencyKey: postIdem.key })
      postIdem.reset(); setDialog(null); setCurrent(p)
      toast({ tone: 'positive', title: `${p.number} posted`, description: 'Stock is corrected in the warehouse.' })
    } catch (e) {
      setDialog(null); setError(e)
    }
  }

  async function loadSheet(file: File) {
    setError(null)
    try {
      const r = await sheet.mutateAsync(file)
      const loaded = r.lines.map((l) => blank({ id: l.product_id, code: l.product_code, name: l.product_name, unit: l.unit } as unknown as Product, l.counted_qty))
      setLines((ls) => [...ls.filter((l) => l.product && !loaded.some((n) => n.product!.id === l.product!.id)), ...loaded])
      setUnknown(r.unknown_codes ?? [])
      toast({ tone: 'positive', title: `${loaded.length} counted product${loaded.length === 1 ? '' : 's'} loaded`, description: 'Check the quantities, then save the draft.' })
    } catch (e) {
      setError(e)
    }
  }

  /** The warehouse's products with today's quantity and a blank "Counted" column, for counting on paper or in a sheet. */
  async function downloadSheet() {
    if (!warehouse) { setError(new Error('Choose the warehouse first.')); return }
    const rows: StockLevel[] = []
    for (let page = 1; ; page++) {
      const r = (await api.request<{ data: StockLevel[]; meta: PageMeta }>('GET', `/warehouses/${warehouse}/stock`, { query: { page, per_page: 100, sort: 'code' } })).data
      rows.push(...r.data)
      if (page >= r.meta.last_page) break
    }
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const csv = ['Code,Product,In system,Counted', ...rows.map((l) => [l.product_code, l.product_name, l.qty_on_hand, ''].map(cell).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`﻿${csv}\n`], { type: 'text/csv' }))
    a.download = `count-sheet-${warehouses.data?.find((w) => String(w.id) === warehouse)?.code ?? warehouse}-${date}.csv`
    a.click()
  }

  const fieldErrors = error instanceof ApiError ? Object.values(error.fieldErrors).flat() : []
  const preview = (current?.posting_preview ?? []) as PostingLine[]
  const whOptions = [{ value: '', label: 'Choose…' }, ...(warehouses.data ?? []).filter((w) => w.status !== 'inactive' || String(w.id) === warehouse).map((w) => ({ value: String(w.id), label: w.name }))]
  const rows = lines.map((l, i) => {
    const s = savedFor(l.product?.id)
    return { id: l.key, i, l, system: s?.system_qty ?? '', diff: s && s.counted_qty.replace(/\.?0+$/, '') === (l.counted.trim().replace(/\.?0+$/, '') || '0') ? s.difference_qty : '',
      cost: s?.unit_cost ?? '', value: s?.value ?? '' }
  })

  return (
    <>
      <PageHeader eyebrow="Inventory · Stock adjustment" title={current ? current.number : 'New stock adjustment'}
        description={current ? `${current.warehouse_name ?? ''} · ${REASONS.find((r) => r[0] === current.reason)?.[1] ?? current.reason}` : 'Correct stock after a count, damage, expiry, loss or samples.'} />
      {current && (
        <ActionBar>
          <DocStatusBadge status={current.status} />
          {editable && can('inventory.create') && <Button variant="primary" size="sm" onClick={() => setDialog('post')} data-testid="post-adjustment">Post adjustment</Button>}
          {current.status === 'posted' && can('inventory.approve') && <Button variant="ghost" size="sm" onClick={() => setDialog('reverse')} data-testid="reverse-adjustment">Reverse</Button>}
          {editable && can('inventory.delete') && <Button variant="ghost" size="sm" icon="trash-2" onClick={() => setDialog('delete')}>Delete draft</Button>}
        </ActionBar>
      )}
      {current?.status === 'reversed' && <div style={{ marginBottom: 12 }}><Banner tone="warning" title="Reversed">Its stock and entry were taken back.</Banner></div>}
      <ProblemBanner error={error} />
      {fieldErrors.length > 0 && (
        <ul style={{ margin: '8px 0 12px', paddingLeft: 18, color: 'var(--negative)', fontSize: 14 }} data-testid="adjustment-errors">{fieldErrors.map((m, i) => <li key={i}>{m}</li>)}</ul>
      )}
      {unknown.length > 0 && <div style={{ marginBottom: 12 }}><Banner tone="warning" title="Codes not found">{unknown.join(', ')} — these rows were skipped.</Banner></div>}

      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ minWidth: 0, display: 'grid', gap: 16 }}>
          <Card title="Details">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <Field label="Adjustment number" hint="Given when first saved"><Input mono readOnly value={current?.number ?? 'ADJ-…'} aria-label="Adjustment number" /></Field>
              <Field label="Date" htmlFor="adj-date"><Input id="adj-date" type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Warehouse" htmlFor="adj-wh">
                <Select key={whOptions.length} id="adj-wh" options={whOptions} value={warehouse} disabled={!editable} onChange={(e) => setWarehouse(e.target.value)} />
              </Field>
              <Field label="Reason" htmlFor="adj-reason">
                <Select id="adj-reason" options={REASONS.map(([v, l]) => ({ value: v!, label: l! }))} value={reason} disabled={!editable} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
          </Card>
          <Card title="Count" padding="none" actions={editable ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" size="sm" icon="download" onClick={() => void downloadSheet().catch(setError)} data-testid="download-sheet">Count sheet</Button>
              <Button variant="ghost" size="sm" icon="upload" loading={sheet.isPending} onClick={() => fileRef.current?.click()} data-testid="load-sheet">Load counts</Button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden data-testid="sheet-file"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadSheet(f) }} />
            </div>) : undefined}>
            <div style={{ overflowX: 'auto' }}>
              <DataTable caption="Counted products" rows={rows} columns={[
                { key: 'product', label: 'Product', render: (_v: unknown, r: (typeof rows)[number]) => editable
                  ? <div style={{ minWidth: 220 }}><ProductPicker value={r.l.product} onChange={(p) => setLine(r.l.key, { product: p })} aria-label={`Product, line ${r.i + 1}`} /></div>
                  : <span>{r.l.product?.name} <span className="lf-code">{r.l.product?.code}</span></span> },
                { key: 'system', label: 'In system', align: 'right', render: (v: unknown) => <span className="lf-num">{(v as string) || '—'}</span> },
                { key: 'counted', label: 'Counted', render: (_v: unknown, r: (typeof rows)[number]) => (
                  <Input aria-label={`Counted, line ${r.i + 1}`} inputMode="decimal" style={{ maxWidth: 120 }} value={r.l.counted} disabled={!editable}
                    onChange={(e) => setLine(r.l.key, { counted: e.target.value })} />) },
                { key: 'diff', label: 'Difference', align: 'right', render: (v: unknown) => <span className="lf-num" data-testid="difference">{(v as string) || '—'}</span> },
                ...(costs ? [{ key: 'cost', label: 'Unit cost (৳)', type: 'amount' as const }, { key: 'value', label: 'Value (৳)', type: 'amount' as const }] : []),
                ...(editable ? [{ key: 'remove', label: '', render: (_v: unknown, r: (typeof rows)[number]) => (
                  <IconButton icon="x" size="sm" label={`Remove line ${r.i + 1}`} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== r.l.key) : [blank()]))} />) }] : []),
              ]} />
            </div>
            {editable && <div style={{ padding: 12 }}><Button variant="ghost" size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, blank()])} data-testid="add-line">Add product</Button></div>}
          </Card>
          <Card title="Notes">
            <Input aria-label="Notes" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — who counted, what was found" />
          </Card>
        </div>
        <aside className="lf-c4 lf-form-aside" style={{ display: 'grid', gap: 16 }}>
          {costs && (
            <Card title="What gets posted">
              {preview.length === 0 ? <p style={{ margin: 0, color: 'var(--ink-muted)' }}>{current ? 'No value change: nothing is posted.' : 'Save the draft to see the entry.'}</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }} data-testid="posting-preview">
                  <tbody>{preview.map((l, i) => (
                    <tr key={i}><td style={{ padding: '4px 0' }}><span className="lf-code">{l.ledger_code}</span> {l.ledger_name}</td>
                      <td style={{ textAlign: 'right' }} className="lf-num">{l.debit !== '0.00' ? `Dr ${formatTaka(l.debit)}` : `Cr ${formatTaka(l.credit)}`}</td></tr>))}
                  </tbody>
                </table>
              )}
              {current?.net_value && <p style={{ margin: '12px 0 0', fontWeight: 600 }} data-testid="net-value">Net change {formatTaka(current.net_value, { symbol: true })}</p>}
            </Card>
          )}
          <Card title="How it works">
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 14 }}>Enter what you counted. Saving reads what the system holds; posting checks it again, so if stock moved in between you are asked to count again.</p>
          </Card>
        </aside>
      </div>

      {editable && (
        <div className="lf-form-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button variant="secondary" onClick={() => navigate('/inventory/adjustments')}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()} data-testid="save-adjustment">Save draft</Button>
        </div>
      )}

      {dialog === 'post' && current && (
        <ConfirmDialog title={`Post ${current.number}?`} confirmLabel="Post" tone="info" loading={post.isPending} onConfirm={() => void doPost()} onClose={() => setDialog(null)}
          description={`Stock in ${current.warehouse_name ?? 'the warehouse'} is set to the counted quantities${costs && current.net_value ? ` and ${formatTaka(current.net_value, { symbol: true })} is booked` : ''}.`} />
      )}
      {dialog === 'reverse' && current && (
        <ReasonDialog title={`Reverse ${current.number}?`} confirmLabel="Reverse" loading={reverse.isPending} onClose={() => setDialog(null)}
          description="The stock goes back to what it was before and a mirror entry is posted today."
          onConfirm={async (r) => {
            const a = await reverse.mutateAsync({ body: { reason: r }, idempotencyKey: reverseIdem.key })
            reverseIdem.reset(); setCurrent(a); setDialog(null)
            toast({ tone: 'positive', title: `${a.number} reversed` })
          }} />
      )}
      {dialog === 'delete' && current && (
        <DeleteDialog name={current.number} what="draft" description="Its number is voided and never reused." loading={del.isPending} onClose={() => setDialog(null)}
          onConfirm={() => void del.mutateAsync().then(() => { toast({ tone: 'positive', title: 'Draft deleted' }); navigate('/inventory/adjustments') }).catch((e) => { setDialog(null); setError(e) })} />
      )}
    </>
  )
}
