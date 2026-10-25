import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { CancelRequest, DocumentCalculation, PageMeta, PostRequest, PurchaseBill, PurchaseBillInput } from './contract.gen'

/**
 * Purchase bills data access (05 Purchases tag, backlog P4.4-FE-01). Keys sit under ['company', cid, 'purchase-bills'].
 * Posting and cancelling move stock and money, so they also refresh the supplier (parties), products, warehouses and
 * the stock ledger (08 §8). Drafts change only the bills.
 */
export interface BillListFilters {
  q?: string; status?: string; payment_status?: string; overdue?: string; party_id?: number; date_from?: string; date_to?: string
  sort?: string; page?: number; per_page?: number
}

const keys = {
  all: (cid: number | null) => ['company', cid, 'purchase-bills'] as const,
  list: (cid: number | null, f: BillListFilters) => ['company', cid, 'purchase-bills', 'list', f] as const,
  one: (cid: number | null, id: number) => ['company', cid, 'purchase-bills', id] as const,
}

export function useBills(f: BillListFilters) {
  return useQuery({
    queryKey: keys.list(api.getCompany(), f),
    queryFn: async ({ signal }) => (await api.request<{ data: PurchaseBill[]; meta: PageMeta }>('GET', '/purchase-bills', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useBill(id: number) {
  return useQuery({
    queryKey: keys.one(api.getCompany(), id),
    queryFn: async ({ signal }) => (await api.request<{ data: PurchaseBill }>('GET', `/purchase-bills/${id}`, { signal })).data.data,
    retry: (n, e: unknown) => (e as { status?: number }).status !== 404 && n < 2,
    enabled: id > 0,
  })
}

/** POST /purchase-bills/calculate — the server's figures for an unsaved bill (DEC-09); used through useCalculate. */
export function calculateBill(input: PurchaseBillInput, signal?: AbortSignal) {
  return api.request<{ data: DocumentCalculation }>('POST', '/purchase-bills/calculate', { body: input, signal }).then((r) => r.data.data)
}

export function useCalculateBill() {
  return useMutation({ mutationFn: ({ input, signal }: { input: PurchaseBillInput; signal?: AbortSignal }) => calculateBill(input, signal) })
}

function useRefresh() {
  const qc = useQueryClient()
  return (moved: boolean) => {
    const cid = api.getCompany()
    void qc.invalidateQueries({ queryKey: keys.all(cid) })
    if (moved) {
      for (const k of ['parties', 'products', 'warehouses', 'stock-movements', 'product-categories', 'stock-groups', 'customer-receipts', 'party-accounts', 'money-accounts']) void qc.invalidateQueries({ queryKey: ['company', cid, k] })
    }
  }
}

export function useCreateBill() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: PurchaseBillInput; idempotencyKey: string }) =>
      (await api.request<{ data: PurchaseBill }>('POST', '/purchase-bills', { body: input, idempotencyKey })).data.data,
    onSuccess: () => refresh(false),
  })
}

export function useUpdateBill(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, version }: { input: PurchaseBillInput; version: number }) =>
      (await api.request<{ data: PurchaseBill }>('PUT', `/purchase-bills/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: () => refresh(false),
  })
}

export function useDeleteBill(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async () => { await api.request<void>('DELETE', `/purchase-bills/${id}`) },
    onSuccess: () => refresh(false),
  })
}

/** Post (BR-009): one Idempotency-Key per user action, reused on retry, so a double click posts once. */
export function usePostBill(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ body = {}, idempotencyKey }: { body?: PostRequest; idempotencyKey: string }) =>
      (await api.request<{ data: PurchaseBill }>('POST', `/purchase-bills/${id}/post`, { body, idempotencyKey })).data.data,
    onSuccess: () => refresh(true),
  })
}

export function useCancelBill(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: { body: CancelRequest; idempotencyKey: string }) =>
      (await api.request<{ data: PurchaseBill }>('POST', `/purchase-bills/${id}/cancel`, { body, idempotencyKey })).data.data,
    onSuccess: () => refresh(true),
  })
}
