import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { ReportData } from './contract.gen'
import { dhakaToday } from './platform'

/**
 * Financial statements (05 Reports; H15–H19, J6, J7; backlog P9.2-FE-01). Each report is one GET returning
 * ReportData; `format=xlsx|pdf|csv` returns the same report as a file (needs reports.export). Reports read posted
 * vouchers only, and any posting anywhere can move them, so they are refetched every time a report page opens
 * instead of being invalidated by every mutation.
 */
export type ReportPath = 'trial-balance' | 'profit-and-loss' | 'balance-sheet' | 'cash-flow' | 'general-ledger' | 'receivables-aging' | 'payables-aging'
export type ReportFormat = 'xlsx' | 'pdf' | 'csv'
export type ReportQuery = Record<string, string | undefined>

/** One statement row as the backend builds it (app/Queries/Reports/*): `kind` drives the styling, amounts are decimal strings. */
export interface ReportRow {
  kind: 'heading' | 'group' | 'ledger' | 'subtotal' | 'total' | 'profit' | 'line' | 'opening' | 'entry' | 'month' | 'closing' | 'party'
  key?: string; id?: number; code?: string; name?: string; label?: string; depth?: number
  ledger_id?: number; group_id?: number; party_id?: number
  [column: string]: unknown
}
export const rowsOf = (r: ReportData | undefined) => (r?.rows ?? []) as unknown as ReportRow[]
export const totalsOf = <T = Record<string, string>>(r: ReportData | undefined) => (r?.totals ?? {}) as unknown as T

/** Trial balance meta: the drafts side panel (vouchers not yet posted, left out of the report). */
export interface DraftItem { id: number; voucher_number: string; entry_type: string; date: string; status: string; amount: string }
export const draftsOf = (r: ReportData | undefined) =>
  ((r?.meta ?? {}) as { drafts?: { count: number; total: string; items: DraftItem[] } }).drafts ?? { count: 0, total: '0.00', items: [] }

const clean = (q: ReportQuery) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>

export function useReport(path: ReportPath, query: ReportQuery) {
  const q = clean(query)
  return useQuery({
    queryKey: ['company', api.getCompany(), 'reports', path, q],
    queryFn: async ({ signal }) => (await api.request<{ data: ReportData }>('GET', `/reports/${path}`, { query: q, signal })).data.data,
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

/** The report as a file through the authenticated client (a plain link would lack the Bearer token). */
export async function downloadReport(path: ReportPath, query: ReportQuery, format: ReportFormat) {
  const blob = (await api.request<Blob>('GET', `/reports/${path}`, { query: { ...clean(query), format }, responseType: 'blob' })).data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${path}-${(query.as_of || query.date_to || dhakaToday()).replace(/-/g, '')}.${format}` // the API defaults to today too
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
