import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { CompanyPlanInput, OwnerAccess, OwnerAccessInput, PageMeta, Plan, PlanInput, PlatformCompany, PlatformCompanyCreate, SupportAccess } from './contract.gen'

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

/**
 * PEP-496: join a company as an Owner (a real membership, so everything can be changed; its Owners are told and each
 * change is in its audit log under the admin's name). Then switch to it with `useSession().switchCompany(id)`.
 */
export function useOwnerAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input, idempotencyKey }: { id: number; input: OwnerAccessInput; idempotencyKey: string }) =>
      (await api.request<{ data: OwnerAccess }>('POST', `/platform/companies/${id}/owner-access`, { company: false, body: input, idempotencyKey })).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: key() }),
  })
}

/** PEP-496: leave a company joined as Owner (409 last_owner while the admin is its only active Owner). */
export function useLeaveOwnerAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => { await api.request('DELETE', `/platform/companies/${id}/owner-access`, { company: false }) },
    onSuccess: () => qc.invalidateQueries({ queryKey: key() }),
  })
}

/** PEP-498: Pluto plans (users, branches, modules) with how many companies are on each. */
export function usePlans(enabled = true) {
  return useQuery({
    queryKey: ['platform', 'plans'] as const,
    queryFn: async ({ signal }) => (await api.request<{ data: Plan[] }>('GET', '/platform/plans', { company: false, signal })).data.data,
    staleTime: 0, enabled,
  })
}

/** PEP-498: create a plan (no id) or change one (If-Match its version); every company on it follows at once. */
export function useSavePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input, version, idempotencyKey }: { id?: number; input: PlanInput; version?: number; idempotencyKey: string }) =>
      (await (id
        ? api.request<{ data: Plan }>('PUT', `/platform/plans/${id}`, { company: false, body: input, ifMatch: `W/"${version}"` })
        : api.request<{ data: Plan }>('POST', '/platform/plans', { company: false, body: input, idempotencyKey }))).data.data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['platform'] }) },
  })
}

/** PEP-498: put a company on a plan with optional exceptions (its Owners are told). */
export function useCompanyPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: CompanyPlanInput }) =>
      (await api.request<{ data: PlatformCompany }>('POST', `/platform/companies/${id}/plan`, { company: false, body: input })).data.data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['platform'] }) },
  })
}

/** PEP-499: delete a plan no company is on (409 plan_in_use while companies are on it). */
export function useDeletePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => { await api.request('DELETE', `/platform/plans/${id}`, { company: false }) },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['platform'] }) },
  })
}
