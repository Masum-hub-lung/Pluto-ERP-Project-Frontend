import { useNavigate } from 'react-router-dom'
import { overviewParts, useAccountingOverview } from '../../api/accounting'
import { useApprovals } from '../../api/approvals'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { WidgetError } from '../../components/WidgetError'
import { shortDate } from '../purchases/BillList'
import { canEnter, DrCr, drCrText, entryTypeLabel, VOUCHER_TYPES, VoucherStatusBadge } from './common'

/**
 * H1 Accounting overview (Accounting.dc.html H1; backlog P7.2-FE-11): the four tiles, the books-health checklist, the
 * primary groups' balances, the approvals waiting and the latest vouchers — all from GET /accounting/overview and
 * GET /approvals — plus shortcuts to enter a voucher.
 */
export function AccountingOverview() {
  const { PageHeader, Button, Card, DataTable, Badge } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const q = useAccountingOverview()
  const approvals = useApprovals({ status: 'pending' })
  if (q.error) return <><PageHeader title="Accounting" /><ProblemBanner error={q.error} onRetry={() => void q.refetch()} /></>
  if (!q.data) return <PageSkeleton template="report" />
  const { totals, rows, groups } = overviewParts(q.data)
  const checks = q.data.checks ?? []
  const cols: DataColumn[] = [
    { key: 'date', label: 'Date' }, { key: 'number', label: 'Voucher', mono: true }, { key: 'type', label: 'Type' },
    { key: 'narration', label: 'Narration' }, { key: 'status', label: 'Status', render: (v) => <VoucherStatusBadge status={v} /> },
    { key: 'amount', label: 'Amount (৳)', type: 'amount' },
  ]
  const recent = rows.map((r) => ({ id: r.id, date: shortDate(r.date), number: r.voucher_number, type: entryTypeLabel(r.entry_type), narration: r.narration ?? '', status: r.status, amount: r.amount }))
  const shortcuts = VOUCHER_TYPES.filter((t) => canEnter(can, t.value))

  return (
    <>
      <PageHeader eyebrow="Books" title="Accounting" description="The state of the books today."
        actions={<>
          <Button variant="ghost" icon="list-tree" onClick={() => navigate('/accounting/chart')}>Chart of accounts</Button>
          {shortcuts.map((t) => <Button key={t.value} variant={t.value === 'journal' ? 'primary' : 'secondary'} icon="plus" onClick={() => navigate(`/accounting/vouchers/new/${t.path}`)}
            data-testid={`new-${t.value}`}>{t.label}</Button>)}
        </>} />
      <div className="lf-grid">
        <SummaryTile label="Cash and bank" testId="tile-cash" value={drCrText(totals.cash_and_bank.amount, totals.cash_and_bank.side)} sub="In all money accounts" />
        <SummaryTile label="Customers owe" testId="tile-receivables" value={drCrText(totals.receivables.amount, totals.receivables.side)} sub="Sundry debtors" />
        <SummaryTile label="We owe suppliers" testId="tile-payables" value={drCrText(totals.payables.amount, totals.payables.side)} sub="Sundry creditors" />
        <SummaryTile label="Profit this year" testId="tile-profit" value={formatTaka(totals.profit, { symbol: true })} sub="Income less expenses so far" tone={totals.profit.startsWith('-') ? 'negative' : undefined} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', marginTop: 16 }}>
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Books health">
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="health-checks">
              {checks.map((c) => (
                <li key={c.key} data-testid={`check-${c.key}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <Badge tone={c.ok ? 'positive' : 'warning'} dot>{c.ok ? 'OK' : 'Check'}</Badge><span>{c.message}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Where the balances sit" padding="none">
            <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="group-balances">
              <tbody>{groups.map((g) => (
                <tr key={g.id} style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => navigate(`/accounting/groups/${g.id}`)}>
                  <td style={{ padding: '8px 16px' }}>{g.name}</td>
                  <td style={{ padding: '8px 16px', textAlign: 'right' }}><DrCr amount={g.amount} side={g.side} /></td>
                </tr>))}</tbody>
            </table>
          </Card>
        </div>
        <div style={{ flex: '2 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Waiting for approval" padding="none">
            {approvals.error ? <WidgetError title="Could not load approvals" onRetry={() => void approvals.refetch()} />
              : (approvals.data?.data ?? []).length === 0
                ? <p style={{ margin: 0, padding: '14px 16px', color: 'var(--ink-muted)' }}>Nothing is waiting.</p>
                : <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="pending-approvals">
                    {(approvals.data?.data ?? []).map((a) => (
                      <li key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
                        <a href={`/accounting/vouchers/${a.document_id}`} onClick={(e) => { e.preventDefault(); navigate(`/accounting/vouchers/${a.document_id}`) }}>{a.document_number}</a>
                        <span style={{ color: 'var(--ink-muted)' }}>{a.requested_by.name}</span>
                        <span className="lf-num">৳ {formatTaka(a.amount)}</span>
                      </li>))}
                  </ul>}
          </Card>
          <Card title="Recent vouchers" padding="none" actions={<Button variant="ghost" size="sm" onClick={() => navigate('/accounting/vouchers')}>All vouchers</Button>}>
            <div style={{ overflowX: 'auto' }}>
              <DataTable caption="Recent vouchers" columns={cols} rows={recent} onRowClick={(r: { id: number }) => navigate(`/accounting/vouchers/${r.id}`)}
                emptyState={<p style={{ padding: 16, margin: 0, color: 'var(--ink-muted)' }}>Nothing posted in this period.</p>} />
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
