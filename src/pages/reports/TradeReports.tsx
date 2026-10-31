import { useNavigate } from 'react-router-dom'
import type { ReportData } from '../../api/contract.gen'
import { totalsOf, useReport, type ReportPath } from '../../api/reports'
import { dhakaToday } from '../../api/platform'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ReportLayout } from '../../components/report/ReportLayout'
import { StatementTable } from '../../components/report/StatementTable'
import { SummaryTile } from '../../components/SummaryTile'
import { DocStatusBadge, statusLabel } from '../../components/trade/TradeParts'
import { BranchFilter, ChoiceFilter, DateFilter } from './filters'

/**
 * E11 Sales report, F9 Purchase report (backlog P10.5-FE-01/02; 06 §17): gross, returns, net and share by party,
 * category or month for a date range (default this month), from GET /reports/sales or /reports/purchases. Gross margin
 * shows only when the API includes it (reports.financial, DEC-13). No salesperson grouping (C15).
 * E12 Sales return report, F10 Purchase return report: every return with its document, reason and note, the API's
 * share by reason as bars; a row opens the return.
 */
const monthStart = () => `${dhakaToday().slice(0, 8)}01`

export function TradeReport({ side }: { side: 'sales' | 'purchases' }) {
  const { get, set } = useListParams()
  const sales = side === 'sales'
  const path: ReportPath = sales ? 'sales' : 'purchases'
  const party = sales ? 'customer' : 'supplier'
  const query = { date_from: get('date_from') || monthStart(), date_to: get('date_to') || dhakaToday(), group_by: get('group_by') || party, branch_id: get('branch_id') || undefined }
  const r = useReport(path, query)
  const t = totalsOf<Record<string, string | number>>(r.data)
  const meta = (r.data?.meta ?? {}) as { margin_shown?: boolean }

  return (
    <ReportLayout title={sales ? 'Sales report' : 'Purchase report'}
      description={sales ? 'Gross sales, returns and net sales by customer, category or month.' : 'Purchases, returns and net purchases by supplier, category or month.'}
      path={path} query={query} report={r.data} loading={r.isFetching} error={r.error} onRetry={() => void r.refetch()}
      filters={<>
        <DateFilter id="tr-from" label="From" value={query.date_from} onChange={(v) => set({ date_from: v || null })} />
        <DateFilter id="tr-to" label="To" value={query.date_to} onChange={(v) => set({ date_to: v || null })} />
        <BranchFilter value={query.branch_id ?? ''} onChange={(v) => set({ branch_id: v || null })} />
        <ChoiceFilter label="Group by" value={query.group_by} onChange={(v) => set({ group_by: v === party ? null : v })}
          options={[{ value: party, label: sales ? 'Customer' : 'Supplier' }, { value: 'category', label: 'Category' }, { value: 'month', label: 'Month' }]} />
      </>}>
      {r.data && (
        <>
          <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="trade-tiles">
            <SummaryTile label={sales ? 'Gross sales' : 'Gross purchases'} value={formatTaka(String(t.gross ?? '0'), { symbol: true })} sub={`${t.count ?? 0} ${sales ? 'invoices' : 'bills'}`} testId="tile-gross" />
            <SummaryTile label="Returns and notes" value={formatTaka(String(t.returns ?? '0'), { symbol: true })} testId="tile-returns" />
            <SummaryTile label={sales ? 'Net sales' : 'Net purchases'} value={formatTaka(String(t.net ?? '0'), { symbol: true })} testId="tile-net" />
            {meta.margin_shown && <SummaryTile label="Gross margin" value={formatTaka(String(t.margin ?? '0'), { symbol: true })} sub={`${t.margin_pct ?? '0.0'} % of net sales`} testId="tile-margin" />}
          </div>
          <StatementTable report={r.data} testId="trade-report" cell={(c, row) => (c.key === 'share' ? `${String(row.share)} %` : undefined)} />
        </>
      )}
    </ReportLayout>
  )
}

export function ReturnReport({ side }: { side: 'sales' | 'purchases' }) {
  const { Badge } = ds()
  const navigate = useNavigate()
  const { get, set } = useListParams()
  const sales = side === 'sales'
  const path: ReportPath = sales ? 'sales-returns' : 'purchase-returns'
  const reasons = sales ? ['leaking', 'damaged_in_transit', 'expired', 'wrong_item', 'not_needed'] : ['leaking', 'broken', 'short_supply', 'stale_stock', 'torn_packs', 'quality_claim']
  const query = { date_from: get('date_from') || monthStart(), date_to: get('date_to') || dhakaToday(), reason: get('reason') || undefined }
  const r = useReport(path, query)
  const t = totalsOf<Record<string, string | number>>(r.data)
  const byReason = ((r.data?.meta ?? {}) as { by_reason?: { reason: string; value: string; share: string }[] }).by_reason ?? []

  return (
    <ReportLayout title={sales ? 'Sales return report' : 'Purchase return report'}
      description={sales ? 'Every return from customers and the credit note that settled it.' : 'Every return to suppliers and its debit note.'}
      path={path} query={query} report={r.data} loading={r.isFetching} error={r.error} onRetry={() => void r.refetch()}
      filters={<>
        <DateFilter id="rr-from" label="From" value={query.date_from} onChange={(v) => set({ date_from: v || null })} />
        <DateFilter id="rr-to" label="To" value={query.date_to} onChange={(v) => set({ date_to: v || null })} />
        <ChoiceFilter label="Reason" value={query.reason ?? ''} onChange={(v) => set({ reason: v || null })}
          options={[{ value: '', label: 'All reasons' }, ...reasons.map((x) => ({ value: x, label: statusLabel(x) }))]} />
      </>}
      aside={byReason.length > 0 ? <ReasonBars rows={byReason} /> : undefined}>
      {r.data && (
        <>
          <div className="lf-grid" style={{ marginBottom: 16 }}>
            <SummaryTile label="Returns" value={String(t.count ?? 0)} testId="tile-count" />
            <SummaryTile label="Value" value={formatTaka(String(t.value ?? '0'), { symbol: true })} testId="tile-value" />
            <SummaryTile label="Top reason" value={byReason[0] ? statusLabel(byReason[0].reason) : '—'} sub={byReason[0] ? `${byReason[0].share} % of the value` : undefined} />
          </div>
          <StatementTable report={r.data as ReportData} testId="return-report" cell={(c, row) => {
            if (c.key === 'status') return <DocStatusBadge status={String(row.status)} />
            if (c.key === 'reason') return row.reason === 'mixed' ? <Badge tone="neutral">Mixed</Badge> : statusLabel(String(row.reason))
            if (c.key === 'number') return <a href="#" onClick={(e) => { e.preventDefault(); navigate(`${sales ? '/sales/returns' : '/purchases/returns'}/${String(row.return_id)}`) }}>{String(row.number)}</a>
            return undefined
          }} />
        </>
      )}
    </ReportLayout>
  )
}

/** "By reason" bars: each reason's share of the posted return value, as the API computed it. */
function ReasonBars({ rows }: { rows: { reason: string; value: string; share: string }[] }) {
  return (
    <section aria-label="By reason" data-testid="by-reason">
      <h3 style={{ font: '600 14px/20px var(--font-sans)', margin: '0 0 8px' }}>By reason</h3>
      {rows.map((r) => (
        <div key={r.reason} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{statusLabel(r.reason)}</span><span className="lf-num">{formatTaka(r.value)}</span></div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-sunken)' }}>
            <div style={{ width: `${Math.min(100, Number(r.share))}%`, height: 6, borderRadius: 3, background: 'var(--accent, var(--ink))' }} />
          </div>
        </div>
      ))}
    </section>
  )
}
