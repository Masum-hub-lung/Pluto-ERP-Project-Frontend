import { useNavigate } from 'react-router-dom'
import type { LensData, ReportData } from '../../api/contract.gen'
import { periodOf, useLens, type Lens as LensName, type Upcoming } from '../../api/dashboard'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { compareDecimal } from '../../lib/decimal'
import { formatTaka } from '../../lib/format'
import { BarChart, BarList, KpiTile, LineChart } from '../../components/charts'
import { ProblemBanner } from '../../components/ProblemBanner'
import { StatementTable } from '../../components/report/StatementTable'
import { Forbidden } from '../../components/states'
import { shortDate } from '../purchases/BillList'
import { Empty, RowLink } from './Dashboard'
import { LensNav, lensAllowed, LENSES, PeriodControl, usePeriod } from './common'
import '../../components/report/report.css'

/**
 * Dashboard lenses A2–A8 (Dash-A2…A8.dc.html; FR-011; backlog P14.2-FE-02/03): the A1 shell with lens tabs, KPI tiles,
 * one chart or bar list and one table linking onward, from GET /dashboard/lenses/{lens}.
 *  - A2 financial: P&L tiles, net profit by month, P&L at a glance with share of revenue, key ratios;
 *  - A3 sales: by product category, top customers;  A4 expenses: by category against the budget;
 *  - A5/A6 receivables/payables: aging buckets, largest balances (A6 adds the bills due soon);
 *  - A7 cash and bank: 30 days of the combined balance, accounts with reconciliation status;
 *  - A8 inventory: stock by warehouse (value with inventory.view_costs, else units), products to reorder.
 * Receivables, payables, cash and inventory are as of today; the others follow the period.
 */
const COPY: Record<LensName, { title: string; description: string; chart: string; periodic: boolean }> = {
  financial: { title: 'Financial overview', description: 'Profit, margins and the ratios that matter, from the posted books.', chart: 'Net profit by month', periodic: true },
  sales: { title: 'Sales overview', description: 'What sold, by category, and who bought the most.', chart: 'Sales by product category', periodic: true },
  expenses: { title: 'Expense overview', description: 'Spending by category against each monthly budget.', chart: 'By category', periodic: true },
  receivables: { title: 'Outstanding receivables', description: 'What customers owe you today, by how long it has been due.', chart: 'By age', periodic: false },
  payables: { title: 'Outstanding payables', description: 'What you owe suppliers today, and the bills coming due.', chart: 'By age', periodic: false },
  cash: { title: 'Cash and bank summary', description: 'Balances today, money in and out this month, and reconciliation.', chart: 'Combined balance, last 30 days', periodic: false },
  inventory: { title: 'Inventory alerts', description: 'Products below their reorder level, and stock by warehouse.', chart: 'Stock by warehouse', periodic: false },
}

type Row = Record<string, string | number | boolean | null | undefined>

export function Lens({ lens }: { lens: LensName }) {
  const { can } = useSession()
  if (!lensAllowed(can, lens)) {
    const needs = LENSES.find((l) => l.lens === lens)!.needs.find((p) => !can(p))!
    return <Forbidden permission={needs} what={COPY[lens].title.toLowerCase()} />
  }
  return <LensPage lens={lens} />
}

function LensPage({ lens }: { lens: LensName }) {
  const { PageHeader, Card, Button, Skeleton } = ds()
  const navigate = useNavigate()
  const [period] = usePeriod()
  const q = useLens(lens, period)
  const d = q.data
  const c = COPY[lens]
  const p = periodOf(d)
  const table = d?.table
  const meta = (table?.meta ?? {}) as { view_all?: string; ratios?: Array<{ key: string; label: string; value: string | null; unit: string; basis: string }>; upcoming?: Upcoming[]; measure?: string }

  return (
    <>
      <PageHeader eyebrow="Dashboard" title={c.title} description={`${c.description}${p ? ` · ${c.periodic ? p.label : `as of ${shortDate(p.date_to)}`}` : ''}`}
        actions={c.periodic ? <PeriodControl /> : undefined} />
      <LensNav active={lens} />
      <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
      <div className="lf-grid" style={{ marginBottom: 24 }} data-testid="lens-kpis">
        {!d && q.isPending && [0, 1, 2, 3].map((i) => <div key={i} className="lf-c3"><Skeleton height={112} /></div>)}
        {d?.kpis.map((k) => <KpiTile key={k.key} kpi={k} invert={['expenses', 'overdue', 'd90_plus', 'out_this_month'].includes(k.key)} />)}
        {d && lens === 'inventory' && d.kpis.length === 0 && table && <InventoryCounts table={table} />}
      </div>
      <div className="lf-grid">
        <div className={lens === 'financial' ? 'lf-c7' : 'lf-c5'} style={{ minWidth: 0 }}>
          <Card title={c.chart}>{d ? <Chart lens={lens} d={d} measure={meta.measure} /> : <Skeleton height={160} />}</Card>
        </div>
        {lens === 'financial' && (
          <div className="lf-c5" style={{ minWidth: 0 }}>
            <Card title="Key ratios">
              {!meta.ratios ? <Skeleton height={160} /> : (
                <dl style={{ margin: 0, display: 'grid', gap: 12 }} data-testid="ratios">
                  {meta.ratios.map((r) => (
                    <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                      <dt><strong>{r.label}</strong><br /><span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.basis}</span></dt>
                      <dd className="lf-num" style={{ margin: 0, font: '500 20px/26px var(--font-serif)' }}>{r.value === null ? '—' : `${r.value}${r.unit === 'days' ? ' days' : ` ${r.unit}`}`}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>
          </div>
        )}
        <div className={lens === 'financial' ? 'lf-c12' : 'lf-c7'} style={{ minWidth: 0 }}>
          <Card title={table?.title ?? 'Details'} padding="none"
            actions={meta.view_all ? <Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => navigate(meta.view_all!)} data-testid="view-all">View all</Button> : undefined}>
            <div data-testid="lens-table">
              {table ? <StatementTable report={table} onOpen={(r) => { if (typeof r.url === 'string') navigate(r.url) }}
                cell={(col, r) => (col.type === 'pct' ? (r[col.key] === null || r[col.key] === undefined ? '—' : `${String(r[col.key])} %`)
                  : col.key === 'status' && typeof r[col.key] === 'string' ? statusText(String(r[col.key])) : undefined)} /> : <div style={{ padding: 16 }}><Skeleton height={160} /></div>}
            </div>
          </Card>
        </div>
        {lens === 'payables' && (meta.upcoming?.length ?? 0) > 0 && (
          <div className="lf-c12" style={{ minWidth: 0 }}>
            <Card title="Bills coming due" subtitle="Overdue or due in the next 14 days">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="upcoming-bills">
                {meta.upcoming!.map((u) => (
                  <li key={u.id}><RowLink onClick={() => navigate(u.url)} left={<><strong>{u.party}</strong><span className="lf-mono" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{u.number} · due {shortDate(u.due_date)}</span></>}
                    right={<><span className="lf-num">{formatTaka(u.amount, { symbol: true })}</span><span style={{ fontSize: 12, color: u.days < 0 ? 'var(--negative)' : 'var(--ink-muted)' }}>
                      {u.days < 0 ? `${-u.days} days overdue` : u.days === 0 ? 'Due today' : `In ${u.days} days`}</span></>} /></li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </div>
    </>
  )
}

const statusText = (s: string) => ({ out_of_stock: 'Out of stock', low_stock: 'Low', on_track: 'On track', near_limit: 'Near the limit', over_budget: 'Over budget',
  not_used: 'Not used yet', no_budget: 'No budget' } as Record<string, string>)[s] ?? s

function Chart({ lens, d, measure }: { lens: LensName; d: LensData; measure?: string }) {
  const series = (d.series ?? []) as Row[]
  if (series.length === 0) return <Empty text={lens === 'inventory' ? 'No stock yet' : 'Nothing posted in this period'} />
  const money = (v: unknown) => formatTaka(String(v ?? '0'), { symbol: true })
  switch (lens) {
    case 'financial':
      return <BarChart testId="lens-chart" label="Net profit by month" series={[{ key: 'value', label: 'Net profit', tone: 'accent' }]}
        groups={series.map((s) => ({ key: String(s.month), label: String(s.label), values: { value: { pct: String(s.pct), text: money(s.value), negative: !!s.negative } } }))} />
    case 'cash': {
      const first = series[0], last = series[series.length - 1]
      return <LineChart testId="lens-chart" label={`Combined balance from ${money(first.balance)} to ${money(last.balance)}`} points={series.map((s) => String(s.pct))}
        first={`${shortDate(String(first.date))} · ${money(first.balance)}`} last={`${shortDate(String(last.date))} · ${money(last.balance)}`} />
    }
    case 'receivables': case 'payables':
      return <BarList testId="lens-chart" rows={series.map((s) => ({ key: String(s.key), label: String(s.label), value: money(s.amount), pct: String(s.pct),
        tone: s.key === 'not_due' ? 'accent' : s.key === 'd1_30' ? 'warning' : 'negative' }))} />
    case 'expenses':
      return <BarList testId="lens-chart" rows={series.map((s) => ({ key: String(s.id), label: String(s.name), value: money(s.value), pct: String(s.pct), url: s.url ? String(s.url) : undefined,
        note: s.used_pct ? `${String(s.used_pct)} % of budget` : undefined, tone: s.status === 'over_budget' ? 'negative' : s.status === 'near_limit' ? 'warning' : 'accent' }))} />
    case 'inventory':
      return <BarList testId="lens-chart" rows={series.map((s) => ({ key: String(s.id), label: String(s.name), pct: String(s.pct), url: s.url ? String(s.url) : undefined,
        value: measure === 'value' ? money(s.value) : `${String(s.quantity)} units` }))} />
    default:
      return <BarList testId="lens-chart" rows={series.map((s) => ({ key: String(s.id ?? s.name), label: String(s.name), value: money(s.value), pct: String(s.pct),
        tone: compareDecimal(String(s.value ?? '0'), '0') < 0 ? 'negative' : 'accent' }))} />
  }
}

/** A8 without inventory.view_costs: counts instead of values. */
function InventoryCounts({ table }: { table: ReportData }) {
  const t = (table.totals ?? {}) as { items?: number; out_of_stock?: number; low_stock?: number }
  const tile = (label: string, value: number | undefined, id: string) => (
    <div className="lf-c3" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: '14px 18px' }}>
      <span style={{ font: '600 13px/18px var(--font-sans)', color: 'var(--ink-muted)' }}>{label}</span>
      <div className="lf-num" data-testid={id} style={{ font: '500 26px/32px var(--font-serif)' }}>{value ?? 0}</div>
    </div>
  )
  return <>{tile('At or below reorder level', t.items, 'count-items')}{tile('Out of stock', t.out_of_stock, 'count-out')}{tile('Low', t.low_stock, 'count-low')}</>
}
