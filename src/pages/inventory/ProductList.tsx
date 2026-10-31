import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Product } from '../../api/contract.gen'
import { useCategories, useProducts, useWarehouses } from '../../api/inventory'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ImportDialog } from './ImportDialog'

/**
 * D1 Product list (Inventory.dc.html D1; backlog P3.2-FE-05; pattern B1): search, type, category, warehouse and stock
 * filters in the URL; cost and value columns only with inventory.view_costs (BR-052). Quantities stay 0 until purchase
 * bills post (P4). Import arrives with P11.
 */
const TYPES = [{ value: 'all', label: 'All' }, { value: 'product', label: 'Products' }, { value: 'service', label: 'Services' }]
const STOCK = [{ value: 'all', label: 'All' }, { value: 'in_stock', label: 'In stock' }, { value: 'low_stock', label: 'Low' }, { value: 'out_of_stock', label: 'Out' }]
const SORTS = [{ value: 'name', label: 'Sort: name, A to Z' }, { value: 'code', label: 'Sort: code' }, { value: '-on_hand', label: 'Sort: on hand, most first' },
  { value: '-selling_price', label: 'Sort: price, high to low' }]
const STATUS: Record<Product['stock_status'], [string, 'positive' | 'warning' | 'negative' | 'neutral']> = {
  in_stock: ['In stock', 'positive'], low_stock: ['Low stock', 'warning'], out_of_stock: ['Out of stock', 'negative'], not_tracked: ['Service', 'neutral'],
}
const PER_PAGE = 25

export function ProductList() {
  const { PageHeader, Button, Input, Segmented, Select, DataTable, EmptyState, Badge, IconButton } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const { get, set, search, setSearch, page } = useListParams()
  const type = get('type', 'all')
  const stock = get('stock', 'all')
  const category = get('category')
  const warehouse = get('warehouse')
  const sort = get('sort', 'name')
  const q = get('q')
  const costs = can('inventory.view_costs')

  const list = useProducts({
    q: q || undefined, sort, page, per_page: PER_PAGE, item_type: type === 'all' ? undefined : type, stock_status: stock === 'all' ? undefined : stock,
    category_id: category ? Number(category) : undefined, warehouse_id: warehouse ? Number(warehouse) : undefined,
  })
  const categories = useCategories()
  const warehouses = useWarehouses()

  const rows = (list.data?.data ?? []).map((p) => ({
    id: p.id, name: p.name, code: p.code, type: p.item_type === 'service' ? 'Service' : 'Product', category: p.category?.name ?? '—', unit: p.unit,
    cost: p.avg_cost && p.track_stock ? formatTaka(p.avg_cost) : '—', price: p.selling_price, onHand: p.on_hand ?? '—',
    value: p.stock_value && p.track_stock ? formatTaka(p.stock_value) : '—', status: p.stock_status, active: p.is_active,
  }))
  const columns: DataColumn[] = [
    { key: 'name', label: 'Item', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.name}{!r.active && <span style={{ marginLeft: 8 }}><Badge tone="neutral">Inactive</Badge></span>}</span>
        <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}</span>
      </span>) },
    { key: 'type', label: 'Type' },
    { key: 'category', label: 'Category' },
    { key: 'unit', label: 'Unit' },
    ...(costs ? [{ key: 'cost', label: 'Cost (৳)', align: 'right' as const, mono: true }] : []),
    { key: 'price', label: 'Price (৳)', type: 'amount' as const },
    { key: 'onHand', label: 'On hand', align: 'right' as const, mono: true },
    ...(costs ? [{ key: 'value', label: 'Stock value (৳)', align: 'right' as const, mono: true }] : []), // services have none: "—", not 0.00
    { key: 'status', label: 'Stock', render: (v: Product['stock_status']) => <Badge tone={STATUS[v][1]} dot>{STATUS[v][0]}</Badge> },
  ]
  const meta = list.data?.meta
  const [importing, setImporting] = useState(false)
  const filtered = q || type !== 'all' || stock !== 'all' || category || warehouse
  const newButton = (testId: string) => can('inventory.create')
    ? <Button variant="primary" icon="plus" onClick={() => navigate('/inventory/products/new')} data-testid={testId}>New item</Button> : undefined
  const empty = filtered
    ? <EmptyState icon="search" title={`No items match${q ? ` “${q}”` : ' these filters'}`} description="Search by name, code or barcode, or clear the filters."
        action={<Button variant="secondary" onClick={() => { setSearch(''); set({ q: null, type: null, stock: null, category: null, warehouse: null }) }}>Clear filters</Button>} />
    : <EmptyState icon="package" title="No products or services yet" description="Add what you buy and sell. Stock quantities fill in as purchase bills post."
        action={newButton('empty-new-product')} />
  const open = (r: { id: number }) => navigate(`/inventory/products/${r.id}`) // D4 (P11.2-FE-01)
  const edit = can('inventory.edit') ? (r: { id: number }) => navigate(`/inventory/products/${r.id}/edit`) : undefined

  return (
    <>
      <PageHeader title="Products and services" description="Everything you buy and sell, with what is on hand today."
        actions={can('inventory.create') ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" icon="upload" onClick={() => setImporting(true)} data-testid="import-products">Import</Button>{newButton('new-product')}</div> : undefined} />
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Products" meta={meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: open, mobileColumns: ['name', 'category', 'onHand', 'price'], badgeKey: 'status', empty }}
        toolbar={<>
          <div style={{ flex: '1 1 260px', maxWidth: 340 }}>
            <Input icon="search" placeholder="Search name, code or barcode" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          </div>
          <Segmented key={`t-${type}`} options={TYPES} value={type} onChange={(v) => set({ type: v === 'all' ? null : v })} />
          <Segmented key={`s-${stock}`} options={STOCK} value={stock} onChange={(v) => set({ stock: v === 'all' ? null : v })} />
        </>}
        filters={<>
          <div style={{ width: 190 }}>
            <Select aria-label="Category" value={category} onChange={(e) => set({ category: e.target.value || null })}
              options={[{ value: '', label: 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: String(c.id), label: c.parent_id ? `— ${c.name}` : c.name }))]} />
          </div>
          <div style={{ width: 190 }}>
            <Select aria-label="Warehouse" value={warehouse} onChange={(e) => set({ warehouse: e.target.value || null })}
              options={[{ value: '', label: 'All warehouses' }, ...(warehouses.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))]} />
          </div>
          <div style={{ width: 210 }}>
            <Select aria-label="Sort" value={sort} onChange={(e) => set({ sort: e.target.value })} options={SORTS} />
          </div>
        </>}>
        <DataTable caption="Products" columns={columns} rows={rows} loading={list.isPending} onRowClick={open}
          rowActions={(r) => <>
            <IconButton icon="history" label={`Movements of ${r.name}`} size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/inventory/movements?product_id=${r.id}`) }} />
            {edit && <IconButton icon="pencil" label={`Edit ${r.name}`} size="sm" onClick={(e) => { e.stopPropagation(); edit(r) }} />}
          </>} />
      </ListCard>
    </>
  )
}
