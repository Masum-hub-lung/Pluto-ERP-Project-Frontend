import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  AccountGroup, AccountGroupInput, AccountMapping, AccountMappings, AccountingPeriod, AccountTree, FiscalYear, Ledger, LedgerInput, LedgerStatement, PageMeta,
  ReportData, ReverseRequest, Voucher, VoucherInput, VoucherPreview,
} from './contract.gen'

/**
 * Accounting data access (05 Accounting; H1–H14, K4, K16; backlog P7.2-FE-01). Every posting, edit, reversal,
 * approval, lock or mapping change can move balances, so mutations refresh the whole accounting cache plus the
 * modules a voucher touches — parties, money accounts, invoices and bills — and the fiscal years (08 §8).
 */
export interface LedgerFySummary {
  fiscal_year: string; from: string; to: string; opening: string; opening_side: 'dr' | 'cr'; debit: string; credit: string; entries: number
  closing: string; closing_side: 'dr' | 'cr'
}
export const fySummaryOf = (l: Ledger) => (l.fy_summary ?? null) as unknown as LedgerFySummary | null

export interface MonthlyClosing { month: string; debit: string; credit: string; closing: string; closing_side: 'dr' | 'cr' }
export const monthlyOf = (s: LedgerStatement) => (s.monthly ?? []) as unknown as MonthlyClosing[]

export interface OverviewAmount { amount: string; side: 'dr' | 'cr' }
export interface OverviewTotals {
  cash_and_bank: OverviewAmount; receivables: OverviewAmount; payables: OverviewAmount; profit: string; suspense: OverviewAmount
  opening_balance_adjustment: OverviewAmount; drafts: number; pending_approvals: number; unmatched_statement_lines: number
  last_locked_period: { name: string; end_date: string } | null
}
export interface OverviewGroup { id: number; code: string; name: string; nature: string; amount: string; side: 'dr' | 'cr' }
export interface RecentVoucher { id: number; date: string; voucher_number: string; entry_type: string; narration: string | null; amount: string; status: Voucher['status'] }
export const overviewParts = (r: ReportData) => ({
  totals: r.totals as unknown as OverviewTotals,
  rows: r.rows as unknown as RecentVoucher[],
  groups: ((r.meta ?? {}) as { groups?: OverviewGroup[] }).groups ?? [],
})

export interface VoucherTemplate { key: string; name: string; description: string; entry_type: 'journal'; lines: Array<{ ledger_id: number; ledger_code: string; ledger_name: string; side: 'debit' | 'credit' }> }

export interface VoucherListFilters {
  q?: string; entry_type?: string; status?: string; ledger_id?: number; date_from?: string; date_to?: string; sort?: string; page?: number; per_page?: number
}
export interface LedgerListFilters { q?: string; nature?: string; kind?: string; active?: string; account_group_id?: number; sort?: string; page?: number; per_page?: number }

const k = (cid: number | null, ...rest: unknown[]) => ['company', cid, 'accounting', ...rest] as const

export function useAccountTree(f: { as_of?: string; with_ledgers?: 'true' | 'false'; zero?: 'true' | 'false' } = {}) {
  return useQuery({
    queryKey: k(api.getCompany(), 'tree', f),
    queryFn: async ({ signal }) => (await api.request<{ data: AccountTree }>('GET', '/account-groups', { query: { ...f }, signal })).data.data,
    placeholderData: keepPreviousData,
  })
}

export function useAccountGroup(id: number) {
  return useQuery({
    queryKey: k(api.getCompany(), 'group', id),
    queryFn: async ({ signal }) => (await api.request<{ data: AccountGroup }>('GET', `/account-groups/${id}`, { signal })).data.data,
    retry: (n, e: unknown) => (e as { status?: number }).status !== 404 && n < 2,
    enabled: id > 0,
  })
}

export function useLedgerList(f: LedgerListFilters) {
  return useQuery({
    queryKey: k(api.getCompany(), 'ledgers', f),
    queryFn: async ({ signal }) => (await api.request<{ data: Ledger[]; meta: PageMeta }>('GET', '/ledgers', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useLedger(id: number) {
  return useQuery({
    queryKey: k(api.getCompany(), 'ledger', id),
    queryFn: async ({ signal }) => (await api.request<{ data: Ledger }>('GET', `/ledgers/${id}`, { signal })).data.data,
    retry: (n, e: unknown) => (e as { status?: number }).status !== 404 && n < 2,
    enabled: id > 0,
  })
}

export function useLedgerEntries(id: number, f: { date_from?: string; date_to?: string; narration?: string; page?: number }) {
  return useQuery({
    queryKey: k(api.getCompany(), 'ledger', id, 'entries', f),
    queryFn: async ({ signal }) => (await api.request<{ data: LedgerStatement }>('GET', `/ledgers/${id}/entries`, { query: { ...f }, signal })).data.data,
    placeholderData: keepPreviousData,
    enabled: id > 0,
  })
}

export function useAccountingOverview() {
  return useQuery({
    queryKey: k(api.getCompany(), 'overview'),
    queryFn: async ({ signal }) => (await api.request<{ data: ReportData }>('GET', '/accounting/overview', { signal })).data.data,
  })
}

export function useVouchers(f: VoucherListFilters) {
  return useQuery({
    queryKey: k(api.getCompany(), 'vouchers', f),
    queryFn: async ({ signal }) => (await api.request<{ data: Voucher[]; meta: PageMeta }>('GET', '/vouchers', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useVoucher(id: number) {
  return useQuery({
    queryKey: k(api.getCompany(), 'voucher', id),
    queryFn: async ({ signal }) => (await api.request<{ data: Voucher }>('GET', `/vouchers/${id}`, { signal })).data.data,
    retry: (n, e: unknown) => (e as { status?: number }).status !== 404 && n < 2,
    enabled: id > 0,
  })
}

export function useVoucherTemplates() {
  return useQuery({
    queryKey: k(api.getCompany(), 'voucher-templates'),
    queryFn: async ({ signal }) => (await api.request<{ data: { templates: VoucherTemplate[] } }>('GET', '/voucher-templates', { signal })).data.data.templates,
    staleTime: 5 * 60_000,
  })
}

/** POST /vouchers/calculate: the server's balance, preview lines and warnings (R-27; the client sum is only a hint). */
export async function calculateVoucher(input: VoucherInput, signal?: AbortSignal) {
  return (await api.request<{ data: VoucherPreview }>('POST', '/vouchers/calculate', { body: input, signal })).data.data
}

export function useAccountMappings() {
  return useQuery({
    queryKey: k(api.getCompany(), 'mappings'),
    queryFn: async ({ signal }) => (await api.request<{ data: AccountMappings }>('GET', '/account-mappings', { signal })).data.data.mappings,
  })
}

/** Saves the voucher PDF under its number. */
export async function downloadVoucherPdf(id: number, number: string) {
  const blob = (await api.request<Blob>('GET', `/vouchers/${id}/pdf`, { responseType: 'blob' })).data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${number}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 08 §8: a voucher change moves ledgers, parties, money accounts, documents and the approval/notification feed. */
export function useAccountingRefresh() {
  const qc = useQueryClient()
  return () => {
    const cid = api.getCompany()
    for (const key of ['accounting', 'parties', 'money-accounts', 'party-accounts', 'sales-invoices', 'purchase-bills', 'customer-receipts', 'approvals', 'notifications', 'fiscal-years', 'ledgers']) {
      void qc.invalidateQueries({ queryKey: ['company', cid, key] })
    }
  }
}

export function useCreateGroup() {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async (input: AccountGroupInput) => (await api.request<{ data: AccountGroup }>('POST', '/account-groups', { body: input })).data.data,
    onSuccess: refresh,
  })
}

export function useUpdateGroup(id: number) {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ input, version }: { input: Partial<AccountGroupInput>; version: number }) =>
      (await api.request<{ data: AccountGroup }>('PATCH', `/account-groups/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: refresh,
  })
}

export function useCreateLedger() {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: LedgerInput; idempotencyKey: string }) =>
      (await api.request<{ data: Ledger }>('POST', '/ledgers', { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useUpdateLedger(id: number) {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ input, version }: { input: Partial<LedgerInput>; version: number }) =>
      (await api.request<{ data: Ledger }>('PATCH', `/ledgers/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: refresh,
  })
}

export function useDeactivateLedger(id: number) {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async () => (await api.request<{ data: Ledger }>('POST', `/ledgers/${id}/deactivate`)).data.data,
    onSuccess: refresh,
  })
}

/** Create a voucher. `approval` is true when it went for approval instead of posting (202, BR-007). */
export function useCreateVoucher() {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: VoucherInput; idempotencyKey: string }) => {
      const r = await api.request<{ data: Voucher }>('POST', '/vouchers', { body: input, idempotencyKey })
      return { voucher: r.data.data, approval: r.meta.status === 202 }
    },
    onSuccess: refresh,
  })
}

export function useReplaceVoucher(id: number) {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ input, version }: { input: VoucherInput; version: number }) => {
      const r = await api.request<{ data: Voucher }>('PUT', `/vouchers/${id}`, { body: input, ifMatch: `W/"${version}"` })
      return { voucher: r.data.data, approval: r.data.data.status === 'submitted' }
    },
    onSuccess: refresh,
  })
}

export function usePostVoucher(id: number) {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ confirmBackdated, idempotencyKey }: { confirmBackdated?: boolean; idempotencyKey: string }) => {
      const r = await api.request<{ data: Voucher }>('POST', `/vouchers/${id}/post`, { body: confirmBackdated ? { confirm_backdated: true } : {}, idempotencyKey })
      return { voucher: r.data.data, approval: r.meta.status === 202 }
    },
    onSuccess: refresh,
  })
}

export function useSubmitVoucher(id: number) {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async () => (await api.request<{ data: Voucher }>('POST', `/vouchers/${id}/submit`)).data.data,
    onSuccess: refresh,
  })
}

export function useDeleteVoucher(id: number) {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async () => { await api.request<void>('DELETE', `/vouchers/${id}`) },
    onSuccess: refresh,
  })
}

export function useReverseVoucher(id: number) {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: ReverseRequest; idempotencyKey: string }) =>
      (await api.request<{ data: Voucher }>('POST', `/vouchers/${id}/reverse`, { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useLockPeriod() {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ id, note }: { id: number; note?: string }) =>
      (await api.request<{ data: AccountingPeriod }>('POST', `/accounting-periods/${id}/lock`, { body: note ? { note } : {} })).data.data,
    onSuccess: refresh,
  })
}

export function useUnlockPeriod() {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) =>
      (await api.request<{ data: AccountingPeriod }>('POST', `/accounting-periods/${id}/unlock`, { body: { reason } })).data.data,
    onSuccess: refresh,
  })
}

export function useCloseYear() {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ id, idempotencyKey }: { id: number; idempotencyKey: string }) =>
      (await api.request<{ data: FiscalYear }>('POST', `/fiscal-years/${id}/close`, { idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useSaveMappings() {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async (mappings: AccountMapping[]) =>
      (await api.request<{ data: AccountMappings }>('PUT', '/account-mappings', { body: { mappings } })).data.data.mappings,
    onSuccess: refresh,
  })
}
