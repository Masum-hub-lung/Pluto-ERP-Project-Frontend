import { useNavigate } from 'react-router-dom'
import { useIeOverview, type IeKind, type IeOverviewMeta, type IePeriod } from '../../api/incomeExpense'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { compareDecimal } from '../../lib/decimal'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { WidgetError } from '../../components/WidgetError'
import { shortDate } from '../purchases/BillList'

/**
 * I1 Income overview, I4 Expense overview (Inc-Overview.dc.html, IncExp.dc.html; backlog P13.2-FE-04): tiles (total,
 * this month, budget used, missing receipts), by category with share, the last 12 months (expenses: against the
 * monthly budget line), and the latest entries — every figure from GET /income-expenses/overview. Bar heights are
 * drawn from the API's amounts; the amounts shown are the API's strings.
 */
const PERIODS: { value: IePeriod; label: string }[] = [
  { value: 'this_month', label: 'This month' }, { value: 'last_month', label: 'Last month' }, { value: 'this_quarter', label: 'This quarter' }, { value: 'this_year', label: 'Financial year to date' },
]

interface CategoryRow { id: number; name: string; ledger_code: string; value: string; share: string | null; budget: string | null; used_pct: string | null; status: string }

export function IeOverview({ kind }: { kind: IeKind }) {
  const { PageHeader, Segmented, Card, Button, DataTable, EmptyState, Skeleton, Badge } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const { get, set } = useListParams()
  const income = kind === 'income'
  const base = income ? '/income' : '/expenses'
  const period = (get('period') || 'this_year') as IePeriod
  const o = useIeOverview(kind, period)
  const t = (o.data?.totals ?? {}) as Record<string, string | number | null>
  const meta = (o.data?.meta ?? null) as IeOverviewMeta | null
  const rows = (o.data?.rows ?? []) as unknown as CategoryRow[]
  const heights = (meta?.months ?? []).map((m) => Number(m.value)) // drawing only
  const budgetLine = meta?.months.find((m) => m.budget)?.budget ?? null
  const max = Math.max(1, ...heights, budgetLine ? Number(budgetLine) : 0)
  const noun = income ? 'Income' : 'Expenses'

  return (
    <>
      <PageHeader title={income ? 'Income overview' : 'Expense overview'}
        description={income ? 'Other income by category and month, and the latest entries.' : 'Spending by category, by month against the budget, and receipts still missing.'}
        actions={<>
          {can('reports.financial') && <Button variant="secondary" icon="file-bar-chart" onClick={() => navigate(`${base}/report`)}>{income ? 'Income report' : 'Expense report'}</Button>}
          {can('banking.create') && <Button variant="primary" icon="plus" onClick={() => navigate(`${base}/new`)} data-testid="add-ie">{income ? 'Add income' : 'Add expense'}</Button>}
        </>} />
      <div style={{ marginBottom: 16, overflowX: 'auto' }}>
        <Segmented options={PERIODS} value={period} onChange={(v: string) => set({ period: v === 'this_year' ? null : v })} />
      </div>
      <ProblemBanner error={o.error} onRetry={() => void o.refetch()} />
      {!o.data && !o.error && <Skeleton height={320} />}
      {o.data && meta && (
        <>
          <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="ie-tiles">
            <SummaryTile label={noun} value={formatTaka(String(t.value ?? '0'), { symbol: true })} sub={`${t.count ?? 0} lines posted`} testId="tile-total" />
            <SummaryTile label="This month" value={formatTaka(String(t.this_month ?? '0'), { symbol: true })} testId="tile-month" />
            {!income && <SummaryTile label="Budget used" value={t.used_pct !== null && t.used_pct !== undefined ? `${String(t.used_pct)} %` : 'No budget'}
              sub={t.budget ? `of ${formatTaka(String(t.budget), { symbol: true })}` : 'Set budgets on the categories'} tone={t.used_pct !== null && t.used_pct !== undefined && compareDecimal(String(t.used_pct), '100') > 0 ? 'negative' : undefined} testId="tile-budget" />}
            <SummaryTile label="Missing receipts" value={String(t.missing_receipts ?? 0)} sub={Number(t.missing_receipts ?? 0) > 0 ? 'Attach them from the list' : 'All attached'}
              tone={Number(t.missing_receipts ?? 0) > 0 ? 'negative' : undefined} testId="tile-missing" />
          </div>
          <div className="lf-grid" style={{ alignItems: 'start' }}>
            <div className="lf-c8" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card title="By category">
                {rows.length === 0 ? <EmptyState icon="tags" title="No categories yet" description="Add categories to sort your entries." action={can('banking.create') ? <Button variant="secondary" onClick={() => navigate(`${base}/categories`)}>Add a category</Button> : undefined} /> : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }} data-testid="ie-by-category">
                    {rows.map((r) => (
                      <li key={r.id} style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          <button type="button" onClick={() => navigate(`${base}/list?category=${r.id}`)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--ink)', textDecoration: 'underline' }}>{r.name}</button>
                          <span className="lf-num">{formatTaka(r.value, { symbol: true })}{r.share ? ` · ${r.share} %` : ''}
                            {r.status === 'over_budget' && <> <Badge tone="negative">Over budget</Badge></>}{r.status === 'near_limit' && <> <Badge tone="warning">Near budget</Badge></>}</span>
                        </div>
                        <div style={{ height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden' }} aria-hidden>
                          <div style={{ width: `${Number(r.share ?? '0')}%`, height: '100%', background: 'var(--accent, var(--ink))' }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Last 12 months">
                <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 6, height: 160 }} data-testid="ie-months" role="img"
                  aria-label={`${noun} per month${budgetLine ? `; monthly budget ${formatTaka(budgetLine, { symbol: true })}` : ''}`}>
                  {budgetLine && <div title={`Monthly budget ${formatTaka(budgetLine, { symbol: true })}`} style={{ position: 'absolute', left: 0, right: 0, bottom: `${(Number(budgetLine) / max) * 130 + 18}px`, borderTop: '2px dashed var(--negative)' }} />}
                  {meta.months.map((m, i) => (
                    <div key={m.month} title={`${m.label}: ${formatTaka(m.value, { symbol: true })}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                      <div style={{ width: '100%', maxWidth: 28, height: `${(heights[i] / max) * 130}px`, minHeight: heights[i] > 0 ? 2 : 0, background: 'var(--accent, var(--ink))', borderRadius: 3 }} />
                      <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <div className="lf-c4" style={{ minWidth: 0 }}>
              <Card title="Latest entries" padding="none">
                {meta.recent.length === 0 ? <EmptyState icon={income ? 'hand-coins' : 'banknote'} title="Nothing posted in this period" description="Your entries show here." /> : (
                  <DataTable caption="Latest entries" rows={meta.recent.map((e) => ({ id: e.journal_line_id, voucher: e.voucher_id, date: shortDate(e.date), description: e.description, amount: e.amount }))}
                    columns={[{ key: 'date', label: 'Date' }, { key: 'description', label: 'Description' }, { key: 'amount', label: '৳', type: 'amount' }]}
                    onRowClick={(r: { voucher: number }) => navigate(`/accounting/vouchers/${r.voucher}`)} />
                )}
              </Card>
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="ghost" size="sm" onClick={() => navigate(`${base}/list`)}>All {income ? 'income' : 'expenses'}</Button>
                {!income && <Button variant="ghost" size="sm" onClick={() => navigate('/expenses/list?missing_receipt=true')}>Missing receipts</Button>}
                <Button variant="ghost" size="sm" onClick={() => navigate(`${base}/categories`)}>Categories</Button>
              </div>
            </div>
          </div>
        </>
      )}
      {o.data && !meta && <WidgetError title="Could not read the overview" onRetry={() => void o.refetch()} />}
    </>
  )
}
