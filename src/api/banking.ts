import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  CashCount, CashCountInput, CreateEntryFromLine, LedgerStatement, MoneyTransaction, PageMeta, Reconciliation, ReconciliationStart, ReportData,
  StatementImportResult,
} from './contract.gen'

/**
 * Cash and bank data access (05 Banking; backlog P12.2-FE-01): the overview (G1), money transactions (G13), an
 * account's book (G2, G5, G11, G12), cash counts (G2), statement import and the reconciliation workspace (G10).
 * Keys under ['company', cid, …]; anything that posts refreshes money accounts, vouchers, books, the overview and the
 * approvals bell. Reads are refetched on every open (balances move with every posted voucher).
 */
const cid = () => api.getCompany()

export function useBankingOverview() {
  return useQuery({
    queryKey: ['company', cid(), 'banking', 'overview'],
    queryFn: async ({ signal }) => (await api.request<{ data: ReportData }>('GET', '/banking/overview', { signal })).data.data,
    staleTime: 0, refetchOnMount: 'always',
  })
}

/** Overview rows and meta as the backend builds them (app/Queries/BankingQuery). */
export interface OverviewAccount {
  id: number; name: string; account_type: string; bank_name: string | null; account_number: string | null; balance: string; available: string; share: string
  last_reconciled_on: string | null; unmatched_lines: number
}
export interface OverviewMeta { series: { date: string; balance: string }[]; recent: MoneyTransaction[] }

export interface MoneyTransactionFilters { q?: string; date_from?: string; date_to?: string; direction?: string; money_account_id?: number; sort?: string; page?: number; per_page?: number }

export function useMoneyTransactions(f: MoneyTransactionFilters) {
  return useQuery({
    queryKey: ['company', cid(), 'banking', 'transactions', f],
    queryFn: async ({ signal }) => (await api.request<{ data: MoneyTransaction[]; meta: PageMeta }>('GET', '/money-transactions', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

/** GET /money-accounts/{id}/book: opening, lines with a running balance, closing (this financial year to today by default). */
export function useMoneyBook(id: number, f: { date_from?: string; date_to?: string; view?: string; page?: number }) {
  return useQuery({
    queryKey: ['company', cid(), 'banking', 'book', id, f],
    queryFn: async ({ signal }) => (await api.request<{ data: LedgerStatement }>('GET', `/money-accounts/${id}/book`, { query: { ...f }, signal })).data.data,
    placeholderData: keepPreviousData,
    enabled: id > 0,
  })
}

function useRefresh() {
  const qc = useQueryClient()
  return () => {
    for (const k of ['banking', 'money-accounts', 'accounting', 'approvals', 'notifications', 'reports', 'party-accounts']) void qc.invalidateQueries({ queryKey: ['company', cid(), k] })
  }
}

/** CashCount as the API returns it: with the account, denominations and the adjustment's state (approval). */
export type CashCountView = CashCount & {
  money_account_name?: string | null; adjustment_number?: string | null; adjustment_status?: string | null; approval_request_id?: number | null
  denominations?: { denomination: string; count: number; value: string }[]
}

export function useRecordCashCount() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: CashCountInput; idempotencyKey: string }) =>
      (await api.request<{ data: CashCountView }>('POST', '/cash-counts', { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useReverseCashCount(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ reason, idempotencyKey }: { reason: string; idempotencyKey: string }) =>
      (await api.request<{ data: CashCountView }>('POST', `/cash-counts/${id}/reverse`, { body: { reason }, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useImportStatement() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ file, moneyAccountId, idempotencyKey }: { file: File; moneyAccountId: number; idempotencyKey: string }) => {
      const body = new FormData()
      body.append('file', file)
      body.append('money_account_id', String(moneyAccountId))
      return (await api.request<{ data: StatementImportResult }>('POST', '/bank-statement-imports', { body, idempotencyKey })).data.data
    },
    onSuccess: refresh,
  })
}

/** Reconciliation as the API returns it, with the right pane's book entries. */
export interface BookEntry { journal_line_id: number; date: string; voucher_number: string; particulars: string; reference: string | null; amount: string }
export type ReconciliationView = Omit<Reconciliation, 'book_entries'> & { book_entries?: BookEntry[] }

const recKey = (id: number) => ['company', cid(), 'banking', 'reconciliation', id]

export function useStartReconciliation() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (input: ReconciliationStart) => (await api.request<{ data: ReconciliationView }>('POST', '/reconciliations', { body: input })).data.data,
    onSuccess: refresh,
  })
}

export function useReconciliation(id: number, filter = 'all') {
  return useQuery({
    queryKey: [...recKey(id), filter],
    queryFn: async ({ signal }) => (await api.request<{ data: ReconciliationView }>('GET', `/reconciliations/${id}`, { query: { filter }, signal })).data.data,
    placeholderData: keepPreviousData,
    enabled: id > 0,
  })
}

type RecAction =
  | { kind: 'match'; lineId: number; journal_line_id: number }
  | { kind: 'create-entry'; lineId: number; body: CreateEntryFromLine }
  | { kind: 'pair'; line_ids: number[] }
  | { kind: 'undo'; lineId: number }
  | { kind: 'accept-suggestions' }
  | { kind: 'finish' }

/** Every workspace action answers with the whole reconciliation; it replaces the cached one. */
export function useReconciliationAction(id: number) {
  const qc = useQueryClient()
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ action, idempotencyKey }: { action: RecAction; idempotencyKey?: string }) => {
      const [path, body] = action.kind === 'match' ? [`lines/${action.lineId}/match`, { journal_line_id: action.journal_line_id }]
        : action.kind === 'create-entry' ? [`lines/${action.lineId}/create-entry`, action.body]
        : action.kind === 'pair' ? ['lines/pair', { line_ids: action.line_ids }]
        : action.kind === 'undo' ? [`lines/${action.lineId}/undo`, {}]
        : [action.kind, {}]
      return (await api.request<{ data: ReconciliationView }>('POST', `/reconciliations/${id}/${path}`, { body, idempotencyKey })).data.data
    },
    onSuccess: (r, { action }) => {
      void qc.invalidateQueries({ queryKey: recKey(id) })
      qc.setQueryData([...recKey(id), 'all'], r)
      if (action.kind === 'create-entry' || action.kind === 'finish') refresh()
    },
  })
}
