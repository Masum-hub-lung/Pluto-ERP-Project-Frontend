import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PartyType } from '../../api/parties'
import { useOutstanding, useSendStatements, type OutstandingRow } from '../../api/partyAccounts'
import { dhakaToday } from '../../api/platform'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SelectableTable } from '../../components/SelectableTable'
import { SummaryTile } from '../../components/SummaryTile'

/**
 * B7/C7 Outstanding (backlog P6.2-FE-08; 06 §17): each party's open balance in aging buckets — not due, 1–30, 31–60,
 * 61–90 and over 90 days past due on "as of" — with unapplied advances apart, from GET /parties/outstanding. Select
 * parties to e-mail their statements (POST /parties/statements/send). Every figure is the server's.
 */
export const BUCKETS: Array<{ key: string; label: string }> = [
  { key: 'not_due', label: 'Not due' }, { key: 'd1_30', label: '1–30 days' }, { key: 'd31_60', label: '31–60 days' }, { key: 'd61_90', label: '61–90 days' },
  { key: 'd90_plus', label: 'Over 90 days' }, { key: 'total', label: 'Total' },
]

export function PartyOutstanding({ type }: { type: PartyType }) {
  const { PageHeader, Select, Input, Field, EmptyState } = ds()
  const navigate = useNavigate()
  const { get, set, search, setSearch, page } = useListParams()
  const bucket = get('bucket'), asOf = get('as_of'), q = get('q'), sort = get('sort', '-total')
  const report = useOutstanding({ type, bucket: bucket || undefined, as_of: asOf || undefined, q: q || undefined, sort, page, per_page: 25 })
  const base = type === 'customer' ? '/customers' : '/suppliers'
  const totals = report.data?.totals as { parties?: number; advance?: string; current_page?: number; per_page?: number; last_page?: number } | undefined

  const rows = ((report.data?.rows ?? []) as unknown as OutstandingRow[]).map((r) => ({ id: r.party.id, name: r.party.name, code: r.party.code, ...r }))
  const amount = (key: string, label: string): DataColumn => ({ key, label: `${label} (৳)`, align: 'right', render: (v: string) => (v && v !== '0.00' ? <span className="lf-num">{formatTaka(v)}</span> : '') })
  const columns: DataColumn[] = [
    { key: 'name', label: type === 'customer' ? 'Customer' : 'Supplier', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.name}</span><span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}</span>
      </span>) },
    ...BUCKETS.map((b) => amount(b.key, b.label)),
    amount('advance', 'Advance'),
  ]
  const meta = totals?.last_page ? { current_page: totals.current_page ?? 1, per_page: totals.per_page ?? 25, total: totals.parties ?? 0, last_page: totals.last_page } : undefined
  const table = { caption: 'Outstanding', columns, rows, loading: report.isPending, onRowClick: (r: { id: number }) => navigate(`${base}/${r.id}/statement`),
    emptyState: <EmptyState icon="circle-check" title="Nothing outstanding" description={`No ${type} owes${type === 'supplier' ? ' you' : ''} anything on this date.`} /> }

  return (
    <>
      <PageHeader title={type === 'customer' ? 'Customers: outstanding' : 'Suppliers: outstanding'}
        description={type === 'customer' ? 'What each customer owes, by how late it is.' : 'What you owe each supplier, by how late it is.'} />
      <div className="lf-grid" data-testid="aging-tiles">
        {(report.data?.buckets ?? []).map((b) => (
          <SummaryTile key={b.key} label={BUCKETS.find((x) => x.key === b.key)?.label ?? b.key} value={formatTaka(b.amount, { symbol: true })}
            sub={`${b.count} document${b.count === 1 ? '' : 's'}`} tone={b.key === 'd90_plus' && b.amount !== '0.00' ? 'negative' : undefined} testId={`bucket-${b.key}`} />
        ))}
      </div>
      <ProblemBanner error={report.error} onRetry={() => void report.refetch()} />
      <ListCard label="Outstanding" meta={meta} onPage={(n) => set({ page: n === 1 ? null : String(n) })}
        cards={{ columns, rows, loading: report.isPending, onOpen: (r) => navigate(`${base}/${r.id}/statement`), mobileColumns: ['name', 'total', 'd90_plus'], empty: table.emptyState }}
        toolbar={<>
          <div style={{ flex: '1 1 240px', maxWidth: 340 }}><Input icon="search" placeholder={`Search ${type}`} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" /></div>
          <div style={{ width: 200 }}><Select aria-label="Bucket" value={bucket} onChange={(e) => set({ bucket: e.target.value || null })}
            options={[{ value: '', label: 'All' }, ...BUCKETS.filter((b) => b.key !== 'total').map((b) => ({ value: b.key, label: b.label }))]} /></div>
        </>}
        filters={<>
          <Field label="As of" htmlFor="os-asof"><Input id="os-asof" type="date" value={asOf} onChange={(e) => set({ as_of: e.target.value || null })} /></Field>
          <div style={{ width: 220, alignSelf: 'flex-end' }}><Select aria-label="Sort" value={sort} onChange={(e) => set({ sort: e.target.value })}
            options={[{ value: '-total', label: 'Sort: largest first' }, { value: '-d90_plus', label: 'Sort: most over 90 days' }, { value: 'name', label: 'Sort: name' }]} /></div>
        </>}>
        <SelectableTable {...table} actions={(ids, clear) => <SendStatements ids={ids} clear={clear} />} />
      </ListCard>
      {totals?.advance && totals.advance !== '0.00' && (
        <p style={{ color: 'var(--ink-muted)', fontSize: 13 }}>Unapplied advances across these {type}s: {formatTaka(totals.advance, { symbol: true })}.</p>
      )}
    </>
  )
}

/** E-mail statements for the selected parties: this financial year so far, with aging. */
function SendStatements({ ids, clear }: { ids: number[]; clear: () => void }) {
  const { Button } = ds()
  const { can } = useSession()
  const toast = useToast()
  const send = useSendStatements()
  const idem = useIdempotencyKey()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<unknown>(null)
  if (!can('parties.view')) return null
  const today = dhakaToday()
  // The financial year runs July–June (CLAUDE.md); dates are not money, so working out its first day here is fine.
  const fyStart = `${Number(today.slice(5, 7)) >= 7 ? today.slice(0, 4) : String(Number(today.slice(0, 4)) - 1)}-07-01`

  async function run() {
    setError(null)
    try {
      const job = await send.mutateAsync({ body: { party_ids: ids, date_from: fyStart, date_to: today, include_aging: true }, idempotencyKey: idem.key })
      idem.reset()
      setOpen(false)
      clear()
      toast(job.error ? { tone: 'warning', title: 'Statements sent', description: job.error } : { tone: 'positive', title: `Statement${ids.length === 1 ? '' : 's'} sent`, description: `${ids.length} e-mailed with the aging summary.` })
    } catch (e) {
      setError(e)
    }
  }

  return (
    <>
      <Button size="sm" variant="primary" icon="arrow-up-right" onClick={() => setOpen(true)} data-testid="send-statements">Send statements</Button>
      {open && (
        <ConfirmDialog title={`E-mail ${ids.length} statement${ids.length === 1 ? '' : 's'}?`} confirmLabel="Send" tone="info" loading={send.isPending} onConfirm={() => void run()}
          onClose={() => setOpen(false)} description="Each party gets its statement for this financial year so far, with the aging summary, at the e-mail on file.">
          <ProblemBanner error={error} />
        </ConfirmDialog>
      )}
    </>
  )
}
