import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { BulkResult, PageMeta, Party, PartyGroup, PartyGroupInput, PartyInput, PaymentTerm, Warning } from './contract.gen'

/**
 * Customer and supplier data access (05 Parties tag; generalised for suppliers in P2.2-FE-01). Query keys are
 * hierarchical per company (08 §8): every parties query sits under ['company', cid, 'parties', …], so invalidating
 * keys.all refreshes lists, counts and details of both types after any change.
 */
export type PartyType = 'customer' | 'supplier'
export interface PartyListFilters {
  q?: string; status?: string; balance?: string; area?: string; country_code?: string; group_id?: number; sort?: string; page?: number; per_page?: number
}

const keys = {
  all: (cid: number | null) => ['company', cid, 'parties'] as const,
  list: (cid: number | null, type: PartyType, f: PartyListFilters) => ['company', cid, 'parties', 'list', { type, ...f }] as const,
  counts: (cid: number | null, type: PartyType) => ['company', cid, 'parties', 'counts', type] as const,
  one: (cid: number | null, id: number) => ['company', cid, 'parties', id] as const,
  groups: (cid: number | null, type: PartyType) => ['company', cid, 'party-groups', type] as const,
}

export function useParties(type: PartyType, f: PartyListFilters) {
  const cid = api.getCompany()
  return useQuery({
    queryKey: keys.list(cid, type, f),
    queryFn: async ({ signal }) => (await api.request<{ data: Party[]; meta: PageMeta }>('GET', '/parties', { query: { type, ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

/** Counts for the summary tile, from list totals (no summary endpoint exists in the contract, docs 15 D5). */
export function usePartyCounts(type: PartyType) {
  const cid = api.getCompany()
  return useQuery({
    queryKey: keys.counts(cid, type),
    queryFn: async () => {
      const total = (s?: string) => api.request<{ meta: PageMeta }>('GET', '/parties', { query: { type, status: s, per_page: 1 } })
        .then((r) => r.data.meta.total)
      const [all, active, inactive] = await Promise.all([total(), total('active'), total('inactive')])
      return { all, active, inactive }
    },
  })
}

export function useParty(id: number) {
  const cid = api.getCompany()
  return useQuery({
    queryKey: keys.one(cid, id),
    queryFn: async ({ signal }) => {
      const r = await api.request<{ data: Party }>('GET', `/parties/${id}`, { signal })
      return { party: r.data.data, etag: r.meta.etag }
    },
    retry: (n, e: unknown) => (e as { status?: number }).status !== 404 && n < 2,
    enabled: id > 0,
  })
}

export function usePaymentTerms() {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'payment-terms'],
    queryFn: async () => (await api.request<{ data: PaymentTerm[] }>('GET', '/payment-terms')).data.data,
    staleTime: 5 * 60_000,
  })
}

export function usePartyGroups(type: PartyType) {
  return useQuery({
    queryKey: keys.groups(api.getCompany(), type),
    queryFn: async () => (await api.request<{ data: PartyGroup[] }>('GET', '/party-groups', { query: { type } })).data.data,
    staleTime: 5 * 60_000,
  })
}

/** "Add group…" in the B2/C2 group select (P2.1-BE-02): the new group appears in the select straight away. */
export function useCreatePartyGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: PartyGroupInput; idempotencyKey: string }) =>
      (await api.request<{ data: PartyGroup }>('POST', '/party-groups', { body: input, idempotencyKey })).data.data,
    onSuccess: (_g, { input }) => qc.invalidateQueries({ queryKey: keys.groups(api.getCompany(), input.party_type) }),
  })
}

export function useCreateParty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: PartyInput; idempotencyKey: string }) =>
      (await api.request<{ data: Party; warnings?: Warning[] }>('POST', '/parties', { body: input, idempotencyKey })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }),
  })
}

export function useUpdateParty(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, version }: { input: Partial<PartyInput>; version: number }) =>
      (await api.request<{ data: Party }>('PATCH', `/parties/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }),
  })
}

export function usePartyAction(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (action: 'deactivate' | 'reactivate' | 'delete') => action === 'delete'
      ? (await api.request<void>('DELETE', `/parties/${id}`)).data
      : (await api.request<{ data: Party }>('POST', `/parties/${id}/${action}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }),
  })
}

/** B1/C1 "Deactivate selected" (P2.1-BE-03): per-item results, never all-or-nothing. */
export function useBulkDeactivate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: number[]) =>
      (await api.request<{ data: BulkResult }>('POST', '/parties/bulk-deactivate', { body: { ids } })).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }),
  })
}

// Customer pages (B1–B4) keep their original hook names.
export const useCustomers = (f: PartyListFilters) => useParties('customer', f)
export const useCustomerCounts = () => usePartyCounts('customer')
export const useCustomer = useParty
export const useCustomerGroups = () => usePartyGroups('customer')
export const useCreateCustomer = useCreateParty
export const useUpdateCustomer = useUpdateParty
export const useCustomerAction = usePartyAction
