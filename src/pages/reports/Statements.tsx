import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Ledger } from '../../api/contract.gen'
import { totalsOf, useReport, type ReportRow } from '../../api/reports'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { LedgerPicker } from '../../components/pickers/LedgerPicker'
import { ReportLayout } from '../../components/report/ReportLayout'
import { StatementTable } from '../../components/report/StatementTable'
import { BranchFilter, ChoiceFilter, DateFilter } from './filters'

/**
 * H16 Profit and loss, H17 Balance sheet, H18 Cash flow and H19 General ledger (backlog P9.2-FE-03, P9.2-FE-04;
 * 06 §17). Each page sets its filters in the URL, loads its GET /reports/… and shows the API's statement; ledger rows
 * open H7 for users with accounting.view. Key figures in the asides are API totals, never computed here.
 */
const COMPARE = [{ value: 'none', label: 'None' }, { value: 'prior', label: 'Previous year' }]
const DETAIL = [{ value: 'ledgers', label: 'Ledgers' }, { value: 'totals', label: 'Totals' }]

function useLedgerDrill() {
  const navigate = useNavigate()
  const { can } = useSession()
  return can('accounting.view') ? (row: ReportRow) => { if (row.ledger_id) navigate(`/accounting/ledgers/${row.ledger_id}`) } : undefined
}

function KeyFigures({ items }: { items: Array<[string, string | null | undefined]> }) {
  return (
    <div>
      <h3>Key figures</h3>
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', margin: 0, fontSize: 13 }}>
        {items.filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}><dt style={{ color: 'var(--ink-muted)' }}>{k}</dt><dd style={{ margin: 0, textAlign: 'right' }} className="lf-num">{v}</dd></div>
        ))}
      </dl>
    </div>
  )
}

export function ProfitAndLoss() {
  const { get, set } = useListParams()
  const drill = useLedgerDrill()
  const query = { date_from: get('date_from') || undefined, date_to: get('date_to') || undefined, compare: get('compare') || undefined,
    detail: get('detail') || undefined, branch_id: get('branch_id') || undefined }
  const r = useReport('profit-and-loss', query)
  const t = totalsOf(r.data)
  const margin = (r.data?.meta as { gross_margin_pct?: string | null } | undefined)?.gross_margin_pct

  return (
    <ReportLayout title="Profit and loss" description="Revenue, COGS, gross profit, operating expenses, other income, finance costs; compared with last year."
      path="profit-and-loss" query={query} report={r.data} loading={r.isFetching} error={r.error} onRetry={() => void r.refetch()}
      filters={<>
        <DateFilter id="pl-from" label="From" value={query.date_from ?? ''} onChange={(v) => set({ date_from: v || null })} />
        <DateFilter id="pl-to" label="To" value={query.date_to ?? ''} onChange={(v) => set({ date_to: v || null })} />
        <ChoiceFilter label="Compare" value={query.compare ?? 'none'} options={COMPARE} onChange={(v) => set({ compare: v === 'none' ? null : v })} />
        <ChoiceFilter label="Detail" value={query.detail ?? 'ledgers'} options={DETAIL} onChange={(v) => set({ detail: v === 'ledgers' ? null : v })} />
        <BranchFilter value={query.branch_id ?? ''} onChange={(v) => set({ branch_id: v || null })} />
      </>}
      aside={r.data && <KeyFigures items={[['Revenue', formatTaka(t.revenue, { symbol: true })], ['Gross profit', formatTaka(t.gross_profit, { symbol: true })],
        ['Gross margin', margin ? `${margin}%` : '—'], ['Net profit', formatTaka(t.net_profit, { symbol: true })],
        ['Net profit last year', t.prior_net_profit ? formatTaka(t.prior_net_profit, { symbol: true }) : undefined]]} />}>
      {r.data && <StatementTable report={r.data} onOpen={drill} testId="profit-and-loss" />}
    </ReportLayout>
  )
}

export function BalanceSheet() {
  const { get, set } = useListParams()
  const drill = useLedgerDrill()
  const query = { as_of: get('as_of') || undefined, compare: get('compare') || undefined, detail: get('detail') || undefined }
  const r = useReport('balance-sheet', query)
  const t = totalsOf(r.data)

  return (
    <ReportLayout title="Balance sheet" description="Assets, equity and liabilities as of a date, compared with last year end."
      path="balance-sheet" query={query} report={r.data} loading={r.isFetching} error={r.error} onRetry={() => void r.refetch()}
      filters={<>
        <DateFilter id="bs-asof" label="As of" value={query.as_of ?? ''} onChange={(v) => set({ as_of: v || null })} />
        <ChoiceFilter label="Compare" value={query.compare ?? 'none'} options={[{ value: 'none', label: 'None' }, { value: 'prior', label: 'Last year end' }]}
          onChange={(v) => set({ compare: v === 'none' ? null : v })} />
        <ChoiceFilter label="Detail" value={query.detail ?? 'ledgers'} options={DETAIL} onChange={(v) => set({ detail: v === 'ledgers' ? null : v })} />
      </>}
      aside={r.data && <KeyFigures items={[['Total assets', formatTaka(t.assets, { symbol: true })], ['Total liabilities', formatTaka(t.liabilities, { symbol: true })],
        ['Total equity', formatTaka(t.equity, { symbol: true })], ['Profit for the period', formatTaka(t.profit_for_period, { symbol: true })]]} />}>
      {r.data && <StatementTable report={r.data} onOpen={drill} testId="balance-sheet" />}
    </ReportLayout>
  )
}

export function CashFlow() {
  const { get, set } = useListParams()
  const query = { date_from: get('date_from') || undefined, date_to: get('date_to') || undefined }
  const r = useReport('cash-flow', query)
  const t = totalsOf(r.data)

  return (
    <ReportLayout title="Cash flow statement" description="Indirect method reconciled to the cash and bank group."
      path="cash-flow" query={query} report={r.data} loading={r.isFetching} error={r.error} onRetry={() => void r.refetch()}
      filters={<>
        <DateFilter id="cf-from" label="From" value={query.date_from ?? ''} onChange={(v) => set({ date_from: v || null })} />
        <DateFilter id="cf-to" label="To" value={query.date_to ?? ''} onChange={(v) => set({ date_to: v || null })} />
      </>}
      aside={r.data && <KeyFigures items={[['Operating', formatTaka(t.operating, { symbol: true })], ['Investing', formatTaka(t.investing, { symbol: true })],
        ['Financing', formatTaka(t.financing, { symbol: true })], ['Cash and bank at the end', formatTaka(t.closing_cash, { symbol: true })]]} />}>
      {r.data && <StatementTable report={r.data} testId="cash-flow" />}
    </ReportLayout>
  )
}

export function GeneralLedger() {
  const { Badge, Field, IconButton } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const { get, set } = useListParams()
  const [picked, setPicked] = useState<Array<{ id: number; label: string }>>([])
  const ids = get('ledger_ids')
  const query = { date_from: get('date_from') || undefined, date_to: get('date_to') || undefined, ledger_ids: ids || undefined, group_by: get('group_by') || undefined }
  const r = useReport('general-ledger', query)
  const chosen = ids ? ids.split(',') : []
  const labelOf = (id: string) => picked.find((p) => String(p.id) === id)?.label ?? `Ledger #${id}`

  function add(l: Ledger | null) {
    if (!l || chosen.includes(String(l.id))) return
    setPicked((p) => [...p, { id: l.id, label: `${l.code} · ${l.name}` }])
    set({ ledger_ids: [...chosen, String(l.id)].join(',') })
  }

  return (
    <ReportLayout title="General ledger" description="One block per chosen ledger: opening, entries, closing."
      path="general-ledger" query={query} report={r.data} loading={r.isFetching} error={r.error} onRetry={() => void r.refetch()}
      filters={<>
        <DateFilter id="gl-from" label="From" value={query.date_from ?? ''} onChange={(v) => set({ date_from: v || null })} />
        <DateFilter id="gl-to" label="To" value={query.date_to ?? ''} onChange={(v) => set({ date_to: v || null })} />
        <ChoiceFilter label="Show" value={query.group_by ?? 'ledger'} onChange={(v) => set({ group_by: v === 'ledger' ? null : v })}
          options={[{ value: 'ledger', label: 'Entries' }, { value: 'month', label: 'By month' }]} />
        <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <Field label="Ledgers (all with entries if none)" htmlFor="gl-ledger"><LedgerPicker id="gl-ledger" value={null} onChange={add} aria-label="Add a ledger" /></Field>
        </div>
        {chosen.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }} data-testid="gl-chosen">
            {chosen.map((id) => (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <Badge tone="neutral">{labelOf(id)}</Badge>
                <IconButton icon="x" size="sm" label={`Remove ${labelOf(id)}`} onClick={() => set({ ledger_ids: chosen.filter((c) => c !== id).join(',') || null })} />
              </span>
            ))}
          </div>
        )}
      </>}>
      {r.data && <StatementTable report={r.data} testId="general-ledger"
        onOpen={can('accounting.view') ? (row) => navigate(`/accounting/ledgers/${row.ledger_id}`) : undefined}
        cell={(c, row) => (c.key === 'voucher_number' && row.voucher_id && can('accounting.view')
          ? <a href={`/accounting/vouchers/${row.voucher_id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/accounting/vouchers/${row.voucher_id}`) }}>{String(row.voucher_number)}</a>
          : undefined)} />}
    </ReportLayout>
  )
}
