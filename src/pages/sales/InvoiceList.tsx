import { useNavigate } from 'react-router-dom'
import { useParty } from '../../api/parties'
import { downloadInvoicePdf, useInvoices, type InvoiceListFilters } from '../../api/sales'
import type { SalesInvoice } from '../../api/contract.gen'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { ListCard } from '../../components/ListCard'
import { PartyPicker } from '../../components/pickers/PartyPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SelectableTable } from '../../components/SelectableTable'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { shortDate } from '../purchases/BillList'
import { BulkPostInvoices } from './BulkPostInvoices'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'

/**
 * E2 Sales invoice list (Trade.dc.html E2; backlog P5.2-FE-02): status tabs, search, customer and date filters — all in
 * the URL — then the invoices with amount and balance from the API; a row opens E5, the row action downloads the PDF.
 * On the Drafts tab drafts can be selected and posted together (bulk post, per-item results). The list endpoint has
 * no counts, so the tabs show none.
 */
const TABS = [
  { value: 'all', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'part_paid', label: 'Part paid' },
  { value: 'overdue', label: 'Overdue' }, { value: 'paid', label: 'Paid' }, { value: 'cancelled', label: 'Cancelled' },
]
const TAB_FILTERS: Record<string, InvoiceListFilters> = {
  draft: { status: 'draft' }, unpaid: { status: 'posted', payment_status: 'unpaid' }, part_paid: { status: 'posted', payment_status: 'part_paid' },
  overdue: { status: 'posted', overdue: 'true' }, paid: { status: 'posted', payment_status: 'paid' }, cancelled: { status: 'cancelled' },
}
const SORTS = [
  { value: '-invoice_date', label: 'Sort: newest first' }, { value: 'invoice_date', label: 'Sort: oldest first' }, { value: 'due_date', label: 'Sort: due soonest' },
  { value: '-total', label: 'Sort: amount, high to low' }, { value: '-balance_due', label: 'Sort: balance, high to low' },
]
const PER_PAGE = 25

export function InvoiceList() {
  const { PageHeader, Button, IconButton, Input, Tabs, Select, DataTable, EmptyState, Field } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const { get, set, search, setSearch, page } = useListParams()
  const tab = get('tab', 'all')
  const sort = get('sort', '-invoice_date')
  const q = get('q')
  const partyId = Number(get('party_id')) || 0
  const from = get('date_from'), to = get('date_to')
  const customer = useParty(partyId)

  const list = useInvoices({
    ...(TAB_FILTERS[tab] ?? {}), q: q || undefined, party_id: partyId || undefined, date_from: from || undefined, date_to: to || undefined,
    sort, page, per_page: PER_PAGE,
  })

  const rows = (list.data?.data ?? []).map((i: SalesInvoice) => ({
    id: i.id, name: i.number, number: i.number, date: shortDate(i.invoice_date), customer: i.party.name, code: i.party.code,
    due: shortDate(i.due_date), status: i.status, invoice: i, total: i.total, balance: i.status === 'posted' ? i.balance_due : '', // empty, not 0.00: a draft or cancelled document owes nothing yet
  }))
  const columns: DataColumn[] = [
    { key: 'number', label: 'Invoice', mono: true },
    { key: 'date', label: 'Date' },
    { key: 'customer', label: 'Customer', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.customer}</span>
        <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}</span>
      </span>) },
    { key: 'due', label: 'Due' },
    { key: 'status', label: 'Status', render: (_v, r) => <InvoiceStatusBadge invoice={r.invoice} /> },
    { key: 'total', label: 'Amount (৳)', type: 'amount' },
    { key: 'balance', label: 'Balance (৳)', align: 'right', render: (v: string) => (v ? <span className="lf-num">{formatTaka(v)}</span> : '') }, // drafts: blank, not 0.00
  ]
  const pdf = (r: { id: number; number: string }) => downloadInvoicePdf(r.id, r.number)
    .catch(() => toast({ tone: 'negative', title: `Could not download ${r.number}`, description: 'Try again in a moment.' }))
  const filtered = !!(q || tab !== 'all' || partyId || from || to)
  const clear = () => { setSearch(''); set({ q: null, tab: null, party_id: null, date_from: null, date_to: null }) }
  const newInvoice = can('sales.create') ? () => navigate('/sales/invoices/new') : undefined
  const empty = filtered
    ? <EmptyState icon="search" title={`No invoices match${q ? ` “${q}”` : ' these filters'}`} description="Check the spelling, or search by invoice number, customer or PO."
        action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
    : <EmptyState icon="receipt-text" title="No sales invoices yet" description="Bill a customer for goods or services. Stock goes out and the customer owes you when you post it."
        action={newInvoice ? <Button variant="primary" icon="plus" onClick={newInvoice}>New invoice</Button> : undefined} />
  const table = {
    caption: 'Sales invoices', columns, rows, loading: list.isPending, emptyState: empty,
    onRowClick: (r: { id: number }) => navigate(`/sales/invoices/${r.id}`),
    rowActions: (r: { id: number; number: string }) => (
      <IconButton icon="download" label={`Download PDF of ${r.number}`} size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); void pdf(r) }} />
    ),
  }

  return (
    <>
      <PageHeader title="Sales invoices" description="Every invoice to your customers, with what each still owes."
        actions={newInvoice ? <Button variant="primary" icon="plus" onClick={newInvoice} data-testid="new-invoice">New invoice</Button> : undefined} />
      <div style={{ marginBottom: 12, overflowX: 'auto' }} data-testid="invoice-tabs">
        <Tabs key={tab} items={TABS} value={tab} onChange={(v) => set({ tab: v === 'all' ? null : v })} />
      </div>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Sales invoices" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(`/sales/invoices/${r.id}`), mobileColumns: ['number', 'customer', 'date', 'total'], badgeKey: 'status', empty }}
        toolbar={<>
          <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
            <Input icon="search" placeholder="Search invoice, customer or PO" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          </div>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <PartyPicker type="customer" value={partyId ? customer.data?.party ?? null : null} onChange={(p) => set({ party_id: p ? String(p.id) : null })} aria-label="Customer" />
          </div>
        </>}
        filters={<>
          <Field label="From" htmlFor="inv-from"><Input id="inv-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="inv-to"><Input id="inv-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
          <div style={{ width: 220, alignSelf: 'flex-end' }}>
            <Select options={SORTS} value={sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort" />
          </div>
        </>}>
        {tab === 'draft' && can('sales.create')
          ? <SelectableTable {...table} actions={(ids, clearSel, names) => <BulkPostInvoices ids={ids} clear={clearSel} names={names} />} />
          : <DataTable {...table} />}
      </ListCard>
    </>
  )
}
