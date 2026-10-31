import type { PurchaseOrder } from '../../api/contract.gen'
import { openPdf, purchaseOrders } from '../../api/trade'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { DocumentList } from '../../components/trade/DocumentList'
import { DocStatusBadge } from '../../components/trade/TradeParts'
import { shortDate } from './BillList'

/** F11 Purchase orders list (GAP-24; backlog P10.2-FE-02): status tabs (Open = sent or partly received), search, supplier, dates; a row opens F8. */
const TABS = [
  { value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'draft', label: 'Drafts' }, { value: 'partly_received', label: 'Partly received' },
  { value: 'received', label: 'Received' }, { value: 'closed', label: 'Closed' }, { value: 'cancelled', label: 'Cancelled' },
]

export function PurchaseOrderList() {
  const { IconButton } = ds()
  const { can } = useSession()
  const toast = useToast()
  const columns: DataColumn[] = [
    { key: 'number', label: 'Order', mono: true },
    { key: 'date', label: 'Date' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'expected', label: 'Expected' },
    { key: 'status', label: 'Status', render: (v: string) => <DocStatusBadge status={v} /> },
    { key: 'total', label: 'Amount (৳)', type: 'amount' },
  ]
  return (
    <DocumentList<PurchaseOrder> cfg={{
      title: 'Purchase orders', description: 'What you have ordered from suppliers and what is still to arrive.', label: 'Purchase orders',
      partyType: 'supplier', tabs: TABS, searchPlaceholder: 'Search order or supplier', columns, mobileColumns: ['number', 'supplier', 'date', 'total'],
      toRow: (o) => ({ id: o.id, name: o.number, number: o.number, date: shortDate(o.order_date), supplier: o.party.name,
        expected: o.expected_date ? shortDate(o.expected_date) : '', status: o.status, total: o.total }),
      open: (r) => `/purchases/orders/${r.id}`, useList: purchaseOrders.useList,
      newAction: can('purchases.create') ? { label: 'New purchase order', path: '/purchases/orders/new' } : undefined,
      emptyTitle: 'No purchase orders yet', emptyDescription: 'Order goods from a supplier; make the bill from the order when they arrive.',
      rowActions: (r) => (
        <IconButton icon="download" size="sm" label={`PDF of ${String(r.number)}`} onClick={(e: React.MouseEvent) => {
          e.stopPropagation()
          void openPdf(() => purchaseOrders.pdf(r.id), `${String(r.number)}.pdf`, true).catch(() => toast({ tone: 'negative', title: 'Could not download the PDF' }))
        }} />
      ),
    }} />
  )
}
