import { useNavigate } from 'react-router-dom'
import { useParty } from '../../api/parties'
import { useBills, type BillListFilters } from '../../api/purchases'
import type { PurchaseBill } from '../../api/contract.gen'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { ListCard } from '../../components/ListCard'
import { PartyPicker } from '../../components/pickers/PartyPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { useListParams } from '../../lib/useListParams'
import { BillStatusBadge } from './BillStatusBadge'

/**
 * F2 Purchase bill list (Pur-List.dc.html): status tabs, search, supplier and date filters — all in the URL — then the
 * bills with amount and balance from the API; a row opens F4. The list endpoint has no counts, so the tabs show none.
 */
const TABS = [
  { value: 'all', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'part_paid', label: 'Part paid' },
  { value: 'overdue', label: 'Overdue' }, { value: 'paid', label: 'Paid' }, { value: 'cancelled', label: 'Cancelled' },
]
const TAB_FILTERS: Record<string, BillListFilters> = {
  draft: { status: 'draft' }, unpaid: { status: 'posted', payment_status: 'unpaid' }, part_paid: { status: 'posted', payment_status: 'part_paid' },
  overdue: { status: 'posted', overdue: 'true' }, paid: { status: 'posted', payment_status: 'paid' }, cancelled: { status: 'cancelled' },
}
const SORTS = [
  { value: '-bill_date', label: 'Sort: newest first' }, { value: 'bill_date', label: 'Sort: oldest first' }, { value: 'due_date', label: 'Sort: due soonest' },
  { value: '-total', label: 'Sort: amount, high to low' }, { value: '-balance_due', label: 'Sort: balance, high to low' },
]
const PER_PAGE = 25

/** 2026-10-24 → 24 Oct 2026 (no time zone shift: the API sends plain dates). */
export function shortDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  return m ? `${Number(m[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}` : d
}

export function BillList() {
  const { PageHeader, Button, Input, Tabs, Select, DataTable, EmptyState, Field } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const { get, set, search, setSearch, page } = useListParams()
  const tab = get('tab', 'all')
  const sort = get('sort', '-bill_date')
  const q = get('q')
  const partyId = Number(get('party_id')) || 0
  const from = get('date_from'), to = get('date_to')
  const supplier = useParty(partyId)

  const list = useBills({
    ...(TAB_FILTERS[tab] ?? {}), q: q || undefined, party_id: partyId || undefined, date_from: from || undefined, date_to: to || undefined,
    sort, page, per_page: PER_PAGE,
  })

  const rows = (list.data?.data ?? []).map((b: PurchaseBill) => ({
    id: b.id, number: b.number, date: shortDate(b.bill_date), supplier: b.party.name, code: b.party.code, ref: b.supplier_bill_no,
    due: shortDate(b.due_date), status: b.status, bill: b, total: b.total, balance: b.status === 'posted' ? b.balance_due : '—',
  }))
  const columns: DataColumn[] = [
    { key: 'number', label: 'Bill', mono: true },
    { key: 'date', label: 'Date' },
    { key: 'supplier', label: 'Supplier', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.supplier}</span>
        <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}</span>
      </span>) },
    { key: 'ref', label: 'Supplier ref', mono: true },
    { key: 'due', label: 'Due' },
    { key: 'status', label: 'Status', render: (_v, r) => <BillStatusBadge bill={r.bill} /> },
    { key: 'total', label: 'Amount (৳)', type: 'amount' },
    { key: 'balance', label: 'Balance (৳)', type: 'amount' },
  ]
  const filtered = !!(q || tab !== 'all' || partyId || from || to)
  const clear = () => { setSearch(''); set({ q: null, tab: null, party_id: null, date_from: null, date_to: null }) }
  const newBill = can('purchases.create') ? () => navigate('/purchases/bills/new') : undefined
  const empty = filtered
    ? <EmptyState icon="search" title={`No bills match${q ? ` “${q}”` : ' these filters'}`} description="Check the spelling, or search by bill number, supplier or reference."
        action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
    : <EmptyState icon="shopping-cart" title="No purchase bills yet" description="Enter a supplier's bill as you receive it. Items go into stock when you post it."
        action={newBill ? <Button variant="primary" icon="plus" onClick={newBill}>New bill</Button> : undefined} />

  return (
    <>
      <PageHeader title="Purchase bills" description="Every bill from your suppliers, with what you still owe on each."
        actions={newBill ? <Button variant="primary" icon="plus" onClick={newBill} data-testid="new-bill">New bill</Button> : undefined} />
      <div style={{ marginBottom: 12, overflowX: 'auto' }} data-testid="bill-tabs">
        <Tabs key={tab} items={TABS} value={tab} onChange={(v) => set({ tab: v === 'all' ? null : v })} />
      </div>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Purchase bills" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(`/purchases/bills/${r.id}`), mobileColumns: ['number', 'supplier', 'date', 'total'], badgeKey: 'status', empty }}
        toolbar={<>
          <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
            <Input icon="search" placeholder="Search bill, supplier or reference" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          </div>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <PartyPicker type="supplier" value={partyId ? supplier.data?.party ?? null : null} onChange={(p) => set({ party_id: p ? String(p.id) : null })} aria-label="Supplier" />
          </div>
        </>}
        filters={<>
          <Field label="From" htmlFor="bills-from"><Input id="bills-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="bills-to"><Input id="bills-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
          <div style={{ width: 220, alignSelf: 'flex-end' }}>
            <Select options={SORTS} value={sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort" />
          </div>
        </>}>
        <DataTable caption="Purchase bills" columns={columns} rows={rows} loading={list.isPending} onRowClick={(r: { id: number }) => navigate(`/purchases/bills/${r.id}`)} />
      </ListCard>
    </>
  )
}
