import { useNavigate } from 'react-router-dom'
import { useMoneyAccounts, type MoneyAccountRow } from '../../api/money'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { accountTypeLabel } from '../../lib/moneyAccountSchema'
import { formatTaka } from '../../lib/format'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { shortDate } from '../purchases/BillList'

/**
 * G3 Bank account list (Bnk-Banks.dc.html; backlog P6.2-FE-02): every cash, bank, wallet, card and cash-credit account
 * with its masked number and book balance from the API. Statement import and the account page (G5) come with P12.
 */
export function MoneyAccountList() {
  const { PageHeader, Button, DataTable, EmptyState, Badge } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const list = useMoneyAccounts()
  const rows = (list.data ?? []).map((a: MoneyAccountRow) => ({
    id: a.id, name: a.name, bank: a.bank_name ? `${a.bank_name}${a.branch_name ? `, ${a.branch_name}` : ''}` : '—', number: a.account_number_masked ?? '—',
    type: accountTypeLabel(a.account_type), reconciled: a.last_reconciled_on ? shortDate(a.last_reconciled_on) : 'Never', status: a.is_active ? 'active' : 'inactive',
    balance: a.book_balance ?? '', ledger: a.ledger_code ?? '',
  }))
  const columns: DataColumn[] = [
    { key: 'name', label: 'Account', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.name}</span>
        <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.ledger}</span>
      </span>) },
    { key: 'bank', label: 'Bank' },
    { key: 'number', label: 'Account no.', mono: true },
    { key: 'type', label: 'Type' },
    { key: 'reconciled', label: 'Reconciled to' },
    { key: 'status', label: 'Status', render: (v) => <Badge tone={v === 'active' ? 'positive' : 'neutral'} dot>{v === 'active' ? 'Active' : 'Inactive'}</Badge> },
    { key: 'balance', label: 'Book balance (৳)', align: 'right', render: (v: string) => (v ? <span className="lf-num">{formatTaka(v)}</span> : '') },
  ]
  const add = can('banking.create') ? () => navigate('/banking/accounts/new') : undefined
  const empty = <EmptyState icon="landmark" title="No money accounts yet" description="Add your cash box and bank accounts. Receipts and payments go into them, and each gets its own ledger."
    action={add ? <Button variant="primary" icon="plus" onClick={add}>Add account</Button> : undefined} />

  return (
    <>
      <PageHeader title="Cash and bank accounts" description="Where money is kept, with each account's balance in the books."
        actions={add ? <Button variant="primary" icon="plus" onClick={add} data-testid="add-account">Add account</Button> : undefined} />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Money accounts" meta={undefined}
        cards={{ columns, rows, loading: list.isPending, mobileColumns: ['name', 'type', 'number', 'balance'], badgeKey: 'status', empty }}>
        <DataTable caption="Money accounts" columns={columns} rows={rows} loading={list.isPending} emptyState={empty} />
      </ListCard>
    </>
  )
}
