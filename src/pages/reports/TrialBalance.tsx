import { Link, useNavigate } from 'react-router-dom'
import { draftsOf, useReport, type ReportRow } from '../../api/reports'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ReportLayout } from '../../components/report/ReportLayout'
import { StatementTable } from '../../components/report/StatementTable'
import { BranchFilter, ChoiceFilter, DateFilter } from './filters'

/**
 * H15 Trial balance (backlog P9.2-FE-02; 06 §17): closing debit and credit of every ledger (or group) as of a date,
 * from GET /reports/trial-balance. Group/ledger toggle, Dr/Cr columns and the totals row are the API's; the
 * agreement check shows green or the difference; the side panel lists drafts the report leaves out (BR-005).
 * A ledger row opens H7, a group row the account group.
 */
export function TrialBalance() {
  const navigate = useNavigate()
  const { can } = useSession()
  const { get, set } = useListParams()
  const query = { as_of: get('as_of') || undefined, level: get('level') || undefined, branch_id: get('branch_id') || undefined }
  const r = useReport('trial-balance', query)
  const drill = can('accounting.view')
    ? (row: ReportRow) => navigate(row.kind === 'ledger' ? `/accounting/ledgers/${row.ledger_id}` : `/accounting/groups/${row.group_id}`)
    : undefined

  return (
    <ReportLayout title="Trial balance" description="Closing debit and credit of every ledger (or group) as of a date, with checks."
      path="trial-balance" query={query} report={r.data} loading={r.isFetching} error={r.error} onRetry={() => void r.refetch()}
      filters={<>
        <DateFilter id="tb-asof" label="As of" value={query.as_of ?? ''} onChange={(v) => set({ as_of: v || null })} />
        <ChoiceFilter label="Detail" value={query.level ?? 'ledger'} onChange={(v) => set({ level: v === 'ledger' ? null : v })}
          options={[{ value: 'ledger', label: 'Ledgers' }, { value: 'group', label: 'Groups' }]} />
        <BranchFilter value={query.branch_id ?? ''} onChange={(v) => set({ branch_id: v || null })} />
      </>}
      aside={r.data && <Drafts report={r.data} />}>
      {r.data && <StatementTable report={r.data} testId="trial-balance"
        onOpen={drill ? (row) => (row.kind === 'ledger' || row.kind === 'group' ? drill(row) : undefined) : undefined} />}
    </ReportLayout>
  )
}

function Drafts({ report }: { report: Parameters<typeof draftsOf>[0] }) {
  const { Badge } = ds()
  const d = draftsOf(report)
  return (
    <div data-testid="tb-drafts">
      <h3>Not in this report</h3>
      {d.count === 0 ? <p style={{ color: 'var(--ink-muted)', fontSize: 13, margin: 0 }}>No drafts or vouchers waiting for approval.</p> : (
        <>
          <p style={{ color: 'var(--ink-muted)', fontSize: 13, marginTop: 0 }}>
            {d.count} voucher{d.count === 1 ? '' : 's'} not posted yet ({formatTaka(d.total, { symbol: true })}). Post them to include them.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {d.items.map((v) => (
              <li key={v.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                <Link to={`/accounting/vouchers/${v.id}`}>{v.voucher_number}</Link>
                <span className="lf-num">{formatTaka(v.amount)}</span>
                <Badge tone={v.status === 'submitted' ? 'info' : 'neutral'}>{v.status === 'submitted' ? 'Awaiting approval' : 'Draft'}</Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
