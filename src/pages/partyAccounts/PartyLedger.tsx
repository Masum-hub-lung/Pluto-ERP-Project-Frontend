import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useParty, type PartyType } from '../../api/parties'
import { usePartyLedger } from '../../api/partyAccounts'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'
import { shortDate } from '../purchases/BillList'
import { voucherPath } from './links'

/**
 * B6/C6 Party ledger (backlog P6.2-FE-07): the party's ledger for a date range (default: the financial year so far),
 * the opening line, every posted line with its running balance and Dr/Cr side, and the closing — all from
 * GET /parties/{id}/ledger. The closing equals the party's balance on B4/C4.
 */
export function PartyLedger({ type }: { type: PartyType }) {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const party = useParty(id)
  const { get, set } = useListParams()
  const from = get('date_from'), to = get('date_to')
  const ledger = usePartyLedger(id, { date_from: from || undefined, date_to: to || undefined })
  const { PageHeader, Card, DataTable, Field, Input, Button } = ds()
  const back = type === 'customer' ? '/customers' : '/suppliers'

  if ((party.error instanceof ApiError && party.error.status === 404) || (party.data && party.data.party.party_type !== type)) {
    return <NotFound what={`this ${type}`} back={back} backLabel={type === 'customer' ? 'Customers' : 'Suppliers'} />
  }
  if (party.error) return <ProblemBanner error={party.error} onRetry={() => void party.refetch()} />
  if (!party.data) return <PageSkeleton template="report" />
  const p = party.data.party
  const l = ledger.data
  const side = (s?: string) => (s === 'cr' ? 'Cr' : 'Dr')
  const columns: DataColumn[] = [
    { key: 'date', label: 'Date' },
    { key: 'voucher', label: 'Voucher', render: (_v, r) => (r.path ? <Link to={r.path}>{r.voucher}</Link> : <span className="lf-code">{r.voucher}</span>) },
    { key: 'particulars', label: 'Particulars', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span>{r.particulars}</span>{r.narration && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.narration}</span>}
      </span>) },
    { key: 'debit', label: 'Debit (৳)', type: 'amount' },
    { key: 'credit', label: 'Credit (৳)', type: 'amount' },
    { key: 'balance', label: 'Balance (৳)', align: 'right', render: (_v, r) => <span className="lf-num" data-testid={`ledger-balance-${r.id}`}>{formatTaka(r.balance)} {r.side}</span> },
  ]
  const rows = [
    ...(l ? [{ id: 'opening', date: shortDate(String(l.period.from)), voucher: '', path: null, particulars: 'Opening balance', narration: null, debit: '', credit: '', balance: l.opening, side: side(l.opening_side) }] : []),
    ...(l?.lines ?? []).map((x, i) => ({ id: i, date: shortDate(x.date), voucher: x.voucher_number, path: voucherPath(x.entry_type, x.voucher_id), particulars: x.particulars,
      narration: x.narration, debit: x.debit === '0.00' ? '' : x.debit, credit: x.credit === '0.00' ? '' : x.credit, balance: x.balance, side: side(x.balance_side) })),
  ]

  return (
    <>
      <PageHeader eyebrow={p.name} title="Ledger" description={`${p.code} · every posted entry on ${p.name}'s account`}
        actions={<Button variant="ghost" icon="arrow-left" onClick={() => navigate(`${back}/${p.id}`)}>Back to {type}</Button>} />
      <div className="lf-grid">
        <SummaryTile label="Opening" value={l ? `${formatTaka(l.opening, { symbol: true })} ${side(l.opening_side)}` : '…'} sub={l ? shortDate(String(l.period.from)) : ''} />
        <SummaryTile label="Debits / credits" value={l ? `${formatTaka(l.total_debit, { symbol: true })} / ${formatTaka(l.total_credit, { symbol: true })}` : '…'} sub="In this period" />
        <SummaryTile label="Closing" testId="ledger-closing" value={l ? `${formatTaka(l.closing, { symbol: true })} ${side(l.closing_side)}` : '…'} sub={l ? shortDate(String(l.period.to)) : ''} />
      </div>
      <ProblemBanner error={ledger.error} onRetry={() => void ledger.refetch()} />
      <Card title="Entries" padding="none" actions={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="From" htmlFor="pl-from"><Input id="pl-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="pl-to"><Input id="pl-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
          {(from || to) && <Button size="sm" variant="ghost" onClick={() => set({ date_from: null, date_to: null })}>This year</Button>}
        </div>}>
        <div style={{ overflowX: 'auto' }} data-testid="party-ledger"><DataTable caption="Ledger" columns={columns} rows={rows} loading={ledger.isPending} /></div>
      </Card>
    </>
  )
}
