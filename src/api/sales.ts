import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { BulkResult, CancelRequest, DeliveryUpdate, DocumentCalculation, EmailRequest, PageMeta, PostRequest, SalesInvoice, SalesInvoiceInput } from './contract.gen'

/**
 * Sales invoices data access (05 Sales tag, backlog P5.2-FE-01). Keys sit under ['company', cid, 'sales-invoices'].
 * Posting and cancelling move stock and money, so they also refresh the customer (parties), products, warehouses,
 * the stock ledger, receipts (cancelling frees their allocations), party accounts and money accounts (08 §8); drafts,
 * delivery details and e-mails change only the invoices.
 */
export interface InvoiceListFilters {
  q?: string; status?: string; payment_status?: string; overdue?: string; party_id?: number; date_from?: string; date_to?: string
  sort?: string; page?: number; per_page?: number
}

export type InvoiceVariant = 'invoice' | 'challan'

const keys = {
  all: (cid: number | null) => ['company', cid, 'sales-invoices'] as const,
  list: (cid: number | null, f: InvoiceListFilters) => ['company', cid, 'sales-invoices', 'list', f] as const,
  one: (cid: number | null, id: number) => ['company', cid, 'sales-invoices', id] as const,
}

export function useInvoices(f: InvoiceListFilters, enabled = true) {
  return useQuery({
    queryKey: keys.list(api.getCompany(), f),
    queryFn: async ({ signal }) => (await api.request<{ data: SalesInvoice[]; meta: PageMeta }>('GET', '/sales-invoices', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useInvoice(id: number) {
  return useQuery({
    queryKey: keys.one(api.getCompany(), id),
    queryFn: async ({ signal }) => (await api.request<{ data: SalesInvoice }>('GET', `/sales-invoices/${id}`, { signal })).data.data,
    retry: (n, e: unknown) => (e as { status?: number }).status !== 404 && n < 2,
    enabled: id > 0,
  })
}

/** POST /sales-invoices/calculate — the server's figures for an unsaved invoice (DEC-09); used through useCalculate. */
export function calculateInvoice(input: SalesInvoiceInput, signal?: AbortSignal) {
  return api.request<{ data: DocumentCalculation }>('POST', '/sales-invoices/calculate', { body: input, signal }).then((r) => r.data.data)
}

/** The invoice (or its delivery challan) as a PDF Blob: the API needs the Bearer token, so a plain link cannot open it. */
export function fetchInvoicePdf(id: number, variant: InvoiceVariant = 'invoice', signal?: AbortSignal) {
  return api.request<Blob>('GET', `/sales-invoices/${id}/pdf`, { query: { variant: variant === 'invoice' ? undefined : variant }, responseType: 'blob', signal }).then((r) => r.data)
}

/** Path of the PDF endpoint (for links shown to the user or logged; fetch it with fetchInvoicePdf). */
export function invoicePdfUrl(id: number, variant: InvoiceVariant = 'invoice') {
  return `/api/v1/sales-invoices/${id}/pdf${variant === 'challan' ? '?variant=challan' : ''}`
}

/** Saves the PDF under its number (e.g. INV-2026-0001.pdf). */
export async function downloadInvoicePdf(id: number, number: string, variant: InvoiceVariant = 'invoice') {
  const url = URL.createObjectURL(await fetchInvoicePdf(id, variant))
  const a = document.createElement('a')
  a.href = url
  a.download = `${variant === 'challan' ? 'challan-' : ''}${number}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
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

export function useCreateInvoice() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: SalesInvoiceInput; idempotencyKey: string }) =>
      (await api.request<{ data: SalesInvoice }>('POST', '/sales-invoices', { body: input, idempotencyKey })).data.data,
    onSuccess: () => refresh(false),
  })
}

export function useUpdateInvoice(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, version }: { input: SalesInvoiceInput; version: number }) =>
      (await api.request<{ data: SalesInvoice }>('PUT', `/sales-invoices/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: () => refresh(false),
  })
}

export function useDeleteInvoice(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async () => { await api.request<void>('DELETE', `/sales-invoices/${id}`) },
    onSuccess: () => refresh(false),
  })
}

/** Post (BR-009): one Idempotency-Key per user action, reused on retry, so a double click posts once. */
export function usePostInvoice(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ body = {}, idempotencyKey }: { body?: PostRequest; idempotencyKey: string }) =>
      (await api.request<{ data: SalesInvoice }>('POST', `/sales-invoices/${id}/post`, { body, idempotencyKey })).data.data,
    onSuccess: () => refresh(true),
  })
}

/** Post several drafts; each posts or fails on its own (per-item BulkResult, ERR-5). */
export function useBulkPostInvoices() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ ids, idempotencyKey }: { ids: number[]; idempotencyKey: string }) =>
      (await api.request<{ data: BulkResult }>('POST', '/sales-invoices/bulk-post', { body: { ids }, idempotencyKey })).data.data,
    onSuccess: () => refresh(true),
  })
}

export function useCancelInvoice(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: { body: CancelRequest; idempotencyKey: string }) =>
      (await api.request<{ data: SalesInvoice }>('POST', `/sales-invoices/${id}/cancel`, { body, idempotencyKey })).data.data,
    onSuccess: () => refresh(true),
  })
}

/** Challan, vehicle and delivery time (GAP-12), also after posting; needs the current version. */
export function useUpdateDelivery(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ body, version }: { body: DeliveryUpdate; version: number }) =>
      (await api.request<{ data: SalesInvoice }>('PATCH', `/sales-invoices/${id}/delivery`, { body, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: () => refresh(false),
  })
}

/** E-mail the PDF to the customer (queued; 202). An empty `to` uses the customer's e-mail on file. */
export function useSendInvoice(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: { body: EmailRequest; idempotencyKey: string }) => {
      await api.request<void>('POST', `/sales-invoices/${id}/send`, { body, idempotencyKey })
    },
    onSuccess: () => refresh(false),
  })
}
