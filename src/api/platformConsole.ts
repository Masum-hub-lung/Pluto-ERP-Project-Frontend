import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { PageMeta, PlatformCompany, PlatformCompanyCreate, SupportAccess } from './contract.gen'

/**
 * Platform console (K17; 05 /platform/companies; PEP-483/484): every customer company of this installation, for
 * platform admins only (Me.platform_admin + a 2-step sign-in; the API answers 403 platform_admin_only /
 * platform_two_factor_required otherwise). Not company data, so no X-Company-Id and keys outside ['company', …].
 */
export interface PlatformFilters { q?: string; status?: string; page?: number }

const key = (...rest: unknown[]) => ['platform', 'companies', ...rest] as const

export function usePlatformCompanies(f: PlatformFilters, enabled = true) {
  return useQuery({
    queryKey: key(f),
    queryFn: async ({ signal }) => (await api.request<{ data: PlatformCompany[]; meta: PageMeta }>('GET', '/platform/companies', {
      company: false, signal, query: { per_page: '25', ...(f.q ? { q: f.q } : {}), ...(f.status ? { status: f.status } : {}), ...(f.page && f.page > 1 ? { page: String(f.page) } : {}) },
    })).data,
    placeholderData: keepPreviousData,
    staleTime: 0, refetchOnMount: 'always', // owners accept invitations from their own browser
    enabled,
    retry: (n, e: unknown) => (e as { status?: number }).status !== 403 && n < 2,
  })
}

export function useCreatePlatformCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: PlatformCompanyCreate; idempotencyKey: string }) =>
      (await api.request<{ data: PlatformCompany }>('POST', '/platform/companies', { company: false, body: input, idempotencyKey })).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: key() }),
  })
}

/** Suspend (nobody can open the company) or reactivate it; the reason goes to that company's audit log. */
export function useCompanyStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, action, reason }: { id: number; action: 'suspend' | 'reactivate'; reason: string }) =>
      (await api.request<{ data: PlatformCompany }>('POST', `/platform/companies/${id}/${action}`, { company: false, body: { reason } })).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: key() }),
  })
}

/** PEP-485: open a company read-only for 15–240 minutes with a reason (its owners are told), or end the visit now. */
export function useSupportAccess() {
  return useMutation({
    mutationFn: async ({ id, reason, minutes }: { id: number; reason: string; minutes: number }) =>
      (await api.request<{ data: SupportAccess }>('POST', `/platform/companies/${id}/support-access`, { company: false, body: { reason, minutes } })).data.data,
  })
}

export async function endSupportAccess(id: number) {
  await api.request('DELETE', `/platform/companies/${id}/support-access`, { company: false })
}
