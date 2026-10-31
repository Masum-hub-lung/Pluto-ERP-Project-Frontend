import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { StockMovement } from '../../api/contract.gen'
import { useStockMovements } from '../../api/inventory'
import { ds, type DataColumn } from '../../ds'
import { PHONE, useMediaQuery } from '../../lib/useMediaQuery'
import { shortDate } from '../purchases/BillList'
import { WidgetError } from '../../components/WidgetError'
import { MOVEMENT_TYPES, SOURCE_PATH } from './MovementList'

/** Shared parts of the inventory detail pages (D4, D8; backlog P11.2): the header with its actions and the recent movements card. */

export interface HeaderAction { label: string; icon: string; onClick: () => void; primary?: boolean; testId?: string }

/** Title, badges and a line of facts; actions as buttons, or a More menu on phones (CLAUDE.md §5.4). */
export function DetailHeader({ title, badges, facts, actions, testId }: { title: string; badges?: ReactNode; facts?: ReactNode; actions: HeaderAction[]; testId?: string }) {
  const { Button, IconButton, Menu } = ds()
  const phone = useMediaQuery(PHONE)
  const [more, setMore] = useState(false)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px', alignItems: 'flex-end', justifyContent: 'space-between', position: 'relative', paddingRight: phone ? 52 : 0, marginBottom: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <h1 style={{ margin: 0, font: '500 28px/34px var(--font-serif)' }} data-testid={testId}>{title}</h1>
          {badges}
        </div>
        {facts && <span style={{ color: 'var(--ink-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>{facts}</span>}
      </div>
      {phone ? (
        <div style={{ position: 'absolute', top: 0, right: 0 }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setMore(false) }}>
          <IconButton icon="ellipsis" label="More actions" onClick={() => setMore((o) => !o)} />
          {more && <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 200, zIndex: 20 }}
            items={actions.map((a) => ({ icon: a.icon, label: a.label, onClick: a.onClick }))} />}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {actions.map((a) => <Button key={a.label} variant={a.primary ? 'primary' : 'secondary'} icon={a.icon} onClick={a.onClick} data-testid={a.testId}>{a.label}</Button>)}
        </div>
      )}
    </div>
  )
}

export const panel = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)' } as const

/** The latest movements of a product or a warehouse, each linking to its document; "All movements" opens D9 filtered. */
export function RecentMovements({ productId, warehouseId, costs }: { productId?: number; warehouseId?: number; costs: boolean }) {
  const { Card, DataTable, EmptyState } = ds()
  const list = useStockMovements({ product_id: productId, warehouse_id: warehouseId, per_page: 10, sort: '-moved_on' })
  const rows = (list.data?.data ?? []).map((m: StockMovement) => ({
    id: m.id, date: shortDate(m.moved_on), item: m.product.name, warehouse: m.warehouse.name, type: MOVEMENT_TYPES[m.movement_type] ?? m.movement_type,
    qin: m.quantity_in === '0.000' ? '' : m.quantity_in, qout: m.quantity_out === '0.000' ? '' : m.quantity_out, after: m.qty_balance_after,
    value: m.value ?? '', m,
  }))
  const columns: DataColumn[] = [
    { key: 'date', label: 'Date' },
    productId ? { key: 'warehouse', label: 'Warehouse' } : { key: 'item', label: 'Item' },
    { key: 'type', label: 'Type' },
    { key: 'qin', label: 'In', mono: true, align: 'right' }, { key: 'qout', label: 'Out', mono: true, align: 'right' },
    { key: 'after', label: 'Balance', mono: true, align: 'right' },
    ...(costs ? [{ key: 'value', label: 'Value (৳)', type: 'amount' as const }] : []),
    { key: 'source', label: 'Document', render: (_v: unknown, r: Record<string, unknown>) => {
      const m = r.m as StockMovement
      const path = SOURCE_PATH[m.source_type]
      return path ? <Link to={path(m.source_id)}>{m.source_number || '—'}</Link> : <span>{m.source_number || '—'}</span>
    } },
  ]
  const all = `/inventory/movements?${productId ? `product_id=${productId}` : `warehouse_id=${warehouseId}`}`
  return (
    <Card title="Recent movements" padding="none" actions={<Link to={all} data-testid="all-movements">All movements</Link>}>
      {list.error ? <WidgetError title="Could not load the movements" onRetry={() => void list.refetch()} /> : (
        <div style={{ overflowX: 'auto' }}>
          <DataTable caption="Recent movements" columns={columns} rows={rows} loading={list.isPending}
            emptyState={<EmptyState icon="history" title="No movements yet" description="Bills, invoices, returns, adjustments and transfers appear here." />} />
        </div>
      )}
    </Card>
  )
}
