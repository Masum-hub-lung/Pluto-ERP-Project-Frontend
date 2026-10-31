import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { StockLevel } from '../../api/contract.gen'
import { useWarehouse } from '../../api/inventory'
import { stockTransfers, useWarehouseStock } from '../../api/stock'
import { useBranches } from '../../api/platform'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../../components/ListCard'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { NotFound } from '../../components/states'
import { SummaryTile } from '../../components/SummaryTile'
import { DocStatusBadge } from '../../components/trade/TradeParts'
import { shortDate } from '../purchases/BillList'
import { DetailHeader, panel, RecentMovements, type HeaderAction } from './parts'
import { WarehouseDialog } from './WarehouseList'

/**
 * D8 Warehouse details (02 #page-d8; backlog P11.2-FE-02): the products stocked there from GET /warehouses/{id}/stock,
 * with search, "only below reorder level" and paging in the URL; tiles; facts, transfers in and out, and the latest
 * movements. Values only with inventory.view_costs (BR-052). Actions: Edit (dialog), Count stock (D10), Transfer (D11).
 */
const STATUS: Record<string, string> = { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock', not_stocked: 'Not stocked' }

export function WarehouseDetails() {
  const { Badge, Input, DataTable, EmptyState, Card } = ds()
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { can } = useSession()
  const costs = can('inventory.view_costs')
  const q = useWarehouse(id)
  const branches = useBranches()
  const { get, set, search, setSearch, page } = useListParams()
  const below = get('below_reorder') === 'true'
  const stock = useWarehouseStock(id, { q: get('q') || undefined, below_reorder: below ? 'true' : undefined, sort: get('sort') || undefined, page, per_page: 25 })
  const transfers = stockTransfers.useList({ warehouse_id: id, per_page: 5, sort: '-created_at' }, id > 0)
  const [editing, setEditing] = useState(false)

  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this warehouse" back="/inventory/warehouses" backLabel="Warehouses" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  const w = q.data.warehouse

  const actions: HeaderAction[] = [
    ...(can('inventory.edit') ? [{ label: 'Edit', icon: 'pencil', onClick: () => setEditing(true), testId: 'edit-warehouse' }] : []),
    ...(can('inventory.create') ? [
      { label: 'Count stock', icon: 'clipboard-list', onClick: () => navigate(`/inventory/adjustments/new?warehouse_id=${w.id}`), testId: 'count-stock' },
      { label: 'Transfer', icon: 'arrow-left-right', onClick: () => navigate(`/inventory/transfers/new?from=${w.id}`), testId: 'transfer-from' },
    ] : []),
  ]
  const rows = (stock.data?.data ?? []).map((l: StockLevel) => ({ id: l.product_id, code: l.product_code, name: l.product_name, onHand: l.qty_on_hand,
    reorder: l.reorder_level === '0.000' ? '—' : l.reorder_level, value: l.value ?? '', status: l.status }))
  const columns: DataColumn[] = [
    { key: 'code', label: 'Code', mono: true }, { key: 'name', label: 'Product', render: (v) => <span style={{ fontWeight: 600 }}>{v as string}</span> },
    { key: 'onHand', label: 'On hand', mono: true, align: 'right' }, { key: 'reorder', label: 'Reorder at', mono: true, align: 'right' },
    ...(costs ? [{ key: 'value', label: 'Value (৳)', type: 'amount' as const }] : []),
    { key: 'status', label: 'Status', render: (v) => <Badge tone={v === 'in_stock' ? 'positive' : v === 'low_stock' ? 'warning' : v === 'out_of_stock' ? 'negative' : 'neutral'} dot>{STATUS[v as string] ?? (v as string)}</Badge> },
  ]
  const filtered = !!(get('q') || below)
  const empty = filtered
    ? <EmptyState icon="search" title="Nothing matches" description="Clear the search or the below-reorder filter." />
    : <EmptyState icon="package" title="No stock here yet" description="Products appear once a bill, transfer or opening stock brings them in." />
  const facts = [
    { label: 'Code', value: w.code }, { label: 'Branch', value: (branches.data ?? []).find((b) => b.id === w.branch_id)?.name ?? '—' },
    { label: 'Address', value: w.address || '—' }, { label: 'Phone', value: w.phone || '—' }, { label: 'Manager', value: w.manager?.name ?? '—' },
    { label: 'Opens on', value: w.opens_on ? shortDate(w.opens_on) : '—' },
  ]
  const transferRows = (transfers.data?.data ?? []).map((t) => ({ id: t.id, number: t.number, route: t.from_warehouse_id === w.id ? `To ${t.to_warehouse_name}` : `From ${t.from_warehouse_name}`,
    units: t.total_units, status: t.status }))

  return (
    <>
      <DetailHeader title={w.name} testId="warehouse-name" actions={actions}
        badges={<><Badge tone={w.status === 'active' ? 'positive' : w.status === 'planned' ? 'info' : 'neutral'} dot>{w.status === 'active' ? 'Active' : w.status === 'planned' ? 'Planned' : 'Inactive'}</Badge>
          {w.is_default_for_sales && <Badge tone="accent">Default for sales</Badge>}</>}
        facts={<><span className="lf-code">{w.code}</span>{w.address && <span>{w.address}</span>}</>} />

      <div className="lf-grid" style={{ marginBottom: 16 }}>
        <SummaryTile label="Products on hand" value={String(w.products_count)} testId="tile-products" />
        <SummaryTile label="Below reorder level" value={String(w.below_reorder_count)} tone={w.below_reorder_count > 0 ? 'negative' : undefined} testId="tile-below" />
        {costs && <SummaryTile label="Stock value" value={formatTaka(w.stock_value ?? '0.00', { symbol: true })} sub="At moving average cost" testId="tile-value" />}
        {w.capacity_used_pct && <SummaryTile label="Space used" value={`${w.capacity_used_pct} %`} />}
      </div>

      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ minWidth: 0, display: 'grid', gap: 16 }}>
          <ProblemBanner error={stock.error} onRetry={() => void stock.refetch()} />
          <ListCard label="Stock" meta={stock.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
            cards={{ columns, rows, loading: stock.isPending, onOpen: (r) => navigate(`/inventory/products/${r.id}`), mobileColumns: ['name', 'onHand', 'status'], badgeKey: 'status', empty }}
            toolbar={<>
              <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
                <Input icon="search" placeholder="Search name, code or barcode" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search stock" />
              </div>
              <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                <input type="checkbox" checked={below} onChange={(e) => set({ below_reorder: e.target.checked ? 'true' : null })} data-testid="below-reorder" />
                Only below reorder level
              </label>
            </>}>
            <DataTable caption="Stock in this warehouse" columns={columns} rows={rows} loading={stock.isPending} emptyState={empty}
              onRowClick={(r: { id: number }) => navigate(`/inventory/products/${r.id}`)} />
          </ListCard>
          <RecentMovements warehouseId={w.id} costs={costs} />
        </div>
        <div className="lf-c4" style={{ display: 'grid', gap: 16 }}>
          <section style={{ ...panel, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Warehouse facts">
            <h2 style={{ margin: 0, font: '650 16px/24px var(--font-sans)' }}>Facts</h2>
            {facts.map((f) => (
              <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--ink-muted)' }}>{f.label}</span><span style={{ textAlign: 'right' }}>{f.value}</span>
              </div>
            ))}
          </section>
          <Card title="Recent transfers" padding="none" actions={<Link to={`/inventory/transfers?warehouse_id=${w.id}`}>All</Link>}>
            {transferRows.length === 0 ? <p style={{ padding: 16, margin: 0, color: 'var(--ink-muted)' }}>No transfers yet.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="warehouse-transfers">
                {transferRows.map((t) => (
                  <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
                    <span style={{ display: 'flex', flexDirection: 'column' }}><Link to={`/inventory/transfers/${t.id}`} className="lf-code">{t.number}</Link>
                      <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{t.route} · {t.units} units</span></span>
                    <DocStatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {editing && <WarehouseDialog warehouse={w} onClose={() => { setEditing(false); void q.refetch() }} />}
    </>
  )
}
