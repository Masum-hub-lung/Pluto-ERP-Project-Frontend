import type { StockAdjustment, StockTransfer } from '../../api/contract.gen'
import { stockAdjustments, stockTransfers } from '../../api/stock'
import { useSession } from '../../auth/session'
import { DocumentList } from '../../components/trade/DocumentList'
import { DocStatusBadge, statusLabel } from '../../components/trade/TradeParts'
import { formatTaka } from '../../lib/format'
import { shortDate } from '../purchases/BillList'

/**
 * Lists of the stock documents (D10 / D11 lists; backlog P11.2-FE-03/04) on the shared document list: status tabs,
 * search, warehouse and date filters in the URL; a row opens the document. Net value only with inventory.view_costs.
 */
export function AdjustmentList() {
  const { can } = useSession()
  const costs = can('inventory.view_costs')
  return (
    <DocumentList<StockAdjustment> cfg={{
      title: 'Stock adjustments', description: 'Counts, damage, expiry, loss and samples. Posting moves stock and books the value difference.',
      label: 'Stock adjustments', warehouseFilter: true, dateLabels: ['Counted from', 'Counted to'], searchPlaceholder: 'Search number or product',
      tabs: [{ value: 'all', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'posted', label: 'Posted' }, { value: 'reversed', label: 'Reversed' }],
      columns: [
        { key: 'number', label: 'Number', mono: true }, { key: 'date', label: 'Date' }, { key: 'warehouse', label: 'Warehouse' }, { key: 'reason', label: 'Reason' },
        { key: 'lines', label: 'Products', align: 'right' },
        ...(costs ? [{ key: 'value', label: 'Value (৳)', type: 'amount' as const }] : []),
        { key: 'status', label: 'Status', render: (v: unknown) => <DocStatusBadge status={v as string} /> },
      ],
      mobileColumns: ['number', 'warehouse', 'date'],
      toRow: (a) => ({ id: a.id, number: a.number, date: shortDate(a.adjustment_date), warehouse: a.warehouse_name ?? '', reason: statusLabel(a.reason),
        lines: a.line_count ?? 0, value: a.net_value ? formatTaka(a.net_value) : '', status: a.status }),
      open: (r) => `/inventory/adjustments/${r.id}`,
      useList: (f) => stockAdjustments.useList(f),
      newAction: can('inventory.create') ? { label: 'New adjustment', path: '/inventory/adjustments/new' } : undefined,
      emptyTitle: 'No stock adjustments yet', emptyDescription: 'Count a warehouse, or write off damaged and expired stock.',
    }} />
  )
}

export function TransferList() {
  const { can } = useSession()
  return (
    <DocumentList<StockTransfer> cfg={{
      title: 'Stock transfers', description: 'Stock moving between warehouses: sent, then received at the other end.',
      label: 'Stock transfers', warehouseFilter: true, dateLabels: ['Sent from', 'Sent to'], searchPlaceholder: 'Search number or product',
      tabs: [{ value: 'all', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'dispatched', label: 'On the way' }, { value: 'received', label: 'Received' },
        { value: 'cancelled', label: 'Cancelled' }],
      columns: [
        { key: 'number', label: 'Number', mono: true }, { key: 'route', label: 'From → to' }, { key: 'date', label: 'Sent' },
        { key: 'units', label: 'Units', mono: true, align: 'right' },
        { key: 'status', label: 'Status', render: (v: unknown) => <DocStatusBadge status={v as string} /> },
      ],
      mobileColumns: ['number', 'route', 'units'],
      toRow: (t) => ({ id: t.id, number: t.number, route: `${t.from_warehouse_name ?? ''} → ${t.to_warehouse_name ?? ''}`, date: t.dispatch_date ? shortDate(t.dispatch_date) : '—',
        units: t.total_units, status: t.status }),
      open: (r) => `/inventory/transfers/${r.id}`,
      useList: (f) => stockTransfers.useList(f),
      newAction: can('inventory.create') ? { label: 'New transfer', path: '/inventory/transfers/new' } : undefined,
      emptyTitle: 'No stock transfers yet', emptyDescription: 'Move stock from one warehouse to another.',
    }} />
  )
}
