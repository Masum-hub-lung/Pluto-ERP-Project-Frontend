import { useNavigate } from 'react-router-dom'
import { useCustomerCounts, useCustomers } from '../../api/parties'
import type { Party } from '../../api/contract.gen'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { initials, termLabel } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { BulkDeactivate } from '../../components/BulkDeactivate'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SelectableTable } from '../../components/SelectableTable'
import { SummaryTile } from '../../components/SummaryTile'

/** B1 Customer list (Parties.dc.html list view): header, summary tile, toolbar, table, pagination. */
const STATUS = [{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'balance', label: 'With balance' }, { value: 'inactive', label: 'Inactive' }]
const SORTS = [{ value: '-balance', label: 'Sort: balance, high to low' }, { value: 'name', label: 'Sort: name, A to Z' }, { value: '-created_at', label: 'Sort: recently added' }]
const PER_PAGE = 25

export function CustomerList() {
  const { PageHeader, Button, Input, Segmented, Select, DataTable, EmptyState, Badge, IconButton } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  // Filters, sort and page live in the URL (shareable, survive reload); the search box writes q after 300 ms.
  const { get, set, search, setSearch, page } = useListParams()
  const status = get('status', 'all')
  const sort = get('sort', '-balance')
  const q = get('q')

  const list = useCustomers({
    q: q || undefined, sort, page, per_page: PER_PAGE,
    status: status === 'active' || status === 'inactive' ? status : undefined,
    balance: status === 'balance' ? 'outstanding' : undefined,
  })
  const counts = useCustomerCounts()

  const rows = (list.data?.data ?? []).map((p: Party) => ({
    id: p.id, name: p.name, code: p.code, person: p.contact_person ?? '—', phone: p.mobile ?? '—', area: p.area || p.district || '—',
    terms: termLabel(p.payment_term?.name), bal: p.balance_side === 'cr' ? `-${p.balance}` : p.balance, status: p.status,
  }))
  const columns: DataColumn[] = [
    { key: 'name', label: 'Customer', render: (_v, r) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--brand-soft)', color: 'var(--brand-ink)', fontWeight: 650, fontSize: 12, flex: 'none' }}>{initials(r.name)}</span>
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}</span>
        </span>
      </span>) },
    { key: 'person', label: 'Contact' },
    { key: 'phone', label: 'Mobile', mono: true },
    { key: 'area', label: 'Area' },
    { key: 'terms', label: 'Terms' },
    { key: 'bal', label: 'Receivable (৳)', type: 'amount' },
    { key: 'status', label: 'Status', render: (v) => <Badge tone={v === 'active' ? 'positive' : 'neutral'} dot>{v === 'active' ? 'Active' : v === 'inactive' ? 'Inactive' : 'Prospect'}</Badge> },
  ]
  const meta = list.data?.meta
  const table = { caption: 'Customers', columns, rows, loading: list.isPending, onRowClick: (r: { id: number }) => navigate(`/customers/${r.id}`) }
  const empty = q || status !== 'all'
    ? <EmptyState icon="search" title={`No customers match${q ? ` “${q}”` : ' these filters'}`} description="Check the spelling, or search by code or mobile number."
        action={<Button variant="secondary" onClick={() => { setSearch(''); set({ q: null, status: null }) }}>Clear search</Button>} />
    : <EmptyState icon="users" title="No customers yet" description="Add the people and businesses you sell to. Each gets its own ledger under Sundry debtors."
        action={can('parties.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/customers/new')}>New customer</Button> : undefined} />

  return (
    <>
      <PageHeader title="Customers" description="Everyone you sell to, with what they owe you today."
        actions={can('parties.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/customers/new')} data-testid="new-customer">New customer</Button> : undefined} />
      <div className="lf-grid">
        <SummaryTile label="Customers" testId="tile-customers" value={counts.data?.all ?? '—'}
          sub={counts.data ? `${counts.data.active} active · ${counts.data.inactive} inactive` : undefined} />
      </div>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Customers" meta={meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(`/customers/${r.id}`), mobileColumns: ['name', 'person', 'phone', 'bal'], badgeKey: 'status', empty }}
        toolbar={<>
          <div style={{ flex: '1 1 280px', maxWidth: 380 }}>
            <Input icon="search" placeholder="Search name, code or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          </div>
          <Segmented key={status} options={STATUS} value={status} onChange={(v) => set({ status: v === 'all' ? null : v })} />
        </>}
        filters={
          <div style={{ width: 210 }}>
            <Select options={SORTS} value={sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort" />
          </div>
        }>
        {can('parties.edit') ? (
          <SelectableTable {...table}
            rowActions={(r) => <IconButton icon="pencil" label={`Edit ${r.name}`} size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/customers/${r.id}/edit`) }} />}
            actions={(ids, clear, names) => <BulkDeactivate ids={ids} clear={clear} noun="customer" names={names} />} />
        ) : <DataTable {...table} />}
      </ListCard>
    </>
  )
}
