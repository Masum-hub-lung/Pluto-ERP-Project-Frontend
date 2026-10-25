import { useNavigate } from 'react-router-dom'
import type { Voucher } from '../../api/contract.gen'
import { useMoneyAccounts } from '../../api/money'
import { useParty } from '../../api/parties'
import { methodLabel, paymentOf, useReceipts } from '../../api/receipts'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../../components/ListCard'
import { PartyPicker } from '../../components/pickers/PartyPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { shortDate } from '../purchases/BillList'

/**
 * E14 Payments received (backlog P6.2-FE-04): customer receipts with customer, account, method, amount and what is
 * still unapplied (advance), from GET /customer-receipts. Filters in the URL; a row opens the receipt.
 */
const SORTS = [{ value: '-entry_date', label: 'Sort: newest first' }, { value: 'entry_date', label: 'Sort: oldest first' }, { value: '-total_debit', label: 'Sort: amount, high to low' }]

export function ReceiptList() {
  const { PageHeader, Button, Input, Select, DataTable, EmptyState, Field, Badge } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const { get, set, search, setSearch, page } = useListParams()
  const partyId = Number(get('party_id')) || 0
  const accountId = get('money_account_id')
  const unapplied = get('unapplied')
  const from = get('date_from'), to = get('date_to'), sort = get('sort', '-entry_date'), q = get('q')
  const customer = useParty(partyId)
  const accounts = useMoneyAccounts()
  const list = useReceipts({ q: q || undefined, party_id: partyId || undefined, money_account_id: Number(accountId) || undefined, unapplied: unapplied || undefined,
    date_from: from || undefined, date_to: to || undefined, sort, page, per_page: 25 })

  const rows = (list.data?.data ?? []).map((v: Voucher) => {
    const p = paymentOf(v)
    return { id: v.id, number: v.voucher_number, date: shortDate(v.entry_date), customer: p?.party?.name ?? '—', code: p?.party?.code ?? '', account: p?.money_account.name ?? '—',
      method: p ? methodLabel(p.method) : '—', amount: p?.amount ?? v.total_debit, unapplied: p && p.unapplied_amount !== '0.00' ? p.unapplied_amount : '', status: v.status }
  })
  const columns: DataColumn[] = [
    { key: 'number', label: 'Receipt', mono: true },
    { key: 'date', label: 'Date' },
    { key: 'customer', label: 'Customer', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.customer}</span><span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}</span>
      </span>) },
    { key: 'account', label: 'Deposited to' },
    { key: 'method', label: 'Method' },
    { key: 'amount', label: 'Amount (৳)', type: 'amount' },
    { key: 'unapplied', label: 'Advance (৳)', align: 'right', render: (v: string, r) => (r.status === 'reversed' ? <Badge tone="negative">Cancelled</Badge>
      : v ? <span className="lf-num">{formatTaka(v)}</span> : '') },
  ]
  const filtered = !!(q || partyId || accountId || unapplied || from || to)
  const clear = () => { setSearch(''); set({ q: null, party_id: null, money_account_id: null, unapplied: null, date_from: null, date_to: null }) }
  const add = can('sales.create') ? () => navigate('/sales/payments/new') : undefined
  const empty = filtered
    ? <EmptyState icon="search" title="No payments match these filters" description="Search by receipt number, customer, cheque or reference." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
    : <EmptyState icon="hand-coins" title="No payments received yet" description="Record money from a customer and apply it to their invoices." action={add ? <Button variant="primary" icon="plus" onClick={add}>Record payment</Button> : undefined} />

  return (
    <>
      <PageHeader title="Payments received" description="Money received from customers, and what each payment settled."
        actions={add ? <Button variant="primary" icon="plus" onClick={add} data-testid="new-receipt">Record payment</Button> : undefined} />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Payments received" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(`/sales/payments/${r.id}`), mobileColumns: ['number', 'customer', 'date', 'amount'], empty }}
        toolbar={<>
          <div style={{ flex: '1 1 240px', maxWidth: 340 }}><Input icon="search" placeholder="Search receipt, customer, cheque" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" /></div>
          <div style={{ flex: '1 1 220px', maxWidth: 300 }}><PartyPicker type="customer" value={partyId ? customer.data?.party ?? null : null} onChange={(p) => set({ party_id: p ? String(p.id) : null })} aria-label="Customer" /></div>
          <div style={{ width: 200 }}><Select aria-label="Account" value={accountId} onChange={(e) => set({ money_account_id: e.target.value || null })}
            options={[{ value: '', label: 'All accounts' }, ...(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} /></div>
        </>}
        filters={<>
          <Field label="From" htmlFor="rc-from"><Input id="rc-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="rc-to"><Input id="rc-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
          <div style={{ width: 200, alignSelf: 'flex-end' }}><Select aria-label="Advance" value={unapplied} onChange={(e) => set({ unapplied: e.target.value || null })}
            options={[{ value: '', label: 'All payments' }, { value: 'true', label: 'With an advance left' }, { value: 'false', label: 'Fully applied' }]} /></div>
          <div style={{ width: 220, alignSelf: 'flex-end' }}><Select aria-label="Sort" options={SORTS} value={sort} onChange={(e) => set({ sort: e.target.value })} /></div>
        </>}>
        <DataTable caption="Payments received" columns={columns} rows={rows} loading={list.isPending} onRowClick={(r: { id: number }) => navigate(`/sales/payments/${r.id}`)} />
      </ListCard>
    </>
  )
}
