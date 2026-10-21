import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { Branch, CompanySettings, FiscalYear, PageMeta } from './contract.gen'

/** Platform lookups (05 getFiscalYears, getBranches, getCompanySettings): read by the shell and by forms. */
export function useFiscalYears() {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'fiscal-years'],
    queryFn: async () => (await api.request<{ data: FiscalYear[]; meta: PageMeta }>('GET', '/fiscal-years')).data.data,
    staleTime: 5 * 60_000,
  })
}

/** The financial year that contains `today` (YYYY-MM-DD in Dhaka time); the contract has no is_current flag. */
export function currentFiscalYear(years: FiscalYear[] | undefined, today: string = dhakaToday()): FiscalYear | undefined {
  return years?.find((y) => y.start_date <= today && today <= y.end_date)
}

export function dhakaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function useBranches(q?: string) {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'branches', q ?? ''],
    queryFn: async () => (await api.request<{ data: Branch[]; meta: PageMeta }>('GET', '/branches', { query: { q, per_page: 100 } })).data.data,
    staleTime: 5 * 60_000,
  })
}

export function useCompanySettings() {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'company-settings'],
    queryFn: async () => (await api.request<{ data: CompanySettings }>('GET', '/company/settings')).data.data,
    staleTime: 5 * 60_000,
  })
}
