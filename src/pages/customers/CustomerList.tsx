import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCustomerCounts, useCustomers } from '../../api/parties'
import type { Party } from '../../api/contract.gen'
import { useSession } from '../../auth/session'
import { lf, type DataColumn } from '../../ds'
import { initials, termLabel } from '../../lib/format'
import { ErrorBanner } from './shared'

/** B1 Customer list (Parties.dc.html list view): header, summary tile, toolbar, table, pagination. */
const STATUS = [{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'balance', label: 'With balance' }, { value: 'inactive', label: 'Inactive' }]
const SORTS = [{ value: '-balance', label: 'Sort: balance, high to low' }, { value: 'name', label: 'Sort: name, A to Z' }, { value: '-created_at', label: 'Sort: recently added' }]
const PER_PAGE = 25

export function CustomerList() {
  const { PageHeader, Button, Input, Segmented, Select, DataTable, Pagination, EmptyState, Badge, IconButton } = lf()
  const { can } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'all'
  const sort = params.get('sort') ?? '-balance'
  const page = Number(params.get('page') ?? '1')
  const [q, setQ] = useState(params.get('q') ?? '')

  // Debounced search; the query string keeps filters shareable and survives reload.
  useEffect(() => {
    const t = setTimeout(() => set({ q: q.trim() || null, page: null }), 300)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  function set(change: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(change)) (v === null ? next.delete(k) : next.set(k, v))
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }

  const list = useCustomers({
    q: params.get('q') ?? undefined, sort, page, per_page: PER_PAGE,
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

  return (
    <>
      <PageHeader title="Customers" description="Everyone you sell to, with what they owe you today."
        actions={can('parties.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/customers/new')} data-testid="new-customer">New customer</Button> : undefined} />
      <div className="lf-grid">
        <div className="lf-c3" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ font: '600 13px/18px var(--font-sans)', color: 'var(--ink-muted)' }}>Customers</span>
          <span className="lf-num" data-testid="tile-customers" style={{ font: '500 26px/32px var(--font-serif)' }}>{counts.data?.all ?? '—'}</span>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{counts.data ? `${counts.data.active} active · ${counts.data.inactive} inactive` : ' '}</span>
        </div>
      </div>
      {list.error ? <ErrorBanner error={list.error} /> : null}
      <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: '1 1 280px', maxWidth: 380 }}>
            <Input icon="search" placeholder="Search name, code or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          <Segmented key={status} options={STATUS} value={status} onChange={(v) => set({ status: v === 'all' ? null : v, page: null })} />
          <span style={{ flex: 1 }} />
          <div style={{ width: 210 }}>
            <Select options={SORTS} value={sort} onChange={(e) => set({ sort: e.target.value, page: null })} aria-label="Sort" />
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <DataTable caption="Customers" columns={columns} rows={rows} loading={list.isPending}
            onRowClick={(r) => navigate(`/customers/${r.id}`)}
            rowActions={can('parties.edit') ? (r) => <IconButton icon="pencil" label={`Edit ${r.name}`} size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/customers/${r.id}/edit`) }} /> : undefined}
            emptyState={params.get('q') || status !== 'all'
              ? <EmptyState icon="search" title={`No customers match${params.get('q') ? ` “${params.get('q')}”` : ' these filters'}`} description="Check the spelling, or search by code or mobile number."
                  action={<Button variant="secondary" onClick={() => { setQ(''); set({ q: null, status: null, page: null }) }}>Clear search</Button>} />
              : <EmptyState icon="users" title="No customers yet" description="Add the people and businesses you sell to. Each gets its own ledger under Sundry debtors."
                  action={can('parties.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/customers/new')}>New customer</Button> : undefined} />} />
        </div>
        {meta && meta.total > 0 && (
          <Pagination key={`${meta.current_page}-${meta.last_page}`} page={meta.current_page} pageCount={meta.last_page} total={meta.total} pageSize={meta.per_page}
            onChange={(p) => set({ page: p === 1 ? null : String(p) })} />
        )}
      </section>
    </>
  )
}
