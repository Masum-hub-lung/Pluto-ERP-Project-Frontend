import { useState } from 'react'
import { useExportJob, saveFile, exportFilters } from '../api/exports'
import type { ExportJobCreate } from '../api/contract.gen'
import { useToast } from '../app/toast'
import { useSession } from '../auth/session'
import { ds } from '../ds'
import { useIdempotencyKey } from '../lib/useIdempotencyKey'

/**
 * "Export" on list pages and the J1 month-end pack (backlog P14.2-FE-07): starts an export job, shows progress in a
 * toast, polls until the file is ready, then downloads it. The whole list (every page) with the filters on screen.
 * Needs reports.export.
 */
export function ExportButton({ kind, source, filters = {}, formats, label = 'Export', input, testId = 'export-list' }: {
  kind: 'list' | 'report' | 'export_pack'; source?: string; filters?: Record<string, unknown>; formats: Array<ExportJobCreate['format']>; label?: string
  /** Extra fields of the job (period, reports for the month-end pack). */
  input?: Partial<ExportJobCreate>; testId?: string
}) {
  const { Button, Menu } = ds()
  const { can } = useSession()
  const toast = useToast()
  const job = useExportJob()
  const idem = useIdempotencyKey()
  const [open, setOpen] = useState(false)
  if (!can('reports.export')) return null

  async function run(format: ExportJobCreate['format']) {
    setOpen(false)
    toast({ tone: 'info', title: 'Preparing the export', description: 'This runs in the background; the file downloads when it is ready.' })
    try {
      const done = await job.start({ kind, format, ...(source ? { source } : {}), filters: exportFilters(filters), ...input }, idem.key)
      idem.reset()
      if (done.download_url) saveFile(done.download_url, done.file_name)
      toast({ tone: 'positive', title: 'Export ready', description: done.file_name ? `${done.file_name} has been downloaded.` : 'The file has been downloaded.' })
    } catch (e) {
      idem.reset()
      toast({ tone: 'negative', title: 'Could not export', description: e instanceof Error ? e.message : 'Try again in a moment.' })
    }
  }

  const names: Record<string, string> = { xlsx: 'Excel (.xlsx)', csv: 'CSV', pdf: 'PDF', both: 'Excel and PDF (.zip)' }
  const icons: Record<string, string> = { xlsx: 'sheet', csv: 'file', pdf: 'file-text', both: 'folder-archive' }
  if (formats.length === 1) {
    return <Button variant="secondary" icon="download" loading={job.busy} onClick={() => void run(formats[0])} data-testid={testId}>{label}</Button>
  }
  return (
    <div style={{ position: 'relative' }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <Button variant="secondary" icon="download" iconRight="chevron-down" loading={job.busy} onClick={() => setOpen((o) => !o)} data-testid={testId}>{label}</Button>
      {open && (
        <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 210, zIndex: 20 }}
          items={formats.map((f) => ({ icon: icons[f], label: names[f], onClick: () => void run(f) }))} />
      )}
    </div>
  )
}
