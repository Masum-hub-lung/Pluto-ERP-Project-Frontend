import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Allocation, AllocationCreate, OpenDocuments, PageMeta, PartyPaymentInput, Voucher } from './contract.gen'

/**
 * Customer receipts, allocations and open documents (05 Sales/Settlements, E7/E14, R-08; backlog P6.2-FE-01).
 * A receipt or an allocation changes balances, so it refreshes receipts, invoices, bills, parties and money accounts
 * (08 §8). The Voucher's `payment` block is loosely typed in the contract; ReceiptPayment names what E7/E14 read.
 */
export interface ReceiptListFilters {
  q?: string; party_id?: number; money_account_id?: number; unapplied?: string; date_from?: string; date_to?: string; sort?: string; page?: number; per_page?: number
}

export interface ReceiptAllocation { id: number; document_type: 'sales_invoice' | 'purchase_bill'; document_id: number; document_number: string; amount: string; allocated_on: string }
export interface ReceiptPayment {
  direction: string; party: { id: number; code: string; name: string } | null; money_account: { id: number; name: string; account_type: string }
  method: string; cheque_number: string | null; cheque_date: string | null; drawn_on: string | null; transaction_reference: string | null
  amount: string; bank_charge: string; net_received: string; unapplied_amount: string; allocations: ReceiptAllocation[]
}
export const paymentOf = (v: Voucher) => v.payment as unknown as ReceiptPayment | null

export const METHODS: Array<{ value: PartyPaymentInput['method']; label: string }> = [
  { value: 'cash', label: 'Cash' }, { value: 'cheque', label: 'Cheque' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'beftn', label: 'BEFTN' },
  { value: 'rtgs', label: 'RTGS' }, { value: 'npsb', label: 'NPSB' }, { value: 'bkash', label: 'bKash' }, { value: 'nagad', label: 'Nagad' }, { value: 'card', label: 'Card' },
]
export const methodLabel = (m: string) => METHODS.find((x) => x.value === m)?.label ?? m

const keys = {
  all: (cid: number | null) => ['company', cid, 'customer-receipts'] as const,
  list: (cid: number | null, f: ReceiptListFilters) => ['company', cid, 'customer-receipts', 'list', f] as const,
  one: (cid: number | null, id: number) => ['company', cid, 'customer-receipts', id] as const,
  open: (cid: number | null, partyId: number) => ['company', cid, 'parties', partyId, 'open-documents'] as const,
}

export function useReceipts(f: ReceiptListFilters) {
  return useQuery({
    queryKey: keys.list(api.getCompany(), f),
    queryFn: async ({ signal }) => (await api.request<{ data: Voucher[]; meta: PageMeta }>('GET', '/customer-receipts', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useReceipt(id: number) {
  return useQuery({
    queryKey: keys.one(api.getCompany(), id),
    queryFn: async ({ signal }) => (await api.request<{ data: Voucher }>('GET', `/customer-receipts/${id}`, { signal })).data.data,
    retry: (n, e: unknown) => (e as { status?: number }).status !== 404 && n < 2,
    enabled: id > 0,
  })
}

/** Open invoices/bills of a party, oldest due first, and its unapplied credits (R-08). */
export function useOpenDocuments(partyId: number) {
  return useQuery({
    queryKey: keys.open(api.getCompany(), partyId),
    queryFn: async ({ signal }) => (await api.request<{ data: OpenDocuments }>('GET', `/parties/${partyId}/open-documents`, { signal })).data.data,
    enabled: partyId > 0,
  })
}

/** Saves the money receipt (A5 PDF) under its number. */
export async function downloadReceiptPdf(id: number, number: string) {
  const blob = (await api.request<Blob>('GET', `/customer-receipts/${id}/pdf`, { responseType: 'blob' })).data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${number}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function useRefresh() {
  const qc = useQueryClient()
  return () => {
    const cid = api.getCompany()
    for (const k of ['customer-receipts', 'sales-invoices', 'purchase-bills', 'parties', 'money-accounts', 'party-accounts']) void qc.invalidateQueries({ queryKey: ['company', cid, k] })
  }
}

export function useCreateReceipt() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: PartyPaymentInput; idempotencyKey: string }) =>
      (await api.request<{ data: Voucher }>('POST', '/customer-receipts', { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

/** Apply an open credit (receipt, advance, note) to an invoice or bill later (R-08). */
export function useCreateAllocation() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: AllocationCreate; idempotencyKey: string }) =>
      (await api.request<{ data: Allocation }>('POST', '/allocations', { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useDeleteAllocation() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (id: number) => { await api.request<void>('DELETE', `/allocations/${id}`) },
    onSuccess: refresh,
  })
}
