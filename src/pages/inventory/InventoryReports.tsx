import { Link, useNavigate } from 'react-router-dom'
import type { ReportData } from '../../api/contract.gen'
import { useWarehouses } from '../../api/inventory'
import { dhakaToday } from '../../api/platform'
import { totalsOf, useReport } from '../../api/reports'
import { useOrderFromLowStock } from '../../api/trade'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'
import { ReportLayout } from '../../components/report/ReportLayout'
import { StatementTable } from '../../components/report/StatementTable'
import { ProblemBanner } from '../../components/ProblemBanner'
import { PageSkeleton } from '../../components/PageSkeleton'
import { SelectableTable } from '../../components/SelectableTable'
import { SummaryTile } from '../../components/SummaryTile'
import { ChoiceFilter, DateFilter } from '../reports/filters'

/**
 * Inventory reports (backlog P11.2-FE-05; 06 §11.1, §17; BR-052): D12 low stock with "Create purchase orders" for the
 * selected rows (one draft PO per preferred supplier and warehouse), D13 stock valuation as of a date (items or stock
 * groups, agreement with the inventory ledgers, print and export) and D14 the inventory summary. Every figure is the
 * API's; values only appear for roles with inventory.view_costs (the API leaves them out otherwise).
 */
function WarehouseFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { Field, Select } = ds()
  const warehouses = useWarehouses()
  return (
    <div style={{ width: 210 }}>
      <Field label="Warehouse" htmlFor="rep-wh">
        <Select id="rep-wh" value={value} onChange={(e) => onChange(e.target.value)}
          options={[{ value: '', label: 'All warehouses' }, ...(warehouses.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))]} />
      </Field>
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = { out_of_stock: 'Out of stock', low_stock: 'Low stock' }

interface LowRow { kind: string; product_id: number; code: string; name: string; unit: string | null; warehouse_id: number; warehouse: string; on_hand: string
  reorder_level: string; status: string; supplier_id: number | null; supplier: string | null; suggested: string; order_value?: string }

/** D12 Low-stock report. */
export function LowStock() {
  const { PageHeader, Badge, EmptyState, Button } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const { get, set } = useListParams()
  const query = { warehouse_id: get('warehouse_id') || undefined, status: get('status') || undefined, group_by_supplier: get('by_supplier') === 'true' ? 'true' : undefined }
  const r = useReport('inventory/low-stock', query)
  const order = useOrderFromLowStock()
  const idem = useIdempotencyKey()
  const t = totalsOf<Record<string, string | number>>(r.data)
  const items = ((r.data?.rows ?? []) as unknown as LowRow[])
  const key = (x: LowRow) => x.product_id * 100_000 + x.warehouse_id
  const rows = items.map((x) => (x.kind === 'group'
    ? { id: -(x.supplier_id ?? 0) - 1, name: `— ${x.name}`, group: true }
    : { id: key(x), name: x.name, code: x.code, warehouse: x.warehouse, onHand: `${x.on_hand} ${x.unit ?? ''}`, reorder: x.reorder_level, status: x.status,
      supplier: x.supplier ?? '—', suggested: x.suggested, value: x.order_value ?? '', x }))
  const columns: DataColumn[] = [
    { key: 'name', label: 'Product', render: (v, row) => row.group ? <strong>{v as string}</strong> : <Link to={`/inventory/products/${(row.x as LowRow).product_id}`}>{v as string}</Link> },
    { key: 'warehouse', label: 'Warehouse' }, { key: 'onHand', label: 'On hand', mono: true, align: 'right' }, { key: 'reorder', label: 'Reorder at', mono: true, align: 'right' },
    { key: 'status', label: 'Status', render: (v) => v ? <Badge tone={v === 'out_of_stock' ? 'negative' : 'warning'} dot>{STATUS_LABEL[v as string]}</Badge> : null },
    { key: 'supplier', label: 'Preferred supplier' }, { key: 'suggested', label: 'Suggested', mono: true, align: 'right' },
    ...(can('inventory.view_costs') ? [{ key: 'value', label: 'Order value (৳)', type: 'amount' as const }] : []),
  ]
  const createOrders = async (ids: number[], clear: () => void) => {
    const chosen = items.filter((x) => x.kind === 'item' && ids.includes(key(x)))
    try {
      const res = await order.mutateAsync({ body: { order_date: dhakaToday(), rows: chosen.map((x) => ({ product_id: x.product_id, warehouse_id: x.warehouse_id, quantity: x.suggested })) },
        idempotencyKey: idem.key })
      idem.reset(); clear()
      toast({ tone: res.failed.length ? 'warning' : 'positive', title: `${res.succeeded.length} draft purchase order${res.succeeded.length === 1 ? '' : 's'} created`,
        description: res.failed.length ? res.failed.map((f) => f.detail).join(' · ') : 'Check them and send them to the suppliers.' })
      if (res.succeeded.length === 1) navigate(`/purchases/orders/${res.succeeded[0]}`)
    } catch (e) {
      toast({ tone: 'negative', title: 'Could not create the orders', description: e instanceof Error ? e.message : undefined })
    }
  }

  return (
    <>
      <PageHeader title="Low stock" description="Items at or below their reorder level, with what to order." />
      <div className="lf-report-filters" role="group" aria-label="Report filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <WarehouseFilter value={query.warehouse_id ?? ''} onChange={(v) => set({ warehouse_id: v || null })} />
        <ChoiceFilter label="Show" value={query.status ?? 'all'} onChange={(v) => set({ status: v === 'all' ? null : v })}
          options={[{ value: 'all', label: 'All' }, { value: 'out', label: 'Out' }, { value: 'low', label: 'Low' }]} />
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
          <input type="checkbox" checked={!!query.group_by_supplier} onChange={(e) => set({ by_supplier: e.target.checked ? 'true' : null })} data-testid="by-supplier" />
          Group by supplier
        </label>
      </div>
      <ProblemBanner error={r.error} onRetry={() => void r.refetch()} />
      {!r.data ? <PageSkeleton template="report" /> : (
        <>
          <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="low-tiles">
            <SummaryTile label="Items to order" value={String(t.items ?? 0)} testId="tile-items" />
            <SummaryTile label="Out of stock" value={String(t.out_of_stock ?? 0)} tone={Number(t.out_of_stock) > 0 ? 'negative' : undefined} testId="tile-out" />
            <SummaryTile label="Low stock" value={String(t.low_stock ?? 0)} testId="tile-low" />
            {t.order_value !== undefined ? <SummaryTile label="Order value" value={formatTaka(String(t.order_value), { symbol: true })} sub="Suggested quantities at last cost" testId="tile-order-value" />
              : <SummaryTile label="No preferred supplier" value={String(t.without_supplier ?? 0)} />}
          </div>
          <div style={{ overflowX: 'auto' }} data-testid="low-stock">
            <SelectableTable caption="Low stock" columns={columns} rows={rows} loading={r.isFetching && !r.data}
              emptyState={<EmptyState icon="check" title="Nothing is low" description="Every item is above its reorder level." />}
              actions={(ids, clear) => can('purchases.create')
                ? <Button variant="primary" size="sm" loading={order.isPending} onClick={() => void createOrders(ids.filter((i) => i > 0), clear)} data-testid="create-pos">Create purchase orders</Button>
                : null} />
          </div>
        </>
      )}
    </>
  )
}

/** D13 Stock valuation. */
export function Valuation() {
  const navigate = useNavigate()
  const { get, set } = useListParams()
  const query = { as_of: get('as_of') || dhakaToday(), warehouse_id: get('warehouse_id') || undefined, level: get('level') || undefined }
  const r = useReport('inventory/valuation', query)
  const t = totalsOf<Record<string, string | number>>(r.data)
  return (
    <ReportLayout title="Stock valuation" description="Quantity and value of every item, at moving average cost, as of a date."
      path="inventory/valuation" query={query} report={r.data} loading={r.isFetching} error={r.error} onRetry={() => void r.refetch()}
      filters={<>
        <DateFilter id="val-asof" label="As of" value={query.as_of} onChange={(v) => set({ as_of: v || null })} />
        <WarehouseFilter value={query.warehouse_id ?? ''} onChange={(v) => set({ warehouse_id: v || null })} />
        <ChoiceFilter label="Show" value={query.level ?? 'items'} onChange={(v) => set({ level: v === 'items' ? null : v })}
          options={[{ value: 'items', label: 'Items' }, { value: 'groups', label: 'Stock groups' }]} />
      </>}>
      {r.data && (
        <>
          <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="valuation-tiles">
            <SummaryTile label="Stock value" value={formatTaka(String(t.value ?? '0'), { symbol: true })} testId="tile-value" />
            <SummaryTile label={query.level === 'groups' ? 'Stock groups' : 'Items'} value={String(t.items ?? 0)} />
            <SummaryTile label="Units" value={String(t.quantity ?? '0')} />
          </div>
          <StatementTable report={r.data} testId="valuation" onOpen={(row) => { if (row.product_id) navigate(`/inventory/products/${String(row.product_id)}`) }} />
        </>
      )}
    </ReportLayout>
  )
}

interface SummaryMeta {
  by_group: { name: string; quantity: string; value?: string; share: string }[]
  monthly: { month: string; units_in: string; units_out: string; value_in?: string; value_out?: string }[]
  attention: { product_id: number; code: string; name: string; warehouse: string; on_hand: string; reorder_level: string; status: string }[]
}

/** D14 Inventory summary. */
export function InventorySummary() {
  const { PageHeader, Card, DataTable, EmptyState, Badge } = ds()
  const navigate = useNavigate()
  const r = useReport('inventory/summary', {})
  if (r.error) return <><PageHeader title="Inventory summary" /><ProblemBanner error={r.error} onRetry={() => void r.refetch()} /></>
  if (!r.data) return <PageSkeleton template="report" />
  const data: ReportData = r.data
  const t = totalsOf<Record<string, string | number>>(data)
  const meta = (data.meta ?? {}) as unknown as SummaryMeta
  const costs = t.stock_value !== undefined
  const bars = meta.by_group ?? []
  const movers = (data.rows as Record<string, unknown>[]).map((x) => ({ id: Number(x.product_id), name: x.name, sold: x.sold, onHand: x.on_hand,
    cover: x.days_of_cover === null ? '—' : `${String(x.days_of_cover)} days`, revenue: x.revenue }))
  const moverColumns: DataColumn[] = [
    { key: 'name', label: 'Product' }, { key: 'sold', label: 'Sold', mono: true, align: 'right' }, { key: 'onHand', label: 'On hand', mono: true, align: 'right' },
    { key: 'cover', label: 'Days of cover', align: 'right' }, { key: 'revenue', label: 'Revenue (৳)', type: 'amount' },
  ]
  return (
    <>
      <PageHeader title="Inventory summary" description="Stock value by group, what came in and went out, what sells fastest and what needs attention." />
      <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="summary-tiles">
        {costs && <SummaryTile label="Stock value" value={formatTaka(String(t.stock_value), { symbol: true })} testId="tile-value" />}
        <SummaryTile label="Items in stock" value={`${t.in_stock ?? 0} of ${t.products ?? 0}`} testId="tile-in-stock" />
        <SummaryTile label="Low stock" value={String(t.low_stock ?? 0)} testId="tile-low" />
        <SummaryTile label="Out of stock" value={String(t.out_of_stock ?? 0)} tone={Number(t.out_of_stock) > 0 ? 'negative' : undefined} testId="tile-out" />
      </div>
      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c6" style={{ minWidth: 0 }}>
          <Card title={costs ? 'Value by stock group' : 'Units by stock group'}>
            {bars.length === 0 ? <p style={{ margin: 0, color: 'var(--ink-muted)' }}>No stock yet.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }} data-testid="by-group">
                {bars.map((g) => (
                  <li key={g.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{g.name}</span>
                      <span className="lf-num">{costs ? formatTaka(g.value ?? '0', { symbol: true }) : g.quantity}</span></div>
                    <div style={{ height: 8, borderRadius: 4, background: 'var(--line)' }}>
                      <div style={{ height: 8, borderRadius: 4, background: 'var(--brand)', width: `${g.share}%`, minWidth: 2 }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="lf-c6" style={{ minWidth: 0 }}>
          <Card title="Units in and out, last 6 months">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }} data-testid="monthly-flow">
              <thead><tr style={{ color: 'var(--ink-muted)', textAlign: 'right' }}><th style={{ textAlign: 'left' }}>Month</th><th>In</th><th>Out</th></tr></thead>
              <tbody>{(meta.monthly ?? []).map((m) => (
                <tr key={m.month}><td>{m.month}</td><td style={{ textAlign: 'right' }} className="lf-num">{m.units_in}</td><td style={{ textAlign: 'right' }} className="lf-num">{m.units_out}</td></tr>))}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="lf-c8" style={{ minWidth: 0 }}>
          <Card title="Fastest movers, last 30 days" padding="none">
            <div style={{ overflowX: 'auto' }}>
              <DataTable caption="Fastest movers" columns={moverColumns} rows={movers} onRowClick={(row: { id: number }) => navigate(`/inventory/products/${row.id}`)}
                emptyState={<EmptyState icon="trending-up" title="No sales in the last 30 days" description="Posted invoices fill this list." />} />
            </div>
          </Card>
        </div>
        <div className="lf-c4" style={{ minWidth: 0 }}>
          <Card title="Needs attention" actions={<Link to="/inventory/low-stock">Low stock</Link>}>
            {(meta.attention ?? []).length === 0 ? <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Nothing is below its reorder level.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }} data-testid="attention">
                {meta.attention.map((a) => (
                  <li key={`${a.product_id}-${a.warehouse}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span><Link to={`/inventory/products/${a.product_id}`}>{a.name}</Link><br /><span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{a.warehouse} · {a.on_hand} on hand</span></span>
                    <Badge tone={a.status === 'out_of_stock' ? 'negative' : 'warning'} dot>{STATUS_LABEL[a.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
