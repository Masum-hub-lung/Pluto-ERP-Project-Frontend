import { Link } from 'react-router-dom'
import { useProduct, useStockMovements, useWarehouses } from '../../api/inventory'
import type { Product, StockMovement } from '../../api/contract.gen'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../../components/ListCard'
import { ProductPicker } from '../../components/pickers/ProductPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { shortDate } from '../purchases/BillList'

/**
 * D9 Stock movement history (Inv-Movements.dc.html; backlog P4.5-FE-05): every quantity change, newest first, filtered
 * by item, warehouse, type and dates (all in the URL, so the product list's "Movements" action deep-links with
 * ?product_id=). Cost and value show only with inventory.view_costs (the API omits them otherwise). The source
 * document links to its page where one is built.
 */
const TYPES: Record<string, string> = {
  opening: 'Opening stock', purchase_in: 'Purchase', sale_out: 'Sale', sales_return_in: 'Sales return', purchase_return_out: 'Purchase return',
  adjustment_in: 'Adjustment in', adjustment_out: 'Adjustment out', transfer_out: 'Transfer out', transfer_in: 'Transfer in', landed_cost: 'Landed cost', reversal: 'Reversal',
}
const SOURCE_PATH: Record<string, (id: number) => string> = { purchase_bills: (id) => `/purchases/bills/${id}` }
const PER_PAGE = 50

export function MovementList() {
  const { PageHeader, Select, Input, Field, DataTable, EmptyState, Button } = ds()
  const { can } = useSession()
  const { get, set, page } = useListParams()
  const productId = Number(get('product_id')) || 0
  const warehouseId = Number(get('warehouse_id')) || 0
  const type = get('movement_type'), from = get('date_from'), to = get('date_to'), sort = get('sort', '-moved_on')
  const product = useProduct(productId)
  const warehouses = useWarehouses()
  const costs = can('inventory.view_costs')

  const list = useStockMovements({
    product_id: productId || undefined, warehouse_id: warehouseId || undefined, movement_type: type || undefined,
    date_from: from || undefined, date_to: to || undefined, sort, page, per_page: PER_PAGE,
  })
  const rows = (list.data?.data ?? []).map((m: StockMovement) => ({
    id: m.id, date: shortDate(m.moved_on), product: m.product.name, warehouse: m.warehouse.name, type: TYPES[m.movement_type] ?? m.movement_type,
    qin: m.quantity_in === '0.000' ? '' : m.quantity_in, qout: m.quantity_out === '0.000' ? '' : m.quantity_out, after: m.qty_balance_after,
    cost: m.unit_cost ?? '', value: m.value ?? '', m,
  }))
  const columns: DataColumn[] = [
    { key: 'date', label: 'Date' },
    { key: 'product', label: 'Item', render: (v) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'type', label: 'Type' },
    { key: 'qin', label: 'In', mono: true, align: 'right' },
    { key: 'qout', label: 'Out', mono: true, align: 'right' },
    { key: 'after', label: 'Balance', mono: true, align: 'right' },
    ...(costs ? [{ key: 'cost', label: 'Cost (৳)', type: 'amount' as const }, { key: 'value', label: 'Value (৳)', type: 'amount' as const }] : []),
    { key: 'source', label: 'Document', render: (_v, r) => {
      const m = r.m as StockMovement
      const path = SOURCE_PATH[m.source_type]
      return path ? <Link to={path(m.source_id)} onClick={(e) => e.stopPropagation()} data-testid={`source-${m.id}`}>{m.source_number}</Link> : <span className="lf-code">{m.source_number}</span>
    } },
  ]
  const filtered = !!(productId || warehouseId || type || from || to)
  const empty = filtered
    ? <EmptyState icon="search" title="No movements match these filters" description="Try another item, warehouse or date range."
        action={<Button variant="secondary" onClick={() => set({ product_id: null, warehouse_id: null, movement_type: null, date_from: null, date_to: null })}>Clear filters</Button>} />
    : <EmptyState icon="package" title="No stock movements yet" description="Posting a purchase bill, an invoice or an adjustment records its quantities here." />

  return (
    <>
      <PageHeader title="Stock movements" description="Every quantity change from bills, invoices, transfers, returns and adjustments." />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Stock movements" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, mobileColumns: ['product', 'date', 'type', 'qin', 'qout', 'source'], empty }}
        toolbar={<>
          <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
            <ProductPicker value={productId ? (product.data?.product ?? null) as Product | null : null} onChange={(p) => set({ product_id: p ? String(p.id) : null })} aria-label="Item" />
          </div>
          <div style={{ width: 200 }}>
            <Select aria-label="Warehouse" value={warehouseId ? String(warehouseId) : ''} onChange={(e) => set({ warehouse_id: e.target.value || null })}
              options={[{ value: '', label: 'All warehouses' }, ...(warehouses.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))]} />
          </div>
          <div style={{ width: 190 }}>
            <Select aria-label="Type" value={type} onChange={(e) => set({ movement_type: e.target.value || null })}
              options={[{ value: '', label: 'All types' }, ...Object.entries(TYPES).map(([value, label]) => ({ value, label }))]} />
          </div>
        </>}
        filters={<>
          <Field label="From" htmlFor="mv-from"><Input id="mv-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="mv-to"><Input id="mv-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
          <div style={{ width: 190, alignSelf: 'flex-end' }}>
            <Select aria-label="Sort" value={sort} onChange={(e) => set({ sort: e.target.value })}
              options={[{ value: '-moved_on', label: 'Sort: newest first' }, { value: 'moved_on', label: 'Sort: oldest first' }]} />
          </div>
        </>}>
        <DataTable caption="Stock movements" columns={columns} rows={rows} loading={list.isPending} />
      </ListCard>
    </>
  )
}
