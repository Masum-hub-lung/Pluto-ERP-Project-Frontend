import { useNavigate } from 'react-router-dom'
import type { Ledger } from '../../api/contract.gen'
import { useLedgerList } from '../../api/accounting'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { DrCr, NATURES, natureLabel } from './common'

/**
 * H6 Ledger list (Acc-Ledgers.dc.html; backlog P7.2-FE-03): every posting ledger with its group, nature and balance
 * from GET /ledgers; nature tabs, search, kind and status filters in the URL. Party, bank, cash and inventory ledgers
 * show with their kind filter (they are kept with their customer, account or warehouse).
 */
const KINDS = [{ value: '', label: 'General ledgers' }, { value: 'party', label: 'Customers and suppliers' }, { value: 'bank', label: 'Bank' }, { value: 'cash', label: 'Cash' },
  { value: 'inventory', label: 'Inventory' }, { value: 'tax', label: 'Tax' }, { value: 'system', label: 'System' }]

export function LedgerList() {
  const { PageHeader, Button, Input, Select, DataTable, EmptyState, Segmented, Badge } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const { get, set, search, setSearch, page } = useListParams()
  const nature = get('nature'), kind = get('kind'), active = get('active', 'true'), sort = get('sort', 'code'), q = get('q')
  const list = useLedgerList({ q: q || undefined, nature: nature || undefined, kind: kind || undefined, active, sort, page, per_page: 50 })
  const rows = (list.data?.data ?? []).map((l: Ledger) => ({ id: l.id, code: l.code, name: l.name, group: l.group_path.join(' › '), nature: natureLabel(l.nature),
    balance: l.balance ?? '0.00', side: l.balance_side ?? 'dr', active: l.is_active, status: l.is_active ? 'active' : 'inactive' }))
  const columns: DataColumn[] = [
    { key: 'code', label: 'Code', mono: true },
    { key: 'name', label: 'Ledger', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.name} {!r.active && <Badge tone="neutral">Inactive</Badge>}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.group}</span>
      </span>) },
    { key: 'nature', label: 'Nature' },
    { key: 'balance', label: 'Balance (৳)', align: 'right', render: (_v, r) => <DrCr amount={r.balance} side={r.side} /> },
  ]
  const filtered = !!(q || nature || kind || active !== 'true')
  const add = can('accounting.create') ? () => navigate('/accounting/ledgers/new') : undefined
  const empty = filtered
    ? <EmptyState icon="search" title="No ledgers match" action={<Button variant="secondary" onClick={() => { setSearch(''); set({ q: null, nature: null, kind: null, active: null }) }}>Clear filters</Button>} />
    : <EmptyState icon="book-open-text" title="No ledgers yet" action={add ? <Button variant="primary" icon="plus" onClick={add}>New ledger</Button> : undefined} />

  return (
    <>
      <PageHeader eyebrow="Accounting" title="Ledgers" description="Every account in the books with its balance."
        actions={add ? <Button variant="primary" icon="plus" onClick={add} data-testid="new-ledger">New ledger</Button> : undefined} />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <Segmented options={[{ value: '', label: 'All' }, ...NATURES.map((n) => ({ value: n, label: natureLabel(n) }))]} value={nature} onChange={(v) => set({ nature: v || null })} />
      </div>
      <ListCard label="Ledgers" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(`/accounting/ledgers/${r.id}`), mobileColumns: ['code', 'name', 'balance'], badgeKey: 'status', empty }}
        toolbar={<>
          <div style={{ flex: '1 1 240px', maxWidth: 340 }}><Input icon="search" placeholder="Search code or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search ledgers" /></div>
          <div style={{ width: 220 }}><Select aria-label="Kind" value={kind} onChange={(e) => set({ kind: e.target.value || null })} options={KINDS} /></div>
        </>}
        filters={<>
          <div style={{ width: 180 }}><Select aria-label="Status" value={active} onChange={(e) => set({ active: e.target.value === 'true' ? null : e.target.value })}
            options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }, { value: 'all', label: 'All' }]} /></div>
          <div style={{ width: 200 }}><Select aria-label="Sort" value={sort} onChange={(e) => set({ sort: e.target.value })}
            options={[{ value: 'code', label: 'Sort: code' }, { value: 'name', label: 'Sort: name' }, { value: '-code', label: 'Sort: code, last first' }]} /></div>
        </>}>
        <DataTable caption="Ledgers" columns={columns} rows={rows} loading={list.isPending} onRowClick={(r: { id: number }) => navigate(`/accounting/ledgers/${r.id}`)} />
      </ListCard>
    </>
  )
}
