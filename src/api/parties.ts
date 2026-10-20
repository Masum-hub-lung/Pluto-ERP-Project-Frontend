import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { PageMeta, Party, PartyGroup, PartyInput, PaymentTerm, Warning } from './contract.gen'

/** Customer workflow data access (05 Parties tag). Query keys are hierarchical per company (08 §8). */
export interface PartyListFilters { q?: string; status?: string; balance?: string; area?: string; sort?: string; page?: number; per_page?: number }

const keys = {
  all: (cid: number | null) => ['company', cid, 'parties'] as const,
  list: (cid: number | null, f: PartyListFilters) => ['company', cid, 'parties', 'list', f] as const,
  one: (cid: number | null, id: number) => ['company', cid, 'parties', id] as const,
}

export function useCustomers(f: PartyListFilters) {
  const cid = api.getCompany()
  return useQuery({
    queryKey: keys.list(cid, f),
    queryFn: async ({ signal }) => (await api.request<{ data: Party[]; meta: PageMeta }>('GET', '/parties', { query: { type: 'customer', ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

/** Counts for the summary tile, from list totals (no summary endpoint exists in the contract yet). */
export function useCustomerCounts() {
  const cid = api.getCompany()
  return useQuery({
    queryKey: [...keys.all(cid), 'counts'],
    queryFn: async () => {
      const total = (s?: string) => api.request<{ meta: PageMeta }>('GET', '/parties', { query: { type: 'customer', status: s, per_page: 1 } })
        .then((r) => r.data.meta.total)
      const [all, active, inactive] = await Promise.all([total(), total('active'), total('inactive')])
      return { all, active, inactive }
    },
  })
}

export function useCustomer(id: number) {
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

export function useCustomerGroups() {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'party-groups', 'customer'],
    queryFn: async () => (await api.request<{ data: PartyGroup[] }>('GET', '/party-groups', { query: { type: 'customer' } })).data.data,
    staleTime: 5 * 60_000,
  })
}

export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: PartyInput; idempotencyKey: string }) =>
      (await api.request<{ data: Party; warnings?: Warning[] }>('POST', '/parties', { body: input, idempotencyKey })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }),
  })
}

export function useUpdateCustomer(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, version }: { input: Partial<PartyInput>; version: number }) =>
      (await api.request<{ data: Party }>('PATCH', `/parties/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }),
  })
}

export function useCustomerAction(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (action: 'deactivate' | 'reactivate' | 'delete') => action === 'delete'
      ? (await api.request<void>('DELETE', `/parties/${id}`)).data
      : (await api.request<{ data: Party }>('POST', `/parties/${id}/${action}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }),
  })
}
