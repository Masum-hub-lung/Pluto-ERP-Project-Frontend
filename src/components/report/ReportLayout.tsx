import { useState, type ReactNode } from 'react'
import type { ReportData } from '../../api/contract.gen'
import { downloadReport, type ReportFormat, type ReportPath, type ReportQuery } from '../../api/reports'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { periodText } from '../../lib/reportPeriod'
import { ds } from '../../ds'
import { PageSkeleton } from '../PageSkeleton'
import { ProblemBanner } from '../ProblemBanner'
import './report.css'

/**
 * Frame of every financial report (H15–H19, J6, J7; 02 "Toolbar … paper statement; agreement check; aside checks";
 * backlog P9.2-FE-01): page header with Print (browser print of the loaded view, print stylesheet in report.css) and
 * the Export menu (xlsx, pdf, csv through the authenticated client; needs reports.export), the filter bar, the
 * report's agreement checks, then the paper statement and an optional aside. Everything shown comes from the API.
 */
export function ReportLayout({ title, description, path, query, report, loading, error, onRetry, filters, aside, children }: {
  title: string; description: string; path: ReportPath; query: ReportQuery; report: ReportData | undefined; loading: boolean
  error: unknown; onRetry: () => void; filters: ReactNode; aside?: ReactNode; children: ReactNode
}) {
  const { PageHeader, Button, Badge, Banner } = ds()

  return (
    <div className="lf-report">
      <PageHeader title={title} description={description}
        actions={<div className="lf-report-actions">
          <Button variant="secondary" icon="printer" onClick={() => window.print()} disabled={!report}>Print</Button>
          <ExportMenu path={path} query={query} disabled={!report} />
        </div>} />
      <div className="lf-report-filters" role="group" aria-label="Report filters">{filters}</div>
      <ProblemBanner error={error} onRetry={onRetry} />
      {!report && loading && <PageSkeleton template="report" />}
      {report && (
        <>
          {(report.checks ?? []).map((c) => (
            <div key={c.key} className="lf-report-check" data-testid={`check-${c.key}`} data-ok={c.ok ? 'true' : 'false'}>
              <Banner tone={c.ok ? 'positive' : 'warning'} title={c.message} />
            </div>
          ))}
          <div className={aside ? 'lf-report-body lf-report-body--aside' : 'lf-report-body'}>
            <section className="lf-report-paper" aria-busy={loading} aria-label={report.title}>
              <header className="lf-report-paper-head">
                <h2>{report.title}</h2>
                <span>{periodText(report.period)}</span>
                {report.basis && <Badge tone="neutral">{report.basis}</Badge>}
              </header>
              {children}
            </section>
            {aside && <aside className="lf-report-aside">{aside}</aside>}
          </div>
        </>
      )}
    </div>
  )
}

function ExportMenu({ path, query, disabled }: { path: ReportPath; query: ReportQuery; disabled: boolean }) {
  const { Button, Menu } = ds()
  const { can } = useSession()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!can('reports.export')) return null

  async function run(format: ReportFormat) {
    setOpen(false)
    setBusy(true)
    toast({ tone: 'info', title: 'Preparing the export', description: `${format.toUpperCase()} file of this report.` })
    try {
      await downloadReport(path, query, format)
      toast({ tone: 'positive', title: 'Export ready', description: 'The file has been downloaded.' })
    } catch (e) {
      toast({ tone: 'negative', title: 'Could not export', description: e instanceof Error ? e.message : 'Try again in a moment.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'relative' }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <Button variant="secondary" icon="download" iconRight="chevron-down" loading={busy} disabled={disabled} onClick={() => setOpen((o) => !o)} data-testid="export-menu">Export</Button>
      {open && (
        <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 200, zIndex: 20 }}
          items={[{ icon: 'sheet', label: 'Excel (.xlsx)', onClick: () => void run('xlsx') }, { icon: 'file-text', label: 'PDF', onClick: () => void run('pdf') },
            { icon: 'file', label: 'CSV', onClick: () => void run('csv') }]} />
      )}
    </div>
  )
}
