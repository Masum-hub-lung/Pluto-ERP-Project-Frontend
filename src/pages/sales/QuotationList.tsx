import type { Quotation } from '../../api/contract.gen'
import { openPdf, quotations } from '../../api/trade'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { DocumentList } from '../../components/trade/DocumentList'
import { DocStatusBadge } from '../../components/trade/TradeParts'
import { shortDate } from '../purchases/BillList'

/**
 * E13 Quotation list (GAP-24; backlog P10.1-FE-02): status tabs, search, customer and dates; a row opens E10, where it is
 * sent, marked accepted / declined / expired, converted or deleted; the row action opens the PDF.
 */
const TABS = [
  { value: 'all', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'sent', label: 'Sent' }, { value: 'accepted', label: 'Accepted' },
  { value: 'converted', label: 'Converted' }, { value: 'declined', label: 'Declined' }, { value: 'expired', label: 'Expired' },
]

export function QuotationList() {
  const { IconButton } = ds()
  const { can } = useSession()
  const toast = useToast()
  const columns: DataColumn[] = [
    { key: 'number', label: 'Quotation', mono: true },
    { key: 'date', label: 'Date' },
    { key: 'customer', label: 'Customer or prospect' },
    { key: 'valid', label: 'Valid until' },
    { key: 'status', label: 'Status', render: (v: string) => <DocStatusBadge status={v} /> },
    { key: 'total', label: 'Amount (৳)', type: 'amount' },
  ]
  return (
    <DocumentList<Quotation> cfg={{
      title: 'Quotations', description: 'Offers to customers and prospects. Nothing posts until one becomes an invoice.', label: 'Quotations',
      partyType: 'customer', tabs: TABS, searchPlaceholder: 'Search quotation or customer', columns, mobileColumns: ['number', 'customer', 'date', 'total'],
      toRow: (q) => ({ id: q.id, name: q.number, number: q.number, date: shortDate(q.quotation_date), customer: q.party.name, valid: shortDate(q.valid_until), status: q.status, total: q.total }),
      open: (r) => `/sales/quotations/${r.id}`, useList: quotations.useList,
      newAction: can('sales.create') ? { label: 'New quotation', path: '/sales/quotations/new' } : undefined,
      emptyTitle: 'No quotations yet', emptyDescription: 'Send a customer or prospect an offer; convert it to an invoice when they accept.',
      rowActions: (r) => (
        <IconButton icon="download" size="sm" label={`PDF of ${String(r.number)}`} onClick={(e: React.MouseEvent) => {
          e.stopPropagation()
          void openPdf(() => quotations.pdf(r.id), `${String(r.number)}.pdf`, true).catch(() => toast({ tone: 'negative', title: 'Could not download the PDF' }))
        }} />
      ),
    }} />
  )
}
