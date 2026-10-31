import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useBankingOverview, type OverviewAccount, type OverviewMeta } from '../../api/banking'
import type { MoneyTransaction } from '../../api/contract.gen'
import { useMoneyAccount, useMoneyAccounts } from '../../api/money'
import { dhakaToday } from '../../api/platform'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { emptyVoucher, type VoucherKind } from '../../lib/voucherForm'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden, NotFound } from '../../components/states'
import { SummaryTile } from '../../components/SummaryTile'
import { VoucherEditor } from '../../components/voucher/VoucherEditor'
import { DetailHeader, panel, type HeaderAction } from '../inventory/parts'
import { shortDate } from '../purchases/BillList'
import { CashCountDialog, ImportStatementDialog, StartReconciliationDialog } from './BankingDialogs'
import { BookTable } from './MoneyBook'

/**
 * Cash and bank pages (backlog P12.2-FE-02..05): G1 overview, G2 cash account and G5 bank account details, and G6–G9 —
 * money received, money paid, cash transfer, bank transfer — on the voucher editor (receipt, payment and contra
 * vouchers: the server balances, checks funds (BR-031) and posts or sends for approval). Every amount is the API's.
 */
const TYPE_LABEL: Record<string, string> = { cash: 'Cash', bank: 'Bank', wallet: 'Mobile wallet', card: 'Card', cash_credit: 'Cash credit' }

/** G1 Cash and bank overview. */
export function BankingOverview() {
  const { PageHeader, Button, Card, Banner, Badge } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const q = useBankingOverview()
  const [reconcile, setReconcile] = useState<OverviewAccount | null>(null)
  if (q.error) return <><PageHeader title="Cash and bank" /><ProblemBanner error={q.error} onRetry={() => void q.refetch()} /></>
  if (!q.data) return <PageSkeleton template="detail" />
  const t = (q.data.totals ?? {}) as Record<string, string | number>
  const accounts = q.data.rows as unknown as OverviewAccount[]
  const meta = (q.data.meta ?? {}) as unknown as OverviewMeta
  const unmatched = accounts.filter((a) => a.unmatched_lines > 0)
  const create = can('banking.create')
  const series = meta.series ?? []

  return (
    <>
      <PageHeader title="Cash and bank" description="Every place your money sits, and what moved this month."
        actions={create ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" icon="arrow-down-left" onClick={() => navigate('/banking/received')} data-testid="go-received">Money received</Button>
          <Button variant="secondary" icon="arrow-up-right" onClick={() => navigate('/banking/paid')} data-testid="go-paid">Money paid</Button>
          <Button variant="primary" icon="arrow-left-right" onClick={() => navigate('/banking/bank-transfer')} data-testid="go-transfer">Transfer</Button>
        </div> : undefined} />
      {unmatched.length > 0 && can('banking.reconcile') && (
        <div style={{ marginBottom: 12 }}><Banner tone="info" title={`${t.unmatched_lines} statement line${t.unmatched_lines === 1 ? '' : 's'} to reconcile`}
          action={<Button size="sm" variant="secondary" onClick={() => setReconcile(unmatched[0]!)}>Reconcile {unmatched[0]!.name}</Button>}>
          Match the imported statement to your books.</Banner></div>
      )}
      <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="banking-tiles">
        <SummaryTile label="Total money" value={formatTaka(String(t.total), { symbol: true })} sub={`${t.accounts} account${t.accounts === 1 ? '' : 's'}`} testId="tile-total" />
        <SummaryTile label="Cash" value={formatTaka(String(t.cash), { symbol: true })} testId="tile-cash" />
        <SummaryTile label="Bank" value={formatTaka(String(t.bank), { symbol: true })} testId="tile-bank" />
        <SummaryTile label="This month" value={`+${formatTaka(String(t.in_this_month))}`} sub={`−${formatTaka(String(t.out_this_month))} out`} testId="tile-month" />
      </div>
      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ minWidth: 0, display: 'grid', gap: 16 }}>
          <Card title="Accounts" padding="none">
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="overview-accounts">
              {accounts.length === 0 && <li style={{ padding: 16, color: 'var(--ink-muted)' }}>No accounts yet. <Link to="/banking/accounts/new">Add one</Link>.</li>}
              {accounts.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => navigate(`/banking/accounts/${a.id}`)} style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', width: '100%',
                    display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--line)', minHeight: 44 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{a.name}</span>
                      <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{TYPE_LABEL[a.account_type]}{a.account_number ? ` · ${a.account_number}` : ''}
                        {a.last_reconciled_on ? ` · reconciled to ${shortDate(a.last_reconciled_on)}` : ''}</span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <span className="lf-num" style={{ fontWeight: 600 }}>{formatTaka(a.balance, { symbol: true })}</span>
                      <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{a.share} %{a.unmatched_lines > 0 ? <> · <Badge tone="warning">{a.unmatched_lines} to match</Badge></> : null}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Recent movements" padding="none" actions={<Link to="/banking/transactions">All</Link>}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="overview-recent">
              {(meta.recent ?? []).length === 0 && <li style={{ padding: 16, color: 'var(--ink-muted)' }}>Nothing posted yet.</li>}
              {(meta.recent ?? []).map((m: MoneyTransaction, i) => (
                <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
                  <span><Link to={`/accounting/vouchers/${m.voucher_id}`} className="lf-code">{m.voucher_number}</Link> {m.particulars}
                    <br /><span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{shortDate(m.date)} · {m.account}</span></span>
                  <span className="lf-num" style={{ color: m.direction === 'out' ? 'var(--ink)' : 'var(--positive, var(--ink))' }}>
                    {m.amount_in !== '0.00' ? `+${formatTaka(m.amount_in)}` : `−${formatTaka(m.amount_out)}`}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <aside className="lf-c4" style={{ display: 'grid', gap: 16 }}>
          <section style={{ ...panel, padding: '16px 20px' }} aria-label="Last 30 days">
            <h2 style={{ margin: '0 0 8px', font: '650 16px/24px var(--font-sans)' }}>Last 30 days</h2>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 14 }}>
              {series.length ? <>From {formatTaka(series[0]!.balance, { symbol: true })} on {shortDate(series[0]!.date)} to {formatTaka(series[series.length - 1]!.balance, { symbol: true })} today.</> : 'No movements yet.'}
            </p>
          </section>
          <section style={{ ...panel, padding: '16px 20px', display: 'grid', gap: 8 }} aria-label="Books">
            <h2 style={{ margin: 0, font: '650 16px/24px var(--font-sans)' }}>Books</h2>
            <Link to="/banking/cash-book">Cash book</Link><Link to="/banking/bank-book">Bank book</Link><Link to="/banking/transactions">All transactions</Link>
            {create && <Link to="/banking/cash-transfer">Cash transfer</Link>}
          </section>
        </aside>
      </div>
      {reconcile && <StartReconciliationDialog accountId={reconcile.id} accountName={reconcile.name} onClose={() => setReconcile(null)} />}
    </>
  )
}

/** G2 cash account / G5 bank account details: the book this month, facts, and the account's actions. */
export function AccountDetails() {
  const { Badge } = ds()
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { can } = useSession()
  const q = useMoneyAccount(id)
  const [dialog, setDialog] = useState<null | 'count' | 'import' | 'reconcile'>(null)
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this account" back="/banking/accounts" backLabel="Accounts" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  const a = q.data
  const cash = a.account_type === 'cash'
  const monthStart = `${dhakaToday().slice(0, 8)}01`
  const actions: HeaderAction[] = [
    ...(can('banking.create') ? [{ label: cash ? 'Cash transfer' : 'Transfer', icon: 'arrow-left-right', onClick: () => navigate(`/banking/${cash ? 'cash' : 'bank'}-transfer?from=${a.id}`) }] : []),
    ...(cash && can('banking.create') ? [{ label: 'Count cash', icon: 'calculator', onClick: () => setDialog('count'), primary: true, testId: 'count-cash' }] : []),
    ...(!cash && can('banking.reconcile') ? [
      { label: 'Import statement', icon: 'upload', onClick: () => setDialog('import'), testId: 'import-statement' },
      { label: 'Reconcile', icon: 'check-check', onClick: () => setDialog('reconcile'), primary: true, testId: 'reconcile' },
    ] : []),
    { label: cash ? 'Cash book' : 'Bank book', icon: 'book-open', onClick: () => navigate(`/banking/${cash ? 'cash' : 'bank'}-book?account=${a.id}`) },
  ]
  const facts = [
    { label: 'Type', value: TYPE_LABEL[a.account_type] }, ...(cash ? [{ label: 'Custodian', value: a.custodian?.name ?? '—' }] : [
      { label: 'Bank', value: [a.bank_name, a.branch_name].filter(Boolean).join(', ') || '—' }, { label: 'Account name', value: a.account_name ?? '—' },
      { label: 'Account no.', value: a.account_number_masked ?? '—' }, { label: 'Routing no.', value: a.routing_number ?? '—' },
      { label: 'Overdraft limit', value: a.overdraft_limit ? formatTaka(a.overdraft_limit, { symbol: true }) : 'None' },
      { label: 'Reconciled to', value: a.last_reconciled_on ? shortDate(a.last_reconciled_on) : 'Never' }]),
    { label: 'Ledger', value: a.ledger_code },
  ]
  return (
    <>
      <DetailHeader title={a.name} testId="account-name" actions={actions}
        badges={<><Badge tone={a.is_active ? 'positive' : 'neutral'} dot>{a.is_active ? 'Active' : 'Inactive'}</Badge>{!cash && a.unmatched_lines > 0 && <Badge tone="warning">{a.unmatched_lines} to match</Badge>}</>}
        facts={<><span>{TYPE_LABEL[a.account_type]}</span><span className="lf-num" data-testid="account-balance">{formatTaka(a.book_balance, { symbol: true })}</span></>} />
      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ minWidth: 0 }}>
          <section style={{ ...panel, padding: '16px 20px' }} aria-label="This month">
            <h2 style={{ margin: '0 0 12px', font: '650 16px/24px var(--font-sans)' }}>{cash ? 'Cash book' : 'Bank book'} this month</h2>
            <BookTable accountId={a.id} from={monthStart} />
          </section>
        </div>
        <aside className="lf-c4" style={{ ...panel, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Account facts">
          <h2 style={{ margin: 0, font: '650 16px/24px var(--font-sans)' }}>Account</h2>
          {facts.map((f) => (
            <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ color: 'var(--ink-muted)' }}>{f.label}</span><span style={{ textAlign: 'right' }}>{f.value}</span></div>
          ))}
        </aside>
      </div>
      {dialog === 'count' && <CashCountDialog accountId={a.id} accountName={a.name} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void q.refetch() }} />}
      {dialog === 'import' && <ImportStatementDialog accountId={a.id} accountName={a.name} onClose={() => setDialog(null)} onDone={() => void q.refetch()} />}
      {dialog === 'reconcile' && <StartReconciliationDialog accountId={a.id} accountName={a.name} onClose={() => setDialog(null)} />}
    </>
  )
}

const MONEY_PAGES: Record<string, { type: VoucherKind; title: string; description: string; perm: string }> = {
  received: { type: 'receipt', title: 'Money received', description: 'Money in that is not for an invoice: other income, the owner, a loan. A customer paying an invoice goes to Customer payment.', perm: 'banking.create' },
  paid: { type: 'payment', title: 'Money paid', description: 'Money out that is not for a bill: an expense, the owner, a loan. A supplier bill is paid from Supplier payment.', perm: 'banking.create' },
  'cash-transfer': { type: 'contra', title: 'Cash transfer', description: 'Move money between your own accounts: cash to the bank, the bank to cash, or between cash boxes.', perm: 'banking.create' },
  'bank-transfer': { type: 'contra', title: 'Bank transfer', description: 'Move money between your bank accounts. A bank charge on the transfer is booked to bank charges.', perm: 'banking.create' },
}

/** G6 / G7 / G8 / G9 on the voucher editor, starting from the account in `?from=` when given. */
export function MoneyForm({ kind }: { kind: 'received' | 'paid' | 'cash-transfer' | 'bank-transfer' }) {
  const { can } = useSession()
  const [params] = useSearchParams()
  const accounts = useMoneyAccounts()
  const page = MONEY_PAGES[kind]!
  if (!can(page.perm)) return <Forbidden permission={page.perm} what={page.title.toLowerCase()} />
  if (accounts.isPending) return <PageSkeleton template="form" />
  const from = params.get('from') ?? ''
  const preferred = (accounts.data ?? []).find((a) => a.is_active && (from ? String(a.id) === from
    : kind === 'cash-transfer' ? a.account_type === 'cash' : kind === 'bank-transfer' ? a.account_type !== 'cash' : true))
  const initial = emptyVoucher(page.type, dhakaToday())
  initial.payment.money_account_id = preferred ? String(preferred.id) : ''
  if (kind !== 'cash-transfer' && kind !== 'received' && preferred && preferred.account_type !== 'cash') initial.payment.method = 'bank_transfer'
  return <VoucherEditor key={kind} initial={initial} heading={{ eyebrow: 'Cash and bank', title: page.title, description: page.description }} />
}
