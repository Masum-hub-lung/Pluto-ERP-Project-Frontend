import { Link, useNavigate } from 'react-router-dom'
import type { LedgerLine, MoneyTransaction } from '../../api/contract.gen'
import { useMoneyBook, useMoneyTransactions } from '../../api/banking'
import { useMoneyAccounts } from '../../api/money'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { WidgetError } from '../../components/WidgetError'
import { shortDate } from '../purchases/BillList'

/**
 * Account books and transactions (backlog P12.2-FE-08): G11 cash book and G12 bank book — one account's opening,
 * receipts and payments with the running balance, closing (GET /money-accounts/{id}/book; posted vouchers only, BR-005)
 * — and G13 every money movement across accounts (GET /money-transactions). A voucher number opens the voucher (H13).
 */
const blank = (v: string) => (/^0+(\.0+)?$/.test(v) ? '' : v)

/** The book of one account for a range: summary tiles and the lines with their running balance. */
export function BookTable({ accountId, from, to, view, compact = false }: { accountId: number; from?: string; to?: string; view?: string; compact?: boolean }) {
  const { DataTable, EmptyState } = ds()
  const book = useMoneyBook(accountId, { date_from: from, date_to: to, view: view && view !== 'all' ? view : undefined })
  if (book.error) return <WidgetError title="Could not load the book" onRetry={() => void book.refetch()} />
  const b = book.data
  const rows = (b?.lines ?? []).map((l: LedgerLine, i) => ({ id: i, date: shortDate(l.date), voucher: l.voucher_number, voucherId: l.voucher_id, particulars: l.particulars,
    receipts: blank(l.debit), payments: blank(l.credit), balance: `${formatTaka(l.balance)} ${l.balance_side === 'cr' ? 'Cr' : ''}`.trim() }))
  const columns: DataColumn[] = [
    { key: 'date', label: 'Date' },
    { key: 'voucher', label: 'Voucher', render: (v, r) => <Link to={`/accounting/vouchers/${String(r.voucherId)}`} className="lf-code">{v as string}</Link> },
    { key: 'particulars', label: 'Particulars' },
    { key: 'receipts', label: 'Receipts (৳)', type: 'amount' }, { key: 'payments', label: 'Payments (৳)', type: 'amount' },
    { key: 'balance', label: 'Balance (৳)', align: 'right', mono: true },
  ]
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {b && !compact && (
        <div className="lf-grid" data-testid="book-tiles">
          <SummaryTile label="Opening" value={`${formatTaka(b.opening, { symbol: true })}${b.opening_side === 'cr' ? ' Cr' : ''}`} testId="book-opening" />
          <SummaryTile label="Receipts" value={formatTaka(b.total_debit, { symbol: true })} />
          <SummaryTile label="Payments" value={formatTaka(b.total_credit, { symbol: true })} />
          <SummaryTile label="Closing" value={`${formatTaka(b.closing, { symbol: true })}${b.closing_side === 'cr' ? ' Cr' : ''}`} testId="book-closing" />
        </div>
      )}
      <div style={{ overflowX: 'auto' }} data-testid="book-lines">
        <DataTable caption="Book" columns={columns} rows={rows} loading={book.isPending}
          emptyState={<EmptyState icon="book-open" title="Nothing in this period" description="Posted receipts, payments and transfers appear here." />} />
      </div>
    </div>
  )
}

/** G11 / G12: one account's book with account, dates and receipts/payments filter in the URL. */
export function MoneyBookPage({ kind }: { kind: 'cash' | 'bank' }) {
  const { PageHeader, Select, Input, Field, Segmented, Button } = ds()
  const { get, set } = useListParams()
  const accounts = useMoneyAccounts()
  const mine = (accounts.data ?? []).filter((a) => (kind === 'cash' ? a.account_type === 'cash' : a.account_type !== 'cash'))
  const accountId = Number(get('account')) || mine[0]?.id || 0
  const from = get('date_from') || undefined, to = get('date_to') || undefined, view = get('view', 'all')
  return (
    <>
      <PageHeader title={kind === 'cash' ? 'Cash book' : 'Bank book'} description="Receipts and payments with the running balance. Only posted vouchers count."
        actions={<Button variant="secondary" icon="printer" onClick={() => window.print()}>Print</Button>} />
      <div className="lf-report-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ width: 240 }}><Field label="Account" htmlFor="book-account">
          <Select key={mine.length} id="book-account" value={accountId ? String(accountId) : ''} onChange={(e) => set({ account: e.target.value || null })}
            options={mine.length ? mine.map((a) => ({ value: String(a.id), label: a.name })) : [{ value: '', label: `No ${kind} accounts yet` }]} />
        </Field></div>
        <div style={{ width: 170 }}><Field label="From" htmlFor="book-from"><Input id="book-from" type="date" value={from ?? ''} onChange={(e) => set({ date_from: e.target.value || null })} /></Field></div>
        <div style={{ width: 170 }}><Field label="To" htmlFor="book-to"><Input id="book-to" type="date" value={to ?? ''} onChange={(e) => set({ date_to: e.target.value || null })} /></Field></div>
        <Field label="Show"><Segmented key={view} options={[{ value: 'all', label: 'Every entry' }, { value: 'in', label: 'Receipts' }, { value: 'out', label: 'Payments' }]}
          value={view} onChange={(v: string) => set({ view: v === 'all' ? null : v })} /></Field>
      </div>
      <ProblemBanner error={accounts.error} onRetry={() => void accounts.refetch()} />
      {accountId > 0 && <BookTable accountId={accountId} from={from} to={to} view={view} />}
    </>
  )
}

const DIRECTION: Record<string, string> = { in: 'In', out: 'Out', transfer: 'Transfer' }

/** G13 Cash and bank transactions. */
export function MoneyTransactions() {
  const { PageHeader, Input, Segmented, Select, Field, DataTable, EmptyState, Badge } = ds()
  const navigate = useNavigate()
  const { get, set, search, setSearch, page } = useListParams()
  const accounts = useMoneyAccounts()
  const direction = get('direction', 'all')
  const account = Number(get('account')) || 0
  const list = useMoneyTransactions({ q: get('q') || undefined, direction: direction === 'all' ? undefined : direction, money_account_id: account || undefined,
    date_from: get('date_from') || undefined, date_to: get('date_to') || undefined, page, per_page: 50 })
  const rows = (list.data?.data ?? []).map((t: MoneyTransaction, i) => ({ id: i, voucherId: t.voucher_id, date: shortDate(t.date), voucher: t.voucher_number, account: t.account,
    particulars: t.particulars, type: t.direction, in: blank(t.amount_in), out: blank(t.amount_out) }))
  const columns: DataColumn[] = [
    { key: 'date', label: 'Date' }, { key: 'voucher', label: 'Voucher', mono: true }, { key: 'account', label: 'Account' }, { key: 'particulars', label: 'Particulars' },
    { key: 'type', label: 'Type', render: (v) => <Badge tone={v === 'in' ? 'positive' : v === 'out' ? 'warning' : 'info'}>{DIRECTION[v as string]}</Badge> },
    { key: 'in', label: 'In (৳)', type: 'amount' }, { key: 'out', label: 'Out (৳)', type: 'amount' },
  ]
  const open = (r: { voucherId?: unknown }) => navigate(`/accounting/vouchers/${String(r.voucherId)}`)
  return (
    <>
      <PageHeader title="Cash and bank transactions" description="Every posted receipt, payment and transfer across your accounts." />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Transactions" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: open, mobileColumns: ['date', 'particulars', 'in', 'out'], badgeKey: 'type',
          empty: <EmptyState icon="arrow-left-right" title="No transactions" description="Posted receipts, payments and transfers appear here." /> }}
        toolbar={<>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}><Input icon="search" placeholder="Search voucher, party or narration" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" /></div>
          <Segmented key={direction} options={[{ value: 'all', label: 'All' }, { value: 'in', label: 'In' }, { value: 'out', label: 'Out' }, { value: 'transfer', label: 'Transfers' }]}
            value={direction} onChange={(v: string) => set({ direction: v === 'all' ? null : v })} />
          <div style={{ width: 210 }}><Select aria-label="Account" value={account ? String(account) : ''} onChange={(e) => set({ account: e.target.value || null })}
            options={[{ value: '', label: 'All accounts' }, ...(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} /></div>
        </>}
        filters={<>
          <Field label="From" htmlFor="tx-from"><Input id="tx-from" type="date" value={get('date_from')} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="tx-to"><Input id="tx-to" type="date" value={get('date_to')} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
        </>}>
        <DataTable caption="Transactions" columns={columns} rows={rows} loading={list.isPending} onRowClick={open} />
      </ListCard>
    </>
  )
}
