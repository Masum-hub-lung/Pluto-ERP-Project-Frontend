import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { ExportJob, LedgerStatement, OutstandingReport, PageMeta, PartyStatement, PartyTransaction, StatementSendRequest } from './contract.gen'

/**
 * Party accounts (B5–B8 / C5–C8; backlog P6.2-FE-01): ledger with running balance, transactions, outstanding/aging and
 * statements. Keys sit under ['company', cid, 'party-accounts'] and are refreshed by receipts, allocations and posting.
 * Every figure (running balance, buckets, closing) comes from the API; nothing is summed here.
 */
const base = (cid: number | null) => ['company', cid, 'party-accounts'] as const

export function usePartyLedger(id: number, f: { date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: [...base(api.getCompany()), id, 'ledger', f],
    queryFn: async ({ signal }) => (await api.request<{ data: LedgerStatement }>('GET', `/parties/${id}/ledger`, { query: { ...f }, signal })).data.data,
    enabled: id > 0, placeholderData: keepPreviousData,
  })
}

export interface TransactionFilters { q?: string; document_type?: string; date_from?: string; date_to?: string; sort?: string; page?: number; per_page?: number }

export function usePartyTransactions(id: number, f: TransactionFilters) {
  return useQuery({
    queryKey: [...base(api.getCompany()), id, 'transactions', f],
    queryFn: async ({ signal }) => (await api.request<{ data: PartyTransaction[]; meta: PageMeta }>('GET', `/parties/${id}/transactions`, { query: { ...f }, signal })).data,
    enabled: id > 0, placeholderData: keepPreviousData,
  })
}

export interface OutstandingFilters { type: 'customer' | 'supplier'; q?: string; bucket?: string; as_of?: string; sort?: string; page?: number; per_page?: number }

/** One row of OutstandingReport.rows (loosely typed in the contract). */
export interface OutstandingRow {
  party: { id: number; code: string; name: string }
  not_due: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string; total: string; advance: string
}

export function useOutstanding(f: OutstandingFilters) {
  return useQuery({
    queryKey: [...base(api.getCompany()), 'outstanding', f],
    queryFn: async ({ signal }) => (await api.request<{ data: OutstandingReport }>('GET', '/parties/outstanding', { query: { ...f }, signal })).data.data,
    placeholderData: keepPreviousData,
  })
}

export function usePartyStatement(id: number, f: { date_from?: string; date_to?: string; aging?: string }) {
  return useQuery({
    queryKey: [...base(api.getCompany()), id, 'statement', f],
    queryFn: async ({ signal }) => (await api.request<{ data: PartyStatement }>('GET', `/parties/${id}/statement`, { query: { ...f }, signal })).data.data,
    enabled: id > 0, placeholderData: keepPreviousData,
  })
}

/** Saves the statement PDF (statement-<code>.pdf). */
export async function downloadStatementPdf(id: number, code: string, f: { date_from?: string; date_to?: string; aging?: string }) {
  const blob = (await api.request<Blob>('GET', `/parties/${id}/statement/pdf`, { query: { ...f }, responseType: 'blob' })).data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `statement-${code}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** E-mail statements (queued); the ExportJob's `error` names parties skipped for lack of an e-mail. */
export function useSendStatements() {
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: { body: StatementSendRequest; idempotencyKey: string }) =>
      (await api.request<{ data: ExportJob }>('POST', '/parties/statements/send', { body, idempotencyKey })).data.data,
  })
}
