import { useNavigate } from 'react-router-dom'
import { totalsOf, useReport } from '../../api/reports'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ReportLayout } from '../../components/report/ReportLayout'
import { StatementTable } from '../../components/report/StatementTable'
import { SummaryTile } from '../../components/SummaryTile'
import { DateFilter } from './filters'

/**
 * J6 Receivables aging and J7 Payables aging (backlog P9.2-FE-05; 06 §17): each customer's or supplier's open
 * documents by days past due on "as of" (not due, 1–30, 31–60, 61–90, 90+), the oldest age and advances apart, from
 * GET /reports/receivables-aging or /payables-aging. Tiles show the API's bucket totals; a row opens the party's
 * statement (B8/C8).
 */
const BUCKETS = [['not_due', 'Not due'], ['d1_30', '1–30 days'], ['d31_60', '31–60 days'], ['d61_90', '61–90 days'], ['d90_plus', 'Over 90 days']] as const

export function Aging({ type }: { type: 'customer' | 'supplier' }) {
  const { Badge, Input, Field } = ds()
  const navigate = useNavigate()
  const { get, set, search, setSearch } = useListParams()
  const path = type === 'customer' ? 'receivables-aging' : 'payables-aging'
  const query = { as_of: get('as_of') || undefined, q: get('q') || undefined, overdue_only: get('overdue_only') || undefined }
  const r = useReport(path, query)
  const t = totalsOf<Record<string, string>>(r.data)
  const base = type === 'customer' ? '/customers' : '/suppliers'
  const parties = Number(t.parties ?? 0) // a count of parties, not money

  return (
    <ReportLayout title={type === 'customer' ? 'Receivables aging' : 'Payables aging'}
      description={type === 'customer' ? 'What customers owe by days past due.' : 'What suppliers are owed by days past due.'}
      path={path} query={query} report={r.data} loading={r.isFetching} error={r.error} onRetry={() => void r.refetch()}
      filters={<>
        <DateFilter id="ag-asof" label="As of" value={query.as_of ?? ''} onChange={(v) => set({ as_of: v || null })} />
        <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
          <Field label="Search" htmlFor="ag-q"><Input id="ag-q" icon="search" placeholder={`Search ${type}s`} value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
          <input type="checkbox" checked={query.overdue_only === 'true'} onChange={(e) => set({ overdue_only: e.target.checked ? 'true' : null })} data-testid="overdue-only" />
          Overdue only
        </label>
      </>}>
      {r.data && (
        <>
          <div className="lf-grid" data-testid="aging-tiles" style={{ marginBottom: 16 }}>
            <SummaryTile label="Total" value={formatTaka(t.total, { symbol: true })} sub={`${parties} ${type}${parties === 1 ? '' : 's'}`} testId="aging-total" />
            <SummaryTile label="Overdue" value={formatTaka(t.overdue, { symbol: true })} tone={t.overdue && t.overdue !== '0.00' ? 'negative' : undefined} testId="aging-overdue" />
            {BUCKETS.map(([k, label]) => <SummaryTile key={k} label={label} value={formatTaka(t[k], { symbol: true })} testId={`aging-${k}`} />)}
          </div>
          <StatementTable report={r.data} testId="aging" onOpen={(row) => navigate(`${base}/${row.party_id}/statement`)}
            cell={(c, row) => {
              if (c.key === 'name') return <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}><span style={{ fontWeight: 600 }}>{String(row.name)}</span>
                <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{String(row.code)}</span></span>
              if (c.key === 'oldest_days') {
                const d = row.oldest_days as number | null
                return d === null || d === undefined ? '' : d === 0 ? <Badge tone="positive">Not due</Badge>
                  : <Badge tone={d > 90 ? 'negative' : d > 30 ? 'warning' : 'neutral'}>{d} days</Badge>
              }
              return undefined
            }} />
        </>
      )}
    </ReportLayout>
  )
}
