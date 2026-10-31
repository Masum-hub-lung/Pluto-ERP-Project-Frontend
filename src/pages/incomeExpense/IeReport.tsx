import { useNavigate } from 'react-router-dom'
import { totalsOf, useReport } from '../../api/reports'
import { dhakaToday } from '../../api/platform'
import { useSession } from '../../auth/session'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ReportLayout } from '../../components/report/ReportLayout'
import { StatementTable } from '../../components/report/StatementTable'
import { SummaryTile } from '../../components/SummaryTile'
import { Forbidden } from '../../components/states'
import { BranchFilter, ChoiceFilter, DateFilter } from '../reports/filters'

/**
 * I8 Income report, I9 Expense report (Inc-Report.dc.html, Exp-Report.dc.html; backlog P13.2-FE-06): each category by
 * month (or quarter) with its total and share, for a date range (the financial year to date by default) and branch,
 * from GET /reports/income or /reports/expenses. Profit-and-loss figures: reports.financial (DEC-13). A row opens the
 * category's lines.
 */
export function IeReport({ kind }: { kind: 'income' | 'expense' }) {
  const { can } = useSession()
  if (!can('reports.financial')) return <Forbidden permission="reports.financial" what={kind === 'income' ? 'the income report' : 'the expense report'} />
  return <Report kind={kind} />
}

function Report({ kind }: { kind: 'income' | 'expense' }) {
  const navigate = useNavigate()
  const { get, set } = useListParams()
  const income = kind === 'income'
  const path = income ? 'income' : 'expenses'
  const query = { date_from: get('date_from') || undefined, date_to: get('date_to') || dhakaToday(), group_by: get('group_by') || 'month', branch_id: get('branch_id') || undefined }
  const r = useReport(path, query)
  const t = totalsOf<Record<string, string | null>>(r.data)
  const meta = (r.data?.meta ?? {}) as { buckets?: { key: string }[]; categories?: number }
  const top = (r.data?.rows ?? [])[0] as { name?: string; total?: string; share?: string } | undefined

  return (
    <ReportLayout title={income ? 'Income report' : 'Expense report'} description={income ? 'Income by category and month.' : 'Expenses by category and month.'}
      path={path} query={query} report={r.data} loading={r.isFetching} error={r.error} onRetry={() => void r.refetch()}
      filters={<>
        <DateFilter id="ier-from" label="From" value={query.date_from ?? ''} onChange={(v) => set({ date_from: v || null })} />
        <DateFilter id="ier-to" label="To" value={query.date_to} onChange={(v) => set({ date_to: v || null })} />
        <BranchFilter value={query.branch_id ?? ''} onChange={(v) => set({ branch_id: v || null })} />
        <ChoiceFilter label="By" value={query.group_by} onChange={(v) => set({ group_by: v === 'month' ? null : v })}
          options={[{ value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }]} />
      </>}>
      {r.data && (
        <>
          <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="ie-report-tiles">
            <SummaryTile label={income ? 'Total income' : 'Total expenses'} value={formatTaka(t.total ?? '0', { symbol: true })} testId="tile-report-total" />
            <SummaryTile label="Categories" value={String(meta.categories ?? 0)} sub={`${meta.buckets?.length ?? 0} ${query.group_by === 'quarter' ? 'quarters' : 'months'}`} />
            {top?.name && <SummaryTile label={income ? 'Largest source' : 'Largest category'} value={top.name} sub={`${formatTaka(top.total ?? '0', { symbol: true })}${top.share ? ` · ${top.share} %` : ''}`} />}
          </div>
          <StatementTable report={r.data} testId="ie-report" cell={(c, row) => (c.key === 'share' ? (row.share ? `${String(row.share)} %` : '—') : undefined)}
            onOpen={(row: Record<string, unknown>) => { if (row.id) navigate(`/${income ? 'income' : 'expenses'}/list?category=${String(row.id)}`) }} />
        </>
      )}
    </ReportLayout>
  )
}
