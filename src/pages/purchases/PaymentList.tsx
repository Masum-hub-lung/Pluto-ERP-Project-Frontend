import { useNavigate } from 'react-router-dom'
import type { Voucher } from '../../api/contract.gen'
import { useMoneyAccounts } from '../../api/money'
import { useParty } from '../../api/parties'
import { methodLabel, paymentOf } from '../../api/receipts'
import { useSupplierPayments } from '../../api/supplierPayments'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../../components/ListCard'
import { PartyPicker } from '../../components/pickers/PartyPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { VoucherStatusBadge } from '../accounting/common'
import { shortDate } from './BillList'

/**
 * F12 Payments made (NEW, GAP-24; backlog P8.2-FE-03): supplier payments with supplier, account, method, amount and
 * state (posted, awaiting approval, rejected), from GET /supplier-payments. Filters in the URL; a row opens it.
 */
const STATUSES = [{ value: '', label: 'All' }, { value: 'posted', label: 'Posted' }, { value: 'submitted', label: 'Awaiting approval' }, { value: 'rejected', label: 'Rejected' }]
const SORTS = [{ value: '-entry_date', label: 'Sort: newest first' }, { value: 'entry_date', label: 'Sort: oldest first' }, { value: '-total_debit', label: 'Sort: amount, high to low' }]

export function PaymentList() {
  const { PageHeader, Button, Input, Select, DataTable, EmptyState, Field, Segmented } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const { get, set, search, setSearch, page } = useListParams()
  const partyId = Number(get('party_id')) || 0
  const accountId = get('money_account_id'), status = get('status')
  const from = get('date_from'), to = get('date_to'), sort = get('sort', '-entry_date'), q = get('q')
  const supplier = useParty(partyId)
  const accounts = useMoneyAccounts()
  const list = useSupplierPayments({ q: q || undefined, party_id: partyId || undefined, money_account_id: Number(accountId) || undefined, status: status || undefined,
    date_from: from || undefined, date_to: to || undefined, sort, page, per_page: 25 })

  const rows = (list.data?.data ?? []).map((v: Voucher) => {
    const p = paymentOf(v)
    return { id: v.id, number: v.voucher_number, date: shortDate(v.entry_date), supplier: p?.party?.name ?? '—', code: p?.party?.code ?? '', account: p?.money_account.name ?? '—',
      method: p ? methodLabel(p.method) : '—', amount: p?.amount ?? v.total_debit, status: v.status }
  })
  const columns: DataColumn[] = [
    { key: 'number', label: 'Voucher', mono: true },
    { key: 'date', label: 'Date' },
    { key: 'supplier', label: 'Supplier', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.supplier}</span><span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}</span>
      </span>) },
    { key: 'account', label: 'Paid from' },
    { key: 'method', label: 'Method' },
    { key: 'amount', label: 'Amount (৳)', type: 'amount' },
    { key: 'status', label: 'Status', render: (v) => <VoucherStatusBadge status={v} /> },
  ]
  const filtered = !!(q || partyId || accountId || status || from || to)
  const clear = () => { setSearch(''); set({ q: null, party_id: null, money_account_id: null, status: null, date_from: null, date_to: null }) }
  const add = can('purchases.create') ? () => navigate('/purchases/payments/new') : undefined
  const empty = filtered
    ? <EmptyState icon="search" title="No payments match these filters" description="Search by voucher, supplier, cheque or reference." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
    : <EmptyState icon="hand-coins" title="No payments made yet" description="Pay a supplier and apply it to their bills." action={add ? <Button variant="primary" icon="plus" onClick={add}>Pay supplier</Button> : undefined} />

  return (
    <>
      <PageHeader title="Payments made" description="Money paid to suppliers, and what each payment settled."
        actions={add ? <Button variant="primary" icon="plus" onClick={add} data-testid="new-payment">Pay supplier</Button> : undefined} />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <Segmented options={STATUSES} value={status} onChange={(v) => set({ status: v || null })} />
      </div>
      <ListCard label="Payments made" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(`/purchases/payments/${r.id}`), mobileColumns: ['number', 'supplier', 'date', 'amount'], empty }}
        toolbar={<>
          <div style={{ flex: '1 1 240px', maxWidth: 340 }}><Input icon="search" placeholder="Search voucher, supplier, cheque" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" /></div>
          <div style={{ flex: '1 1 220px', maxWidth: 300 }}><PartyPicker type="supplier" value={partyId ? supplier.data?.party ?? null : null} onChange={(p) => set({ party_id: p ? String(p.id) : null })} aria-label="Supplier" /></div>
          <div style={{ width: 200 }}><Select aria-label="Account" value={accountId} onChange={(e) => set({ money_account_id: e.target.value || null })}
            options={[{ value: '', label: 'All accounts' }, ...(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} /></div>
        </>}
        filters={<>
          <Field label="From" htmlFor="pm-from"><Input id="pm-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="pm-to"><Input id="pm-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
          <div style={{ width: 220, alignSelf: 'flex-end' }}><Select aria-label="Sort" options={SORTS} value={sort} onChange={(e) => set({ sort: e.target.value })} /></div>
        </>}>
        <DataTable caption="Payments made" columns={columns} rows={rows} loading={list.isPending} onRowClick={(r: { id: number }) => navigate(`/purchases/payments/${r.id}`)} />
      </ListCard>
    </>
  )
}
