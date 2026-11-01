import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { alertsOf, bannersOf, cashOf, monthsOf, owedOf, periodOf, recentOf, upcomingOf, useDashboard, type Owed } from '../../api/dashboard'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { compareDecimal } from '../../lib/decimal'
import { formatTaka } from '../../lib/format'
import { BarChart, BarList, KpiTile } from '../../components/charts'
import { ProblemBanner } from '../../components/ProblemBanner'
import { WidgetError } from '../../components/WidgetError'
import { entryTypeLabel } from '../accounting/common'
import { shortDate } from '../purchases/BillList'
import { failureOf, greeting, LensNav, PeriodControl, usePeriod } from './common'

/**
 * A1 Main dashboard (Dashboard.dc.html 03, 05 dark, 06 tablet, 07 phone; FR-010; backlog P14.2-FE-01): greeting with the
 * period control and two actions, banners (reconciliation — dismissible for the session — and approvals waiting), 4
 * KPI tiles, 12 months of revenue vs expenses, cash position, money owed by age, upcoming payments, quick actions,
 * recent transactions and inventory alerts. All from GET /dashboard; a widget the API could not build shows its own
 * error with the reference (ERR-8). Sales staff and Viewer get no profit, cash or balances (DEC-13): those widgets are
 * simply not there.
 */
export function Dashboard() {
  const { PageHeader, Button, Banner, Skeleton } = ds()
  const { me, can } = useSession()
  const navigate = useNavigate()
  const [period] = usePeriod()
  const q = useDashboard(period)
  const d = q.data
  const p = periodOf(d)
  const [hidden, setHidden] = useState<string[]>(() => readHidden())
  const dismiss = (kind: string) => { const next = [...hidden, kind]; setHidden(next); try { sessionStorage.setItem(HIDDEN, next.join(',')) } catch { /* private mode */ } }
  const fin = can('reports.financial')
  const owed = owedOf(d)

  return (
    <>
      <PageHeader eyebrow={new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}
        title={greeting(me?.name)} description={p ? `Here is how the business is doing · ${p.label}` : 'Here is how the business is doing.'}
        actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <PeriodControl />
          {can('sales.create') && <Button variant="secondary" icon="hand-coins" onClick={() => navigate('/sales/payments/new')} data-testid="record-receipt">Record receipt</Button>}
          {can('sales.create') && <Button variant="primary" icon="plus" kbd="Alt S" onClick={() => navigate('/sales/invoices/new')} data-testid="new-invoice">New invoice</Button>}
        </div>} />
      <LensNav active="overview" />
      <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
      {bannersOf(d).filter((b) => !hidden.includes(b.kind)).map((b) => (
        <div key={b.kind} style={{ marginBottom: 12 }} data-testid={`banner-${b.kind}`}>
          <Banner tone={b.tone} title={b.title} onDismiss={b.kind === 'reconcile' ? () => dismiss(b.kind) : undefined}
            action={b.url ? <Button size="sm" variant="secondary" onClick={() => navigate(b.url!)}>{b.kind === 'reconcile' ? 'Reconcile' : 'Review'}</Button> : undefined}>
            {b.body}
          </Banner>
        </div>
      ))}

      <div className="lf-grid" style={{ marginBottom: 24 }} data-testid="kpis">
        {!d && q.isPending && [0, 1, 2, 3].map((i) => <div key={i} className="lf-c3"><Skeleton height={112} /></div>)}
        {failureOf(d, 'kpis') && <div className="lf-c12"><WidgetError title={`Could not load the figures · Reference ${failureOf(d, 'kpis')!.ref}`} onRetry={() => void q.refetch()} /></div>}
        {d?.kpis.map((k) => <KpiTile key={k.key} kpi={k} invert={k.key === 'expenses'} />)}
      </div>

      <div className="lf-grid" style={{ marginBottom: 24 }}>
        {fin && (
          <Widget className="lf-c8" title="Revenue vs expenses" subtitle="Last 12 months, as the profit and loss counts them" d={d} widget="revenue_vs_expenses" retry={() => void q.refetch()}
            action={<Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => navigate('/reports/profit-and-loss')}>Profit and loss</Button>}>
            {monthsOf(d).every((m) => compareDecimal(m.revenue, '0') === 0 && compareDecimal(m.expenses, '0') === 0)
              ? <Empty text="Nothing posted in this period" />
              : <BarChart testId="chart-revenue-expenses" label="Revenue and expenses by month"
                  series={[{ key: 'revenue', label: 'Revenue', tone: 'accent' }, { key: 'expenses', label: 'Expenses', tone: 'muted' }]}
                  groups={monthsOf(d).map((m) => ({ key: m.month, label: m.label, values: {
                    revenue: { pct: m.revenue_pct, text: formatTaka(m.revenue, { symbol: true }) }, expenses: { pct: m.expenses_pct, text: formatTaka(m.expenses, { symbol: true }) } } }))} />}
          </Widget>
        )}
        {fin && can('banking.view') && (
          <Widget className="lf-c4" title="Cash position" subtitle="Balances today" d={d} widget="cash_position" retry={() => void q.refetch()}
            action={<Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => navigate('/banking')}>All accounts</Button>}>
            {cashOf(d).length === 0 ? <Empty text="No money accounts yet" /> : (
              <BarList testId="cash-position" rows={cashOf(d).map((a) => ({ key: String(a.id), label: a.name, note: a.bank_name ?? (a.account_type === 'cash' ? 'Cash' : undefined),
                value: formatTaka(a.balance, { symbol: true }), pct: a.share, tone: compareDecimal(a.balance, '0') < 0 ? 'negative' : 'accent', url: `/banking/accounts/${a.id}` }))} />
            )}
          </Widget>
        )}
        {fin && (
          <Widget className="lf-c6" title="Money owed" subtitle="By age, today" d={d} widget="money_owed" retry={() => void q.refetch()}>
            <div style={{ display: 'grid', gap: 18 }}>
              {owed.receivable && <OwedBlock title="Customers owe you" o={owed.receivable} link="/dashboard/receivables" testId="owed-receivable" />}
              {owed.payable && <OwedBlock title="You owe suppliers" o={owed.payable} link="/dashboard/payables" testId="owed-payable" />}
            </div>
          </Widget>
        )}
        {fin && can('purchases.view') && (
          <Widget className="lf-c6" title="Upcoming payments" subtitle="Bills overdue or due in the next 14 days" d={d} widget="upcoming_payments" retry={() => void q.refetch()}>
            {upcomingOf(d).length === 0 ? <Empty text="Nothing to pay in the next two weeks" /> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }} data-testid="upcoming-payments">
                {upcomingOf(d).map((u) => (
                  <li key={u.id}><RowLink onClick={() => navigate(u.url)} left={<><strong>{u.party}</strong><span className="lf-mono" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{u.number}</span></>}
                    right={<><span className="lf-num">{formatTaka(u.amount, { symbol: true })}</span>
                      <span style={{ fontSize: 12, color: u.days < 0 ? 'var(--negative)' : 'var(--ink-muted)' }}>{u.days < 0 ? `${-u.days} days overdue` : u.days === 0 ? 'Due today' : `Due in ${u.days} days`}</span></>} /></li>
                ))}
              </ul>
            )}
          </Widget>
        )}
        <QuickActions className={fin ? 'lf-c4' : 'lf-c12'} />
        {can('accounting.view') && (
          <Widget className={fin ? 'lf-c8' : 'lf-c12'} title="Recent transactions" subtitle="The latest posted vouchers" d={d} widget="recent_transactions" retry={() => void q.refetch()} padding="none"
            action={<Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => navigate('/accounting/vouchers')}>All vouchers</Button>}>
            <RecentTable rows={recentOf(d)} loading={!d} />
          </Widget>
        )}
        {can('inventory.view') && (
          <Widget className="lf-c12" title="Inventory alerts" subtitle="Products at or below their reorder level" d={d} widget="inventory_alerts" retry={() => void q.refetch()}
            action={<Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => navigate('/inventory/low-stock')}>
              {alertsOf(d)[0] ? `All ${alertsOf(d)[0].total}` : 'Low stock'}</Button>}>
            {alertsOf(d).length === 0 ? <Empty text="Every product is above its reorder level" /> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }} data-testid="inventory-alerts">
                {alertsOf(d).map((a) => (
                  <li key={`${a.product_id}-${a.warehouse}`}><RowLink onClick={() => navigate(a.url)}
                    left={<><strong>{a.name}</strong><span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{a.code} · {a.warehouse}</span></>}
                    right={<><span className="lf-num" style={{ color: a.status === 'out_of_stock' ? 'var(--negative)' : undefined }}>{a.on_hand} {a.unit ?? ''}</span>
                      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{a.status === 'out_of_stock' ? 'Out of stock' : `Reorder at ${a.reorder_level}`}</span></>} /></li>
                ))}
              </ul>
            )}
          </Widget>
        )}
      </div>
    </>
  )
}

/** Banners dismissed in this browser session (02 A1: "Dismiss banner → hide for this session"). */
const HIDDEN = 'pluto.dashboard.banners'
function readHidden(): string[] {
  try { return (sessionStorage.getItem(HIDDEN) ?? '').split(',').filter(Boolean) } catch { return [] }
}

/** A dashboard card whose content is replaced by its error when the API reports the widget failed. */
export function Widget({ className, title, subtitle, action, d, widget, retry, padding, children }: {
  className: string; title: string; subtitle?: string; action?: ReactNode; d: { widget_errors?: Array<Record<string, unknown>> } | undefined; widget: string
  retry: () => void; padding?: 'none'; children: ReactNode
}) {
  const { Card, Skeleton } = ds()
  const failed = failureOf(d, widget)
  return (
    <div className={className} data-testid={`widget-${widget}`} style={{ minWidth: 0 }}>
      <Card title={title} subtitle={subtitle} actions={action} padding={failed || !d ? undefined : padding}>
        {failed ? <WidgetError title={`${failed.message} · Reference ${failed.ref}`} onRetry={retry} /> : d ? children : <Skeleton height={140} />}
      </Card>
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <p style={{ margin: 0, padding: '24px 0', textAlign: 'center', color: 'var(--ink-muted)' }}>{text}</p>
}

export function RowLink({ left, right, onClick }: { left: ReactNode; right: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', padding: '10px 0', border: 0, borderBottom: '1px solid var(--line)',
      background: 'none', textAlign: 'left', font: 'inherit', color: 'var(--ink)', cursor: 'pointer', minHeight: 44 }}>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>{left}</span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 'none' }}>{right}</span>
    </button>
  )
}

function OwedBlock({ title, o, link, testId }: { title: string; o: Owed; link: string; testId: string }) {
  const navigate = useNavigate()
  return (
    <div data-testid={testId}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <button type="button" className="lf-link" onClick={() => navigate(link)} style={{ background: 'none', border: 0, padding: 0, font: '600 14px/20px var(--font-sans)', color: 'var(--ink)', cursor: 'pointer' }}>{title}</button>
        <span className="lf-num" style={{ font: '500 20px/26px var(--font-serif)' }}>{formatTaka(o.total, { symbol: true })}</span>
      </div>
      <BarList rows={o.buckets.map((b) => ({ key: b.key, label: b.label, value: formatTaka(b.amount, { symbol: true }), pct: b.pct,
        tone: b.key === 'not_due' ? 'accent' : b.key === 'd1_30' ? 'warning' : 'negative' }))} />
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)' }}>
        {compareDecimal(o.overdue, '0') > 0 ? `${formatTaka(o.overdue, { symbol: true })} overdue · ` : 'Nothing overdue · '}{o.parties} {o.parties === 1 ? 'party' : 'parties'}
      </p>
    </div>
  )
}

function QuickActions({ className }: { className: string }) {
  const { Card, Button } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const actions = [
    { show: can('sales.create'), icon: 'receipt-text', label: 'New sales invoice', kbd: 'Alt S', to: '/sales/invoices/new' },
    { show: can('purchases.create'), icon: 'shopping-cart', label: 'New purchase bill', kbd: 'Alt P', to: '/purchases/bills/new' },
    { show: can('sales.create'), icon: 'hand-coins', label: 'Record a receipt', kbd: 'Alt R', to: '/sales/payments/new' },
    { show: can('purchases.create'), icon: 'banknote', label: 'Pay a supplier', kbd: 'Alt Y', to: '/purchases/payments/new' },
    { show: can('banking.create'), icon: 'wallet', label: 'Add an expense', to: '/expenses/new' },
    { show: can('accounting.create'), icon: 'book-open-text', label: 'Journal voucher', kbd: 'Alt J', to: '/accounting/vouchers/new/journal' },
    { show: can('parties.create'), icon: 'users', label: 'New customer', kbd: 'Alt C', to: '/customers/new' },
  ].filter((a) => a.show)
  if (actions.length === 0) return null
  return (
    <div className={className} style={{ minWidth: 0 }} data-testid="quick-actions">
      <Card title="Quick actions">
        <div style={{ display: 'grid', gap: 8 }}>
          {actions.map((a) => <Button key={a.label} variant="secondary" icon={a.icon} kbd={a.kbd} block onClick={() => navigate(a.to)}>{a.label}</Button>)}
        </div>
      </Card>
    </div>
  )
}

function RecentTable({ rows, loading }: { rows: ReturnType<typeof recentOf>; loading: boolean }) {
  const { DataTable, EmptyState } = ds()
  const navigate = useNavigate()
  const columns: DataColumn[] = [
    { key: 'date', label: 'Date' }, { key: 'number', label: 'Voucher', mono: true }, { key: 'type', label: 'Type' },
    { key: 'party', label: 'Party' }, { key: 'amount', label: 'Amount (৳)', type: 'amount' },
  ]
  return (
    <div style={{ overflowX: 'auto' }} data-testid="recent-transactions">
      <DataTable caption="Recent transactions" columns={columns} loading={loading}
        rows={rows.map((r) => ({ id: r.id, url: r.url, date: shortDate(r.date), number: r.voucher_number, type: entryTypeLabel(r.type), party: r.party ?? r.narration ?? '—', amount: r.amount }))}
        onRowClick={(r: { url: string }) => navigate(r.url)} emptyState={<EmptyState icon="book-open-text" title="Nothing posted in this period" />} />
    </div>
  )
}
