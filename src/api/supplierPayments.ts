import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { PageMeta, PartyPaymentInput, Voucher } from './contract.gen'

/**
 * Supplier payments (05 Purchases: /supplier-payments; F5, F12, Pur-DlgPay; backlog P8.2-FE-01). A payment moves the
 * supplier, its bills, the bank or cash account and — when it waits for approval — the approvals feed, so a create
 * refreshes all of them (08 §8). 202 = above the user's payment limit: saved and sent for approval (BR-007).
 */
export interface SupplierPaymentFilters {
  q?: string; party_id?: number; money_account_id?: number; status?: string; date_from?: string; date_to?: string; sort?: string; page?: number; per_page?: number
}

const keys = {
  list: (cid: number | null, f: SupplierPaymentFilters) => ['company', cid, 'supplier-payments', 'list', f] as const,
  one: (cid: number | null, id: number) => ['company', cid, 'supplier-payments', id] as const,
}

export function useSupplierPayments(f: SupplierPaymentFilters) {
  return useQuery({
    queryKey: keys.list(api.getCompany(), f),
    queryFn: async ({ signal }) => (await api.request<{ data: Voucher[]; meta: PageMeta }>('GET', '/supplier-payments', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useSupplierPayment(id: number) {
  return useQuery({
    queryKey: keys.one(api.getCompany(), id),
    queryFn: async ({ signal }) => (await api.request<{ data: Voucher }>('GET', `/supplier-payments/${id}`, { signal })).data.data,
    retry: (n, e: unknown) => (e as { status?: number }).status !== 404 && n < 2,
    enabled: id > 0,
  })
}

/** Saves the A4 payment voucher under its number. */
export async function downloadSupplierPaymentPdf(id: number, number: string) {
  const blob = (await api.request<Blob>('GET', `/supplier-payments/${id}/pdf`, { responseType: 'blob' })).data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${number}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function useCreateSupplierPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: PartyPaymentInput; idempotencyKey: string }) => {
      const r = await api.request<{ data: Voucher }>('POST', '/supplier-payments', { body: input, idempotencyKey })
      return { voucher: r.data.data, approval: r.meta.status === 202 }
    },
    onSuccess: () => {
      const cid = api.getCompany()
      for (const k of ['supplier-payments', 'purchase-bills', 'parties', 'party-accounts', 'money-accounts', 'approvals', 'notifications', 'accounting']) {
        void qc.invalidateQueries({ queryKey: ['company', cid, k] })
      }
    },
  })
}
