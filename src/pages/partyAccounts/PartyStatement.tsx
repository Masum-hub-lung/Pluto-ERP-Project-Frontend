import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useParty, type PartyType } from '../../api/parties'
import { downloadStatementPdf, usePartyStatement, useSendStatements } from '../../api/partyAccounts'
import { useToast } from '../../app/toast'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'
import { shortDate } from '../purchases/BillList'
import { BUCKETS } from './PartyOutstanding'

/**
 * B8/C8 Statement of account (backlog P6.2-FE-08): opening, every posted line with its running balance, closing and
 * the aging, for a date range, from GET /parties/{id}/statement?aging=true. Download the PDF or e-mail it to the
 * party's address (POST /parties/statements/send).
 */
export function PartyStatement({ type }: { type: PartyType }) {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const toast = useToast()
  const party = useParty(id)
  const { get, set } = useListParams()
  const from = get('date_from'), to = get('date_to')
  const range = { date_from: from || undefined, date_to: to || undefined, aging: 'true' }
  const statement = usePartyStatement(id, range)
  const send = useSendStatements()
  const idem = useIdempotencyKey()
  const [sendError, setSendError] = useState<unknown>(null)
  const { PageHeader, Card, DataTable, Field, Input, Button } = ds()
  const back = type === 'customer' ? '/customers' : '/suppliers'

  if ((party.error instanceof ApiError && party.error.status === 404) || (party.data && party.data.party.party_type !== type)) {
    return <NotFound what={`this ${type}`} back={back} backLabel={type === 'customer' ? 'Customers' : 'Suppliers'} />
  }
  if (party.error) return <ProblemBanner error={party.error} onRetry={() => void party.refetch()} />
  if (!party.data) return <PageSkeleton template="report" />
  const p = party.data.party
  const s = statement.data
  const summary = (s?.summary ?? {}) as { opening?: string; opening_side?: string; total_debit?: string; total_credit?: string; closing?: string; closing_side?: string }
  const period = (s?.period ?? {}) as { from?: string; to?: string }
  const side = (x?: string) => (x === 'cr' ? 'Cr' : 'Dr')

  async function pdf() {
    try { await downloadStatementPdf(id, p.code, range) } catch { toast({ tone: 'negative', title: 'Could not download the statement', description: 'Try again in a moment.' }) }
  }
  async function email() {
    setSendError(null)
    try {
      const job = await send.mutateAsync({ body: { party_ids: [id], date_from: period.from!, date_to: period.to!, include_aging: true }, idempotencyKey: idem.key })
      idem.reset()
      toast(job.error ? { tone: 'warning', title: 'Not sent', description: `${p.name} has no e-mail on file.` } : { tone: 'positive', title: 'Statement sent', description: `E-mailed to ${p.email}` })
    } catch (e) {
      setSendError(e)
    }
  }

  const columns: DataColumn[] = [
    { key: 'date', label: 'Date' }, { key: 'voucher', label: 'Voucher', mono: true }, { key: 'particulars', label: 'Particulars' },
    { key: 'debit', label: 'Debit (৳)', type: 'amount' }, { key: 'credit', label: 'Credit (৳)', type: 'amount' },
    { key: 'balance', label: 'Balance (৳)', align: 'right', render: (_v, r) => <span className="lf-num">{formatTaka(r.balance)} {r.side}</span> },
  ]
  const rows = [
    ...(s ? [{ id: 'opening', date: period.from ? shortDate(period.from) : '', voucher: '', particulars: 'Opening balance', debit: '', credit: '', balance: summary.opening ?? '0.00', side: side(summary.opening_side) }] : []),
    ...(s?.lines ?? []).map((l, i) => ({ id: i, date: shortDate(l.date), voucher: l.voucher_number, particulars: l.particulars, debit: l.debit === '0.00' ? '' : l.debit,
      credit: l.credit === '0.00' ? '' : l.credit, balance: l.balance, side: side(l.balance_side) })),
  ]

  return (
    <>
      <PageHeader eyebrow={p.name} title="Statement of account" description={s ? `${s.statement_no} · ${period.from ? shortDate(period.from) : ''} – ${period.to ? shortDate(period.to) : ''}` : p.code}
        actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="ghost" icon="arrow-left" onClick={() => navigate(`${back}/${p.id}`)}>Back to {type}</Button>
          <Button variant="secondary" icon="download" onClick={() => void pdf()} data-testid="statement-pdf">PDF</Button>
          <Button variant="primary" icon="arrow-up-right" loading={send.isPending} disabled={!s || send.isPending} onClick={() => void email()} data-testid="statement-email">E-mail</Button>
        </div>} />
      <ProblemBanner error={statement.error ?? sendError} onRetry={statement.error ? () => void statement.refetch() : undefined} />
      <div className="lf-grid">
        <SummaryTile label="Opening" value={s ? `${formatTaka(summary.opening ?? '0.00', { symbol: true })} ${side(summary.opening_side)}` : '…'} />
        <SummaryTile label="Debits / credits" value={s ? `${formatTaka(summary.total_debit ?? '0.00', { symbol: true })} / ${formatTaka(summary.total_credit ?? '0.00', { symbol: true })}` : '…'} />
        <SummaryTile label={summary.closing_side === 'cr' ? (type === 'customer' ? 'We owe them' : 'You owe them') : 'They owe you'} testId="statement-closing"
          value={s ? formatTaka(summary.closing ?? '0.00', { symbol: true }) : '…'} />
      </div>
      {s?.aging && (
        <div className="lf-grid" data-testid="statement-aging">
          {s.aging.map((b) => <SummaryTile key={b.key} label={BUCKETS.find((x) => x.key === b.key)?.label ?? b.key} value={formatTaka(b.amount, { symbol: true })} />)}
        </div>
      )}
      <Card title="Entries" padding="none" actions={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="From" htmlFor="st-from"><Input id="st-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="st-to"><Input id="st-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
        </div>}>
        <div style={{ overflowX: 'auto' }} data-testid="statement-lines"><DataTable caption="Statement" columns={columns} rows={rows} loading={statement.isPending} /></div>
      </Card>
    </>
  )
}
