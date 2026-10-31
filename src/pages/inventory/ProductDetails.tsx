import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { StockLevel } from '../../api/contract.gen'
import { useProduct } from '../../api/inventory'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { ActivityTimeline } from '../../components/ActivityTimeline'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { NotFound } from '../../components/states'
import { SummaryTile } from '../../components/SummaryTile'
import { DetailHeader, panel, RecentMovements, type HeaderAction } from './parts'

/**
 * D4 Product details (02 #page-d4; backlog P11.2-FE-01): what the item is, its stock in every warehouse (each opens
 * D8), the latest movements (link to D9) and, on the Activity tab, every change with old → new values — its price
 * history. Cost, value and average show only with inventory.view_costs (BR-052; the API leaves them out). Actions:
 * Edit (D3), Adjust (D10) and Transfer (D11) for the roles that may.
 */
const STATUS: Record<string, { label: string; tone: 'positive' | 'warning' | 'negative' | 'neutral' }> = {
  in_stock: { label: 'In stock', tone: 'positive' }, low_stock: { label: 'Low stock', tone: 'warning' }, out_of_stock: { label: 'Out of stock', tone: 'negative' },
  not_stocked: { label: 'Not stocked', tone: 'neutral' }, not_tracked: { label: 'Service', tone: 'neutral' },
}

export function ProductDetails() {
  const { Badge, Tabs, Card, DataTable, EmptyState } = ds()
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { can } = useSession()
  const costs = can('inventory.view_costs')
  const q = useProduct(id)
  const [params, setParams] = useSearchParams()
  const TABS = [{ value: 'overview', label: 'Overview' }, { value: 'activity', label: 'Activity and prices' }]
  const tab = params.get('tab') === 'activity' ? 'activity' : 'overview'

  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this item" back="/inventory/products" backLabel="Products" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  const p = q.data.product
  const tracked = p.track_stock
  const status = STATUS[p.stock_status] ?? STATUS.not_tracked!

  const actions: HeaderAction[] = [
    ...(can('inventory.edit') ? [{ label: 'Edit', icon: 'pencil', onClick: () => navigate(`/inventory/products/${p.id}/edit`), testId: 'edit-product' }] : []),
    ...(tracked && can('inventory.create') ? [
      { label: 'Adjust stock', icon: 'sliders-horizontal', onClick: () => navigate(`/inventory/adjustments/new?product_id=${p.id}`), testId: 'adjust-product' },
      { label: 'Transfer', icon: 'arrow-left-right', onClick: () => navigate(`/inventory/transfers/new?product_id=${p.id}`), testId: 'transfer-product' },
    ] : []),
  ]
  const levels = (p.warehouses ?? []).map((l: StockLevel) => ({ id: l.warehouse_id, warehouse: l.warehouse_name, onHand: `${l.qty_on_hand} ${p.unit}`,
    reorder: l.reorder_level === '0.000' ? '—' : l.reorder_level, value: l.value ?? '', status: STATUS[l.status]?.label ?? l.status }))
  const levelColumns: DataColumn[] = [
    { key: 'warehouse', label: 'Warehouse', render: (v, r) => <Link to={`/inventory/warehouses/${r.id}`}>{v as string}</Link> },
    { key: 'onHand', label: 'On hand', mono: true, align: 'right' }, { key: 'reorder', label: 'Reorder at', mono: true, align: 'right' },
    ...(costs ? [{ key: 'value', label: 'Value (৳)', type: 'amount' as const }] : []),
    { key: 'status', label: 'Status' },
  ]
  const facts = [
    { label: 'Code', value: p.code }, { label: 'Type', value: tracked ? 'Stock item' : 'Service' }, { label: 'Unit', value: p.unit },
    { label: 'Category', value: p.category?.name ?? '—' }, { label: 'Stock group', value: p.stock_group?.name ?? '—' }, { label: 'Barcode', value: p.barcode || '—' },
    { label: 'Selling price', value: formatTaka(p.selling_price, { symbol: true }) },
    { label: 'Wholesale price', value: p.wholesale_price ? formatTaka(p.wholesale_price, { symbol: true }) : '—' },
    ...(costs ? [{ label: 'Last purchase cost', value: p.last_purchase_cost ? formatTaka(p.last_purchase_cost, { symbol: true }) : '—' }] : []),
    { label: 'Preferred supplier', value: p.preferred_supplier?.name ?? '—' },
  ]

  return (
    <>
      <DetailHeader title={p.name} testId="product-name" actions={actions}
        badges={<><Badge tone={status.tone} dot>{status.label}</Badge>{!p.is_active && <Badge tone="neutral">Inactive</Badge>}</>}
        facts={<><span className="lf-code">{p.code}</span>{p.category && <span>{p.category.name}</span>}<span>{formatTaka(p.selling_price, { symbol: true })} per {p.unit}</span></>} />

      {tracked && (
        <div className="lf-grid" style={{ marginBottom: 16 }}>
          <SummaryTile label="On hand" value={`${p.on_hand ?? '0.000'} ${p.unit}`} sub={`${levels.length} warehouse${levels.length === 1 ? '' : 's'}`} testId="tile-on-hand" />
          {costs && <SummaryTile label="Stock value" value={formatTaka(p.stock_value ?? '0.00', { symbol: true })} sub="At moving average cost" testId="tile-value" />}
          {costs && <SummaryTile label="Average cost" value={formatTaka(p.avg_cost ?? '0.00', { symbol: true })} sub={`Per ${p.unit}`} testId="tile-avg" />}
          {costs && <SummaryTile label="Last purchase cost" value={p.last_purchase_cost ? formatTaka(p.last_purchase_cost, { symbol: true }) : '—'} testId="tile-last-cost" />}
        </div>
      )}

      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <Tabs key={tab} items={TABS} value={tab} onChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })} />
      </div>

      {tab === 'activity' && (
        <section style={{ ...panel, padding: '16px 20px' }} aria-label="Activity">
          <p style={{ margin: '0 0 12px', color: 'var(--ink-muted)' }}>Every change to this item, oldest values first — including its selling and wholesale prices.</p>
          <ActivityTimeline type="product" id={p.id} />
        </section>
      )}

      {tab === 'overview' && (
        <div className="lf-grid" style={{ alignItems: 'start' }}>
          <div className="lf-c8" style={{ minWidth: 0, display: 'grid', gap: 16 }}>
            {tracked ? (
              <>
                <Card title="Stock by warehouse" padding="none">
                  <div style={{ overflowX: 'auto' }} data-testid="stock-by-warehouse">
                    <DataTable caption="Stock by warehouse" columns={levelColumns} rows={levels}
                      emptyState={<EmptyState icon="warehouse" title="No warehouses yet" description="Add a warehouse to keep stock of this item." />} />
                  </div>
                </Card>
                <RecentMovements productId={p.id} costs={costs} />
              </>
            ) : (
              <Card title="A service"><p style={{ margin: 0, color: 'var(--ink-muted)' }}>Services are sold or bought but keep no stock, so they have no warehouses or movements.</p></Card>
            )}
          </div>
          <section className="lf-c4" style={{ ...panel, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Item facts">
            <h2 style={{ margin: 0, font: '650 16px/24px var(--font-sans)' }}>Item facts</h2>
            {facts.map((f) => (
              <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--ink-muted)' }}>{f.label}</span><span style={{ textAlign: 'right' }}>{f.value}</span>
              </div>
            ))}
          </section>
        </div>
      )}
    </>
  )
}
