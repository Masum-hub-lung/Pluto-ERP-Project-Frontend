import { useNavigate } from 'react-router-dom'
import { usePartyCounts, useParties } from '../../api/parties'
import type { Party } from '../../api/contract.gen'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { countryName, SUPPLIER_COUNTRIES } from '../../lib/countries'
import { initials, termLabel } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { BulkDeactivate } from '../../components/BulkDeactivate'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SelectableTable } from '../../components/SelectableTable'
import { SummaryTile } from '../../components/SummaryTile'

/** C1 Supplier list (Supp-List.dc.html; pattern B1): header, summary tile, toolbar, table, pagination (P2.2-FE-02). */
const STATUS = [{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'balance', label: 'With balance' }, { value: 'inactive', label: 'Inactive' }]
const SORTS = [{ value: '-balance', label: 'Sort: payable, high to low' }, { value: 'name', label: 'Sort: name, A to Z' }, { value: '-created_at', label: 'Sort: recently added' }]
const COUNTRIES = [{ value: '', label: 'All countries' }, ...SUPPLIER_COUNTRIES.map((c) => ({ value: c, label: countryName(c) }))]
const PER_PAGE = 25

export function SupplierList() {
  const { PageHeader, Button, Input, Segmented, Select, DataTable, EmptyState, Badge, IconButton } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  // Filters, sort and page live in the URL (shareable, survive reload); the search box writes q after 300 ms.
  const { get, set, search, setSearch, page } = useListParams()
  const status = get('status', 'all')
  const sort = get('sort', '-balance')
  const country = get('country')
  const q = get('q')

  const list = useParties('supplier', {
    q: q || undefined, sort, page, per_page: PER_PAGE, country_code: country || undefined,
    status: status === 'active' || status === 'inactive' ? status : undefined,
    balance: status === 'balance' ? 'outstanding' : undefined,
  })
  const counts = usePartyCounts('supplier')

  const rows = (list.data?.data ?? []).map((p: Party) => ({
    id: p.id, name: p.name, code: p.code, person: p.contact_person ?? '—', phone: p.mobile ?? '—',
    place: p.country_code && p.country_code !== 'BD' ? countryName(p.country_code) : p.area || p.district || '—',
    terms: termLabel(p.payment_term?.name),
    // Payable is the credit side; a debit balance (advance paid to the supplier) shows negative (BR-020, 06 §3).
    bal: p.balance_side === 'dr' && p.balance !== '0.00' ? `-${p.balance}` : p.balance, status: p.status,
  }))
  const columns: DataColumn[] = [
    { key: 'name', label: 'Supplier', render: (_v, r) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 650, fontSize: 12, flex: 'none' }}>{initials(r.name)}</span>
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}</span>
        </span>
      </span>) },
    { key: 'person', label: 'Contact' },
    { key: 'phone', label: 'Mobile', mono: true },
    { key: 'place', label: 'Area / country' },
    { key: 'terms', label: 'Terms' },
    { key: 'bal', label: 'Payable (৳)', type: 'amount' },
    { key: 'status', label: 'Status', render: (v) => <Badge tone={v === 'active' ? 'positive' : 'neutral'} dot>{v === 'active' ? 'Active' : 'Inactive'}</Badge> },
  ]
  const meta = list.data?.meta
  const table = { caption: 'Suppliers', columns, rows, loading: list.isPending, onRowClick: (r: { id: number }) => navigate(`/suppliers/${r.id}`) }
  const filtered = q || status !== 'all' || country
  const empty = filtered
    ? <EmptyState icon="search" title={`No suppliers match${q ? ` “${q}”` : ' these filters'}`} description="Check the spelling, or search by code or mobile number."
        action={<Button variant="secondary" onClick={() => { setSearch(''); set({ q: null, status: null, country: null }) }}>Clear filters</Button>} />
    : <EmptyState icon="truck" title="No suppliers yet" description="Add the businesses you buy from, local or international. Each gets its own ledger under Sundry creditors."
        action={can('parties.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/suppliers/new')}>New supplier</Button> : undefined} />

  return (
    <>
      <PageHeader title="Suppliers" description="Everyone you buy from, with what you owe them today."
        actions={can('parties.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/suppliers/new')} data-testid="new-supplier">New supplier</Button> : undefined} />
      <div className="lf-grid">
        <SummaryTile label="Suppliers" testId="tile-suppliers" value={counts.data?.all ?? '—'}
          sub={counts.data ? `${counts.data.active} active · ${counts.data.inactive} inactive` : undefined} />
      </div>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Suppliers" meta={meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(`/suppliers/${r.id}`), mobileColumns: ['name', 'person', 'phone', 'bal'], badgeKey: 'status', empty }}
        toolbar={<>
          <div style={{ flex: '1 1 280px', maxWidth: 380 }}>
            <Input icon="search" placeholder="Search name, code or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          </div>
          <Segmented key={status} options={STATUS} value={status} onChange={(v) => set({ status: v === 'all' ? null : v })} />
        </>}
        filters={<>
          <div style={{ width: 180 }}>
            <Select options={COUNTRIES} value={country} onChange={(e) => set({ country: e.target.value || null })} aria-label="Country" />
          </div>
          <div style={{ width: 210 }}>
            <Select options={SORTS} value={sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort" />
          </div>
        </>}>
        {can('parties.edit') ? (
          <SelectableTable {...table}
            rowActions={(r) => <IconButton icon="pencil" label={`Edit ${r.name}`} size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/suppliers/${r.id}/edit`) }} />}
            actions={(ids, clear, names) => <BulkDeactivate ids={ids} clear={clear} noun="supplier" names={names} />} />
        ) : <DataTable {...table} />}
      </ListCard>
    </>
  )
}
