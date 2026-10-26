import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Voucher } from '../../api/contract.gen'
import { useVouchers } from '../../api/accounting'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { shortDate } from '../purchases/BillList'
import { canEnter, entryTypeLabel, VOUCHER_TYPES, VoucherStatusBadge } from './common'

/**
 * H8 Vouchers and day book (Acc-Vouchers.dc.html; backlog P7.2-FE-07): every journal entry — vouchers and the entries
 * documents post — newest first, with type tabs (Day book = all), status, dates and search in the URL. New voucher
 * offers the types the user may enter (R-09).
 */
const TABS = [{ value: '', label: 'Day book' }, ...VOUCHER_TYPES.map((t) => ({ value: t.value, label: t.label })), { value: 'reversal', label: 'Reversals' }]
const STATUSES = [{ value: '', label: 'All statuses' }, { value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Awaiting approval' }, { value: 'rejected', label: 'Rejected' },
  { value: 'posted', label: 'Posted' }, { value: 'reversed', label: 'Reversed' }]

export function VoucherList() {
  const { PageHeader, Button, Input, Select, DataTable, EmptyState, Field, Tabs, Menu } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const { get, set, search, setSearch, page } = useListParams()
  const type = get('entry_type'), status = get('status'), from = get('date_from'), to = get('date_to'), q = get('q'), sort = get('sort', '-date')
  const list = useVouchers({ entry_type: type || undefined, status: status || undefined, date_from: from || undefined, date_to: to || undefined, q: q || undefined, sort, page, per_page: 25 })
  const rows = (list.data?.data ?? []).map((v: Voucher) => ({ id: v.id, number: v.voucher_number, date: shortDate(v.entry_date), type: entryTypeLabel(v.entry_type),
    narration: v.narration ?? '', amount: v.total_debit, status: v.status, by: v.created_by?.name ?? '' }))
  const columns: DataColumn[] = [
    { key: 'date', label: 'Date' },
    { key: 'number', label: 'Voucher', mono: true },
    { key: 'type', label: 'Type' },
    { key: 'narration', label: 'Narration', render: (v: string) => <span style={{ display: 'inline-block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span> },
    { key: 'status', label: 'Status', render: (v) => <VoucherStatusBadge status={v} /> },
    { key: 'amount', label: 'Amount (৳)', type: 'amount' },
  ]
  const types = VOUCHER_TYPES.filter((t) => canEnter(can, t.value))
  const filtered = !!(q || status || from || to)
  const empty = filtered
    ? <EmptyState icon="search" title="No vouchers match" action={<Button variant="secondary" onClick={() => { setSearch(''); set({ q: null, status: null, date_from: null, date_to: null }) }}>Clear filters</Button>} />
    : <EmptyState icon="book-open-text" title="Nothing posted yet" description="Vouchers and the entries invoices, bills and receipts post appear here." />

  return (
    <>
      <PageHeader eyebrow="Accounting" title="Vouchers" description="Journals, payments, receipts and contras, and every entry posted by documents."
        actions={types.length > 0 && (
          <div style={{ position: 'relative' }}>
            <Button variant="primary" icon="plus" iconRight="chevron-down" onClick={() => setMenu((m) => !m)} data-testid="new-voucher">New voucher</Button>
            {menu && <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 200, zIndex: 10 }}
              items={types.map((t) => ({ label: `${t.label} (${t.prefix})`, onClick: () => { setMenu(false); navigate(`/accounting/vouchers/new/${t.path}`) } }))} />}
          </div>
        )} />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <div style={{ overflowX: 'auto', marginBottom: 8 }}>
        <Tabs key={type} items={TABS} value={type} onChange={(t) => set({ entry_type: t || null })} />
      </div>
      <ListCard label="Vouchers" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(`/accounting/vouchers/${r.id}`), mobileColumns: ['number', 'date', 'narration', 'amount'], empty }}
        toolbar={<>
          <div style={{ flex: '1 1 240px', maxWidth: 340 }}><Input icon="search" placeholder="Search number, narration, reference" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search vouchers" /></div>
          <div style={{ width: 200 }}><Select aria-label="Status" value={status} onChange={(e) => set({ status: e.target.value || null })} options={STATUSES} /></div>
        </>}
        filters={<>
          <Field label="From" htmlFor="vl-from"><Input id="vl-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="vl-to"><Input id="vl-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
          <div style={{ width: 200, alignSelf: 'flex-end' }}><Select aria-label="Sort" value={sort} onChange={(e) => set({ sort: e.target.value })}
            options={[{ value: '-date', label: 'Sort: newest first' }, { value: 'date', label: 'Sort: oldest first' }, { value: '-amount', label: 'Sort: amount, high to low' }]} /></div>
        </>}>
        <DataTable caption="Vouchers" columns={columns} rows={rows} loading={list.isPending} onRowClick={(r: { id: number }) => navigate(`/accounting/vouchers/${r.id}`)} />
      </ListCard>
    </>
  )
}
