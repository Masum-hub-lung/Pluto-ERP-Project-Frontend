import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { IeCategory, IeCategoryInput, IeEntry, IeEntryInput, PageMeta, RecurringTemplate, RecurringTemplateInput, ReportData, Voucher } from './contract.gen'

/**
 * Income and expenses (I1–I10; 05 Income and expenses; backlog P13.2-FE-01): categories with budget use, entries
 * (posted lines on category ledgers, GAP-16), recording an entry (201 posted, 202 waiting for approval), recurring
 * templates and the overview. Recording refreshes everything that shows money. Reads are refetched on every open.
 */
const cid = () => api.getCompany()
export type IeKind = 'income' | 'expense'
export type IePeriod = 'this_month' | 'last_month' | 'this_quarter' | 'this_year'

export function useIeCategories(kind: IeKind, period: IePeriod = 'this_month') {
  return useQuery({
    queryKey: ['company', cid(), 'income-expenses', 'categories', kind, period],
    queryFn: async ({ signal }) => (await api.request<{ data: IeCategory[] }>('GET', '/ie-categories', { query: { kind, period }, signal })).data.data,
    staleTime: 0, refetchOnMount: 'always',
  })
}

export interface IeEntryFilters { kind: IeKind; q?: string; category_id?: number; date_from?: string; date_to?: string; missing_receipt?: string; sort?: string; page?: number; per_page?: number }
export type IeEntryMeta = PageMeta & { total_amount: string }

export function useIeEntries(f: IeEntryFilters) {
  return useQuery({
    queryKey: ['company', cid(), 'income-expenses', 'entries', f],
    queryFn: async ({ signal }) => (await api.request<{ data: IeEntry[]; meta: IeEntryMeta }>('GET', '/ie-entries', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

/** Overview meta as the backend builds it (app/Queries/IncomeExpenseQuery). */
export interface IeOverviewMeta { months: { month: string; label: string; value: string; budget: string | null }[]; recent: IeEntry[] }

export function useIeOverview(kind: IeKind, period: IePeriod) {
  return useQuery({
    queryKey: ['company', cid(), 'income-expenses', 'overview', kind, period],
    queryFn: async ({ signal }) => (await api.request<{ data: ReportData }>('GET', '/income-expenses/overview', { query: { kind, period }, signal })).data.data,
    staleTime: 0, refetchOnMount: 'always',
  })
}

export function useRecurringTemplates(f: { kind?: string; active?: string; page?: number }) {
  return useQuery({
    queryKey: ['company', cid(), 'income-expenses', 'recurring', f],
    queryFn: async ({ signal }) => (await api.request<{ data: RecurringTemplate[]; meta: PageMeta }>('GET', '/recurring-templates', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

function useRefresh() {
  const qc = useQueryClient()
  return () => {
    for (const k of ['income-expenses', 'banking', 'money-accounts', 'accounting', 'approvals', 'notifications', 'reports']) void qc.invalidateQueries({ queryKey: ['company', cid(), k] })
  }
}

/** POST /ie-entries: the voucher, and whether it went for approval (202). */
export function useRecordEntry() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: IeEntryInput; idempotencyKey: string }) => {
      const r = await api.request<{ data: Voucher }>('POST', '/ie-entries', { body: input, idempotencyKey })
      return { voucher: r.data.data, approval: r.meta.status === 202 }
    },
    onSuccess: refresh,
  })
}

export function useSaveCategory(id?: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: IeCategoryInput; idempotencyKey?: string }) =>
      (await api.request<{ data: IeCategory }>(id ? 'PATCH' : 'POST', id ? `/ie-categories/${id}` : '/ie-categories', { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useUpdateTemplate() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ t, input }: { t: RecurringTemplate; input: RecurringTemplateInput }) =>
      (await api.request<{ data: RecurringTemplate }>('PATCH', `/recurring-templates/${t.id}`, { body: input, ifMatch: `W/"${t.version}"` })).data.data,
    onSuccess: refresh,
  })
}
