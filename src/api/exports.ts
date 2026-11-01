import { useEffect, useRef, useState } from 'react'
import { api } from './client'
import type { ExportJob, ExportJobCreate } from './contract.gen'

/**
 * Export jobs (05 POST /export-jobs, GET /export-jobs/{id}; NFR-006; backlog P14.2-FE-07): start a job, poll every
 * 1.5 s until it is complete or failed, then download through its signed link (relative, valid 24 h; no Bearer
 * token needed). Sources are contract operationIds (`getReportsTrialBalance`, `getSalesInvoices`, …).
 */
export const POLL_MS = 1500
const GIVE_UP_MS = 10 * 60_000

/** Report path (api/reports.ts ReportPath) → its operationId: `inventory/low-stock` → `getReportsInventoryLowStock`. */
export function reportSource(path: string): string {
  return 'getReports' + path.split(/[/-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

/** List endpoint (`/sales-invoices`) → its operationId (`getSalesInvoices`). */
export function listSource(path: string): string {
  return 'get' + path.replace(/^\//, '').split(/[/-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

/** Query values as the API takes them: strings, empties dropped. */
export function exportFilters(q: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(q).filter(([k, v]) => v !== undefined && v !== null && v !== '' && k !== 'page' && k !== 'per_page').map(([k, v]) => [k, String(v)]))
}

export function saveFile(url: string, name?: string | null) {
  const a = document.createElement('a')
  a.href = url
  if (name) a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

type Phase = 'idle' | 'starting' | 'working' | 'done' | 'failed'

/** One export at a time per caller: `start(input)` resolves with the finished job (or throws with the job's reason). */
export function useExportJob() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [job, setJob] = useState<ExportJob | null>(null)
  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  async function start(input: ExportJobCreate, idempotencyKey: string): Promise<ExportJob> {
    cancelled.current = false
    setPhase('starting')
    try {
      let j = (await api.request<{ data: ExportJob }>('POST', '/export-jobs', { body: input, idempotencyKey })).data.data
      setJob(j)
      setPhase('working')
      const until = Date.now() + GIVE_UP_MS
      while ((j.status === 'queued' || j.status === 'running') && !cancelled.current) {
        if (Date.now() > until) throw new Error('The export is taking longer than usual; it will keep running — check again later.')
        await new Promise((r) => setTimeout(r, POLL_MS))
        j = (await api.request<{ data: ExportJob }>('GET', `/export-jobs/${j.id}`)).data.data
        setJob(j)
      }
      if (j.status === 'failed') throw new Error(j.error || 'The export could not be prepared.')
      setPhase('done')
      return j
    } catch (e) {
      setPhase('failed')
      throw e
    }
  }

  return { start, job, phase, busy: phase === 'starting' || phase === 'working' }
}

/** Reports an export job can run (backend ExportSources::REPORTS); others download directly. */
export const JOB_REPORTS = new Set(['trial-balance', 'profit-and-loss', 'balance-sheet', 'cash-flow', 'general-ledger', 'receivables-aging', 'payables-aging', 'sales',
  'sales-returns', 'purchases', 'purchase-returns', 'income', 'expenses', 'inventory/low-stock', 'inventory/valuation'])

/** A report with more rows than this is exported through a job instead of one long request (NFR-006). */
export const LARGE_REPORT_ROWS = 500
