import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { Backup } from '../../api/contract.gen'
import { useCompanySettings } from '../../api/platform'
import { useBackupAction, useBackups, useUpdateSettings } from '../../api/settings'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ExportButton } from '../../components/ExportButton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { Forbidden } from '../../components/states'
import { lastMonth } from '../reports/ReportsCentre'
import { SettingsLayout } from './SettingsLayout'

/**
 * K15 Backup and export (Settings.dc.html; FR-087; BR-062; R-11; backlog P15.2-FE-10): the month-end export pack (an
 * export job: period, format, reports), daily backups on/off and how long they are kept, "Back up now", the history,
 * and — Owner only — download and restore. Restore needs RESTORE typed, takes a safety backup first, and the company
 * is unavailable to everyone while it runs.
 */
const PACK = [['getReportsTrialBalance', 'Trial balance'], ['getReportsProfitAndLoss', 'Profit and loss'], ['getReportsBalanceSheet', 'Balance sheet'],
  ['getReportsCashFlow', 'Cash flow'], ['getReportsReceivablesAging', 'Receivables aging'], ['getReportsPayablesAging', 'Payables aging'],
  ['getReportsGeneralLedger', 'General ledger'], ['getReportsSales', 'Sales report'], ['getReportsPurchases', 'Purchases report']] as const
const KIND: Record<string, string> = { automatic: 'Daily', manual: 'Manual', pre_restore: 'Before restore', pre_lock: 'Before period lock' }

export function Backups() {
  const { Card, Button, DataTable, Badge, Switch, Select, Segmented, EmptyState } = ds()
  const { can } = useSession()
  const toast = useToast()
  const settings = useCompanySettings()
  const update = useUpdateSettings()
  const [restoring, setRestoring] = useState<Backup | null>(null)
  const [running, setRunning] = useState(false)
  const list = useBackups(running)
  const act = useBackupAction()
  const idem = useIdempotencyKey()
  const [month, setMonth] = useState(lastMonth())
  const [format, setFormat] = useState<'xlsx' | 'pdf' | 'both'>('both')
  const [reports, setReports] = useState<string[]>(PACK.slice(0, 6).map(([k]) => k))
  if (!can('settings.backup') && !can('reports.export')) return <Forbidden permission="settings.backup" what="backup and export" />
  const owner = can('settings.restore')
  const s = settings.data
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1 - i); return d.toISOString().slice(0, 7) })

  async function backupNow() {
    try {
      await act.mutateAsync({ kind: 'take', idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: 'Backup taken' })
    } catch (e) {
      toast({ tone: 'negative', title: 'Could not back up', description: e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : undefined })
    }
  }
  async function setBackup(patch: { backup_enabled?: boolean; backup_retention_days?: number }) {
    if (!s) return
    try {
      await update.mutateAsync({ input: patch, version: s.version })
      toast({ tone: 'positive', title: 'Backup settings saved' })
    } catch (e) {
      toast({ tone: 'negative', title: 'Could not save', description: e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : undefined })
    }
  }

  const columns: DataColumn[] = [
    { key: 'started', label: 'Taken' }, { key: 'kind', label: 'Kind' },
    { key: 'status', label: 'Status', render: (v: string) => <Badge tone={v === 'complete' ? 'positive' : v === 'failed' ? 'negative' : 'neutral'} dot>{v === 'complete' ? 'Ready' : v.replace('_', ' ')}</Badge> },
    { key: 'size', label: 'Size', align: 'right' }, { key: 'by', label: 'By' },
  ]
  const rows = (list.data ?? []).map((b) => ({ id: b.id, b, started: new Date(b.started_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    kind: KIND[b.kind] ?? b.kind, status: b.status, size: b.size_bytes ? `${Math.max(1, Math.round(b.size_bytes / 1024))} KB` : '—', by: b.created_by?.name ?? 'Pluto' }))

  return (
    <SettingsLayout current="Backup and export" eyebrow="Settings › Data" title="Backup and export" description="Month-end files for your accountant, and copies of the company you can go back to.">
      {can('reports.financial') && (
        <Card title="Month-end export pack" subtitle="The month's statements as Excel and PDF, zipped">
          <div className="lf-grid" style={{ gap: 16 }}>
            <div className="lf-c4"><Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} options={months.map((m) => ({ value: m, label: new Date(`${m}-01T00:00:00`).toLocaleString('en-GB', { month: 'long', year: 'numeric' }) }))} /></div>
            <div className="lf-c8"><Segmented options={[{ value: 'xlsx', label: 'Excel' }, { value: 'pdf', label: 'PDF' }, { value: 'both', label: 'Both' }]} value={format} onChange={(v) => setFormat(v as typeof format)} /></div>
            <fieldset className="lf-c12" style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
              <legend className="lf-sr-only">Reports</legend>
              {PACK.map(([k, label]) => (
                <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={reports.includes(k)} onChange={(e) => setReports(e.target.checked ? [...reports, k] : reports.filter((r) => r !== k))} />{label}
                </label>
              ))}
            </fieldset>
            <div className="lf-c12">{reports.length === 0 ? <span style={{ color: 'var(--negative)' }}>Choose at least one report</span>
              : <ExportButton kind="export_pack" formats={[format]} label="Prepare export pack" input={{ period: month, reports }} testId="prepare-pack" />}</div>
          </div>
        </Card>
      )}
      {can('settings.backup') && s && (
        <Card title="Automatic backups" actions={<Button icon="database-backup" loading={act.isPending} onClick={() => void backupNow()} data-testid="backup-now">Back up now</Button>}>
          <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}><strong>Daily backup</strong><span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Every night at 00:30</span></span>
            <Switch key={`be-${String(s.backup_enabled)}`} checked={!!s.backup_enabled} disabled={!owner || update.isPending} onChange={(v) => void setBackup({ backup_enabled: v })} label={s.backup_enabled ? 'On' : 'Off'} />
          </div>
          <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <strong>Keep each backup for</strong>
            <Select aria-label="Keep for" disabled={!owner} value={String(s.backup_retention_days ?? 90)} onChange={(e) => void setBackup({ backup_retention_days: Number(e.target.value) })}
              options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }]} />
          </div>
          {!owner && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)' }}>Only an Owner can change these, download or restore.</p>}
        </Card>
      )}
      {can('settings.backup') && (
        <Card title="History" padding="none">
          <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
          <div style={{ overflowX: 'auto' }} data-testid="backups">
            <DataTable caption="Backups" columns={columns} rows={rows} loading={list.isPending}
              rowActions={owner ? (r: { b: Backup }) => (r.b.status === 'complete' ? (
                <span style={{ display: 'flex', gap: 4 }}>
                  <Button size="sm" variant="ghost" icon="download" onClick={(e) => { e.stopPropagation(); void act.mutateAsync({ kind: 'download', id: r.b.id }) }}>Download</Button>
                  <Button size="sm" variant="ghost" icon="history" onClick={(e) => { e.stopPropagation(); setRestoring(r.b) }} data-testid={`restore-${r.b.id}`}>Restore</Button>
                </span>) : null) : undefined}
              emptyState={<EmptyState icon="database" title="No backups yet" description="Take one now, or turn on the daily backup." />} />
          </div>
        </Card>
      )}
      {restoring && <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} onStarted={() => { setRunning(true); setTimeout(() => setRunning(false), 60_000) }} />}
    </SettingsLayout>
  )
}

function RestoreDialog({ backup, onClose, onStarted }: { backup: Backup; onClose: () => void; onStarted: () => void }) {
  const { Field, Input, Button, Banner } = ds()
  const toast = useToast()
  const act = useBackupAction()
  const idem = useIdempotencyKey()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<unknown>(null)
  const when = new Date(backup.started_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  async function restore() {
    setError(null)
    try {
      await act.mutateAsync({ kind: 'restore', id: backup.id, idempotencyKey: idem.key })
      idem.reset()
      onStarted()
      toast({ tone: 'positive', title: 'Restore started', description: `The company goes back to ${when}. A safety backup of today was taken first.` })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title="Restore this backup?" tone="negative" onClose={onClose} testId="restore-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={typed !== 'RESTORE'} loading={act.isPending} onClick={() => void restore()} data-testid="confirm-restore">Restore</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Banner tone="warning" title={`Everything entered after ${when} is replaced`}>
          Invoices, bills, vouchers and stock go back to that moment. A backup of the company as it is now is taken first, so you can undo this. Nobody can use the company while it runs. The activity log is kept.
        </Banner>
        <ProblemBanner error={error} />
        <Field label="Type RESTORE to confirm" htmlFor="restore-typed"><Input id="restore-typed" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></Field>
      </div>
    </ResponsiveDialog>
  )
}
