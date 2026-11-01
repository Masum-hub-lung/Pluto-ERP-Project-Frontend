import { useNavigate } from 'react-router-dom'
import { SEARCH_TYPES, useSearch } from '../../api/dashboard'
import { ds } from '../../ds'
import { useListParams } from '../../lib/useListParams'
import { ProblemBanner } from '../../components/ProblemBanner'

/**
 * L1 Global search results (States.dc.html L1; FR-012; backlog P14.2-FE-04): /search?q=…&type=…. Results grouped by
 * type with type tabs and counts; only the types this user may view come back (the API filters them). "All" shows the
 * first 5 of each type, a type tab the first 20. A hit opens its record.
 */
export function SearchResults() {
  const { PageHeader, Input, Tabs, Card, EmptyState, Badge, Icon, Skeleton, Button } = ds()
  const navigate = useNavigate()
  const { get, set, search, setSearch } = useListParams()
  const q = get('q')
  const type = get('type')
  const all = useSearch(q, { limit: 5 })
  const one = useSearch(type ? q : '', { type: type || undefined, limit: 20 })
  const groups = (type ? one.data?.groups : all.data?.groups) ?? []
  const counts = all.data?.groups ?? []
  const total = counts.reduce((n, g) => n + g.count, 0)
  const loading = q.trim().length >= 2 && (type ? one.isPending : all.isPending)
  const short = q.trim().length < 2

  return (
    <>
      <PageHeader title="Search" description={short ? 'Find any customer, supplier, document, voucher, ledger or product.' : `Results for “${q}”`} />
      <div style={{ maxWidth: 560, marginBottom: 16 }}>
        <Input icon="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice number, name, amount…" aria-label="Search" autoFocus
          data-testid="search-input" />
      </div>
      {!short && counts.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 16 }} data-testid="search-tabs">
          <Tabs key={type || 'all'} value={type || 'all'} onChange={(v) => set({ type: v === 'all' ? null : v })}
            items={[{ value: 'all', label: 'All', count: total }, ...counts.map((g) => ({ value: g.type, label: SEARCH_TYPES[g.type]?.label ?? g.type, count: g.count }))]} />
        </div>
      )}
      <ProblemBanner error={type ? one.error : all.error} onRetry={() => void (type ? one.refetch() : all.refetch())} />
      {short && <EmptyState icon="search" title="Type at least 2 characters" description="Numbers find documents and vouchers, amounts match totals exactly, names match from the start of any word. Press Ctrl K anywhere to search." />}
      {loading && <Skeleton height={160} />}
      {!short && !loading && total === 0 && (
        <EmptyState icon="search" title={`No matches for “${q}”`} description="Check the spelling, try the number's last digits, or search an exact amount."
          action={<Button variant="secondary" onClick={() => { setSearch(''); set({ q: null, type: null }) }}>Clear search</Button>} />
      )}
      {!short && !loading && groups.filter((g) => g.count > 0).map((g) => (
        <div key={g.type} style={{ marginBottom: 16 }} data-testid={`results-${g.type}`}>
          <Card title={`${SEARCH_TYPES[g.type]?.label ?? g.type} · ${g.count}`} padding="none"
            actions={!type && g.count > g.items.length ? <Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => set({ type: g.type })}>All {g.count}</Button> : undefined}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {g.items.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => navigate(h.url)} data-testid={`hit-${g.type}-${h.id}`}
                    style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: '12px 16px', border: 0, borderTop: '1px solid var(--line)', background: 'none',
                      textAlign: 'left', font: 'inherit', color: 'var(--ink)', cursor: 'pointer', minHeight: 44 }}>
                    <Icon name={SEARCH_TYPES[g.type]?.icon ?? 'search'} size={18} />
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</strong>
                      {h.subtitle && <span style={{ fontSize: 13, color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.subtitle}</span>}
                    </span>
                    {h.badge && <Badge tone="neutral">{h.badge}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ))}
    </>
  )
}
