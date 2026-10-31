import { useNavigate } from 'react-router-dom'
import { useOverview, type OverviewMeta, type OverviewPeriod } from '../../api/trade'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { DocStatusBadge } from '../../components/trade/TradeParts'
import { shortDate } from '../purchases/BillList'

/**
 * E1 Sales overview and F1 Purchase overview (Sal-Overview.dc.html, Pur-Overview.dc.html; backlog P10.5-FE-03): tiles
 * (posted value, count, open quotations / orders, still to be received / paid), 12-month bars, the status breakdown with
 * links into the list, recent documents and the top products / suppliers — every figure from GET /sales/overview or
 * /purchases/overview. "Waiting to be paid" is a balance: the API leaves it out without reports.financial (DEC-13).
 */
const PERIODS: { value: OverviewPeriod; label: string }[] = [
  { value: 'this_month', label: 'This month' }, { value: 'last_month', label: 'Last month' }, { value: 'this_quarter', label: 'This quarter' }, { value: 'this_year', label: 'This year' },
]

export function TradeOverview({ side }: { side: 'sales' | 'purchases' }) {
  const { PageHeader, Segmented, Card, Button, DataTable, EmptyState, Skeleton } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const { get, set } = useListParams()
  const sales = side === 'sales'
  const period = (get('period') || 'this_month') as OverviewPeriod
  const o = useOverview(side, period)
  const t = (o.data?.totals ?? {}) as Record<string, string | number | null>
  const meta = (o.data?.meta ?? null) as OverviewMeta | null
  const docs = sales ? '/sales/invoices' : '/purchases/bills'
  const max = Math.max(1, ...(meta?.months ?? []).map((m) => Number(m.value))) // bar heights only; amounts shown are the API's strings

  return (
    <>
      <PageHeader title={sales ? 'Sales overview' : 'Purchase overview'} description={sales ? 'How sales are going, what is waiting to be paid and what sells best.' : 'What you are buying, what you owe suppliers and who you buy from most.'}
        actions={can(sales ? 'sales.create' : 'purchases.create')
          ? <Button variant="primary" icon="plus" onClick={() => navigate(sales ? '/sales/invoices/new' : '/purchases/bills/new')}>{sales ? 'New invoice' : 'New bill'}</Button> : undefined} />
      <div style={{ marginBottom: 16, overflowX: 'auto' }}>
        <Segmented options={PERIODS} value={period} onChange={(v: string) => set({ period: v === 'this_month' ? null : v })} />
      </div>
      <ProblemBanner error={o.error} onRetry={() => void o.refetch()} />
      {!o.data && !o.error && <Skeleton height={320} />}
      {o.data && meta && (
        <>
          <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="overview-tiles">
            <SummaryTile label={sales ? 'Sales' : 'Purchases'} value={formatTaka(String(t.value ?? '0'), { symbol: true })} sub={`${t.count ?? 0} ${sales ? 'invoices' : 'bills'} posted`} testId="tile-value" />
            <SummaryTile label={sales ? 'Open quotations' : 'Open purchase orders'} value={String(sales ? t.open_quotes ?? 0 : t.open_orders ?? 0)}
              sub={formatTaka(String((sales ? t.open_quotes_value : t.open_orders_value) ?? '0'), { symbol: true })} testId="tile-open" />
            {t.outstanding !== null && t.outstanding !== undefined && (
              <SummaryTile label={sales ? 'Waiting to be paid' : 'Owed to suppliers'} value={formatTaka(String(t.outstanding), { symbol: true })} testId="tile-outstanding" />)}
            <SummaryTile label="Overdue" value={String(meta.status.overdue.count)} sub={formatTaka(meta.status.overdue.value, { symbol: true })}
              tone={meta.status.overdue.count > 0 ? 'negative' : undefined} testId="tile-overdue" />
          </div>
          <div className="lf-grid" style={{ alignItems: 'start' }}>
            <div className="lf-c8" style={{ minWidth: 0 }}>
              <Card title="Last 12 months">
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160 }} data-testid="overview-months" role="img" aria-label="Posted value per month">
                  {meta.months.map((m) => (
                    <div key={m.month} title={`${m.label}: ${formatTaka(m.value, { symbol: true })}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                      <div style={{ width: '100%', maxWidth: 28, height: `${(Number(m.value) / max) * 130}px`, minHeight: Number(m.value) > 0 ? 2 : 0, background: 'var(--accent, var(--ink))', borderRadius: 3 }} />
                      <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <div style={{ height: 16 }} />
              <Card title="By status">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} data-testid="overview-status">
                  {([['draft', 'Drafts', { tab: 'draft' }], ['unpaid', 'Unpaid', { tab: 'unpaid' }], ['part_paid', 'Part paid', { tab: 'part_paid' }], ['paid', 'Paid', { tab: 'paid' }],
                    ['overdue', 'Overdue', { tab: 'overdue' }]] as const).map(([k, label, q]) => (
                    <Button key={k} variant="secondary" size="sm" onClick={() => navigate(`${docs}?tab=${q.tab}`)}>
                      {label}: {meta.status[k].count} · {formatTaka(meta.status[k].value)}
                    </Button>
                  ))}
                </div>
              </Card>
            </div>
            <div className="lf-c4" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card title={sales ? 'Recent invoices' : 'Recent bills'} padding="none">
                {meta.recent.length === 0 ? <EmptyState icon="file-text" title="Nothing posted in this period" description={sales ? 'Your invoices show here.' : 'Your bills show here.'} /> : (
                  <DataTable caption="Recent" rows={meta.recent.map((d) => ({ id: d.id, number: d.number, party: d.party ?? '', date: shortDate(d.date), status: d.status, total: d.total }))}
                    columns={[{ key: 'number', label: 'Number', mono: true }, { key: 'party', label: sales ? 'Customer' : 'Supplier' },
                      { key: 'status', label: 'Status', render: (v: string) => <DocStatusBadge status={v} /> }, { key: 'total', label: '৳', type: 'amount' }]}
                    onRowClick={(r: { id: number }) => navigate(`${docs}/${r.id}`)} />
                )}
              </Card>
              <Card title={sales ? 'Top products' : 'Top suppliers'} padding="none">
                {o.data.rows.length === 0 ? <EmptyState icon="package" title="Nothing posted in this period" description="The best sellers show here." /> : (
                  <DataTable caption={sales ? 'Top products' : 'Top suppliers'} rows={(o.data.rows as Record<string, unknown>[]).map((r, i) => ({ id: i, name: String(r.name), value: String(r.value),
                    extra: sales ? String(r.quantity) : `${String(r.bills)} bills` }))}
                    columns={[{ key: 'name', label: sales ? 'Product' : 'Supplier' }, { key: 'extra', label: sales ? 'Qty' : 'Bills', align: 'right' }, { key: 'value', label: '৳', type: 'amount' }]} />
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  )
}
