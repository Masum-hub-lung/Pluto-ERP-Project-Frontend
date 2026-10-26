import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Ledger } from '../../api/contract.gen'
import { monthlyOf, useLedger, useLedgerEntries } from '../../api/accounting'
import { currentFiscalYear, dhakaToday, useFiscalYears } from '../../api/platform'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'
import { shortDate } from '../purchases/BillList'
import { DrCr, drCrText, entryTypeLabel, natureLabel } from './common'

/**
 * H7 Ledger details (Acc-Ledger.dc.html; backlog P7.2-FE-04): the opening balance, the posted entries in the range
 * with their running balance (each opens its voucher), totals, closing, and the closing balance at each month end —
 * all from GET /ledgers/{id}/entries. Range presets: this month, this financial year, custom. Print uses the page.
 */
export function LedgerDetails() {
  const id = Number(useParams().id)
  const q = useLedger(id)
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this ledger" back="/accounting/ledgers" backLabel="Ledgers" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="report" />
  return <Details l={q.data} />
}

function Details({ l }: { l: Ledger }) {
  const { PageHeader, Button, Card, DataTable, Field, Input, Segmented, Switch, Badge, Pagination, EmptyState } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const years = useFiscalYears()
  const fy = currentFiscalYear(years.data)
  const today = dhakaToday()
  const { get, set, search, setSearch, page } = useListParams()
  const preset = get('period', 'fy')
  const monthStart = `${today.slice(0, 8)}01`
  const from = preset === 'month' ? monthStart : preset === 'custom' ? get('date_from', fy?.start_date ?? monthStart) : fy?.start_date
  const to = preset === 'custom' ? get('date_to', today) : today
  const [narration, setNarration] = useState(true)
  const q = useLedgerEntries(l.id, { date_from: from, date_to: to, narration: get('q') || undefined, page })
  const s = q.data
  const cols: DataColumn[] = [
    { key: 'date', label: 'Date' },
    { key: 'voucher', label: 'Voucher', render: (_v, r) => <Link to={`/accounting/vouchers/${r.voucherId}`} onClick={(e) => e.stopPropagation()}>{r.voucher}</Link> },
    { key: 'particulars', label: 'Particulars', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span>{r.particulars || entryTypeLabel(r.type)}</span>
        {narration && r.narration && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.narration}</span>}
      </span>) },
    { key: 'debit', label: 'Debit (৳)', type: 'amount' },
    { key: 'credit', label: 'Credit (৳)', type: 'amount' },
    { key: 'balance', label: 'Balance (৳)', align: 'right', render: (_v, r) => <DrCr amount={r.balance} side={r.side} /> },
  ]
  const rows = (s?.lines ?? []).map((x, i) => ({ id: `${x.voucher_id}-${i}`, voucherId: x.voucher_id, date: shortDate(x.date), voucher: x.voucher_number, type: x.entry_type,
    particulars: x.particulars, narration: x.narration, debit: x.debit === '0.00' ? '' : x.debit, credit: x.credit === '0.00' ? '' : x.credit, balance: x.balance, side: x.balance_side }))
  const months = s ? monthlyOf(s) : []

  return (
    <>
      <PageHeader eyebrow={`Ledger · ${natureLabel(l.nature)}`} title={<span data-testid="ledger-title">{l.code} · {l.name}</span>}
        description={<>{l.group_path.join(' › ')} {!l.is_active && <Badge tone="neutral">Inactive</Badge>}</>}
        actions={<>
          <Button variant="ghost" icon="printer" onClick={() => window.print()}>Print</Button>
          {can('accounting.edit') && <Button variant="secondary" icon="pencil" onClick={() => navigate(`/accounting/ledgers/${l.id}/edit`)} data-testid="edit-ledger">Edit</Button>}
        </>} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
        <Segmented options={[{ value: 'month', label: 'This month' }, { value: 'fy', label: 'This year' }, { value: 'custom', label: 'Custom' }]} value={preset}
          onChange={(p) => set({ period: p === 'fy' ? null : p })} />
        {preset === 'custom' && <>
          <Field label="From" htmlFor="le-from"><Input id="le-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="le-to"><Input id="le-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
        </>}
        <div style={{ flex: '1 1 200px', maxWidth: 300 }}><Input icon="search" placeholder="Search narration" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search narration" /></div>
        <Switch label="Show narration" checked={narration} onChange={setNarration} />
      </div>
      <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
      {s && (
        <div className="lf-grid">
          <SummaryTile label="Opening" testId="ledger-opening" value={drCrText(s.opening, s.opening_side)} sub={`On ${shortDate(String(s.period.from))}`} />
          <SummaryTile label="Debits" value={formatTaka(s.total_debit)} sub="In this range" />
          <SummaryTile label="Credits" value={formatTaka(s.total_credit)} sub="In this range" />
          <SummaryTile label="Closing" testId="ledger-closing" value={drCrText(s.closing, s.closing_side)} sub={`On ${shortDate(String(s.period.to))}`} />
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', marginTop: 16 }}>
        <div style={{ flex: '3 1 520px', minWidth: 0 }}>
          <Card title="Entries" padding="none">
            <div style={{ overflowX: 'auto' }} data-testid="ledger-entries">
              <DataTable caption="Ledger entries" columns={cols} rows={rows} loading={q.isPending}
                emptyState={<EmptyState icon="file-text" title="No entries in this range" description="The opening and closing balances are shown above." />}
                onRowClick={(r: { voucherId: number }) => navigate(`/accounting/vouchers/${r.voucherId}`)} />
            </div>
            {s?.meta && s.meta.last_page > 1 && (
              <div style={{ padding: 12 }}><Pagination page={s.meta.current_page} pageCount={s.meta.last_page} total={s.meta.total} pageSize={s.meta.per_page}
                onChange={(p) => set({ page: p === 1 ? null : String(p) })} /></div>
            )}
          </Card>
        </div>
        <div style={{ flex: '1 1 240px' }}>
          <Card title="Month-end balances">
            {months.length === 0
              ? <p style={{ margin: 0, color: 'var(--ink-muted)' }}>No entries in this range.</p>
              : <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="ledger-monthly">
                  <tbody>{months.map((m) => (
                    <tr key={m.month} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '6px 0' }}>{monthName(m.month)}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right' }}><DrCr amount={m.closing} side={m.closing_side} /></td>
                    </tr>))}</tbody>
                </table>}
          </Card>
        </div>
      </div>
    </>
  )
}

const monthName = (ym: string) => {
  const [y, m] = ym.split('-')
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y}`
}
