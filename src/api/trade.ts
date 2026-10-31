import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  BulkResult, EmailRequest, LowStockOrderRequest, Note, NoteInput, PageMeta, PurchaseBill, PurchaseOrder, PurchaseOrderInput, Quotation, QuotationInput,
  ReasonRequest, ReportData, Return, ReturnInput, SalesInvoice, StatusChange,
} from './contract.gen'

/**
 * Trade completion data access (05 Sales/Purchases; backlog P10): quotations, purchase orders, sales and purchase returns,
 * credit and debit notes, and the sales/purchase overviews. Every document type shares the same hooks, built by
 * `documentApi`: list, one, create, update (If-Match), delete, and POST actions (send, status, convert, post, cancel).
 * Keys sit under ['company', cid, resource]. Actions that post or convert also refresh what they move (08 §8): stock,
 * parties, party accounts, invoices or bills, money accounts.
 */
export type ListFilters = Record<string, string | number | undefined>

type Resource = 'quotations' | 'purchase-orders' | 'sales-returns' | 'credit-notes' | 'purchase-returns' | 'debit-notes' | 'stock-adjustments' | 'stock-transfers'

/** What else changes when a document of this kind posts, converts or cancels. */
const MOVES: Record<Resource, string[]> = {
  'quotations': ['sales-invoices', 'parties'],
  'purchase-orders': ['purchase-bills'],
  'sales-returns': ['credit-notes', 'sales-invoices', 'products', 'warehouses', 'stock-movements', 'parties', 'party-accounts'],
  'credit-notes': ['sales-returns', 'sales-invoices', 'parties', 'party-accounts', 'customer-receipts', 'money-accounts'],
  'purchase-returns': ['debit-notes', 'purchase-bills', 'products', 'warehouses', 'stock-movements', 'parties', 'party-accounts'],
  'debit-notes': ['purchase-returns', 'purchase-bills', 'parties', 'party-accounts'],
  'stock-adjustments': ['products', 'warehouses', 'stock-movements', 'warehouse-stock', 'reports'],
  'stock-transfers': ['products', 'warehouses', 'stock-movements', 'warehouse-stock', 'reports'],
}

/** `update`: PUT for trade documents, PATCH for the stock documents (05). */
export function documentApi<T extends { id: number; version: number }, I>(resource: Resource, update: 'PUT' | 'PATCH' = 'PUT') {
  const all = (cid: number | null) => ['company', cid, resource] as const

  function useRefresh() {
    const qc = useQueryClient()
    return (moved: boolean) => {
      const cid = api.getCompany()
      void qc.invalidateQueries({ queryKey: all(cid) })
      if (moved) for (const k of MOVES[resource]) void qc.invalidateQueries({ queryKey: ['company', cid, k] })
    }
  }

  return {
    useList(f: ListFilters, enabled = true) {
      return useQuery({
        queryKey: [...all(api.getCompany()), 'list', f],
        queryFn: async ({ signal }) => (await api.request<{ data: T[]; meta: PageMeta }>('GET', `/${resource}`, { query: f, signal })).data,
        placeholderData: keepPreviousData,
        enabled,
      })
    },
    useOne(id: number) {
      return useQuery({
        queryKey: [...all(api.getCompany()), id],
        queryFn: async ({ signal }) => (await api.request<{ data: T }>('GET', `/${resource}/${id}`, { signal })).data.data,
        retry: (n, e: unknown) => (e as { status?: number }).status !== 404 && n < 2,
        enabled: id > 0,
      })
    },
    useCreate() {
      const refresh = useRefresh()
      return useMutation({
        mutationFn: async ({ input, idempotencyKey }: { input: I; idempotencyKey: string }) =>
          (await api.request<{ data: T }>('POST', `/${resource}`, { body: input, idempotencyKey })).data.data,
        onSuccess: () => refresh(false),
      })
    },
    useUpdate(id: number) {
      const refresh = useRefresh()
      return useMutation({
        mutationFn: async ({ input, version }: { input: I; version: number }) =>
          (await api.request<{ data: T }>(update, `/${resource}/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
        onSuccess: () => refresh(false),
      })
    },
    useDelete(id: number) {
      const refresh = useRefresh()
      return useMutation({
        mutationFn: async () => { await api.request<void>('DELETE', `/${resource}/${id}`) },
        onSuccess: () => refresh(false),
      })
    },
    /** POST /{resource}/{id}/{action}; `moves` refreshes what that action changes elsewhere. One Idempotency-Key per user action. */
    useAction<B = Record<string, never>, R = T>(id: number, action: string, moves = true) {
      const refresh = useRefresh()
      return useMutation({
        mutationFn: async ({ body, idempotencyKey }: { body?: B; idempotencyKey?: string }) =>
          (await api.request<{ data: R }>('POST', `/${resource}/${id}/${action}`, { body: body ?? {}, idempotencyKey })).data.data,
        onSuccess: () => refresh(moves),
      })
    },
    /** The document's PDF as a Blob (the API needs the Bearer token, so a plain link cannot open it). */
    async pdf(id: number) {
      return (await api.request<Blob>('GET', `/${resource}/${id}/pdf`, { responseType: 'blob' })).data
    },
  }
}

export const quotations = documentApi<Quotation, QuotationInput>('quotations')
export const purchaseOrders = documentApi<PurchaseOrder, PurchaseOrderInput>('purchase-orders')
export const salesReturns = documentApi<Return, ReturnInput>('sales-returns')
export const creditNotes = documentApi<Note, NoteInput>('credit-notes')
export const purchaseReturns = documentApi<Return, ReturnInput>('purchase-returns')
export const debitNotes = documentApi<Note, NoteInput>('debit-notes')

export type { BulkResult, EmailRequest, ReasonRequest, StatusChange, SalesInvoice, PurchaseBill }

/** Opens a PDF in a new tab (phones) or saves it under its number. */
export async function openPdf(load: () => Promise<Blob>, filename: string, save = false) {
  const url = URL.createObjectURL(await load())
  if (save) {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  } else {
    window.open(url, '_blank', 'noopener')
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** POST /purchase-orders/from-low-stock (D12): one draft PO per preferred supplier and warehouse. */
export function useOrderFromLowStock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: { body: LowStockOrderRequest; idempotencyKey: string }) =>
      (await api.request<{ data: BulkResult }>('POST', '/purchase-orders/from-low-stock', { body, idempotencyKey })).data.data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['company', api.getCompany(), 'purchase-orders'] }),
  })
}

export type OverviewPeriod = 'this_month' | 'last_month' | 'this_quarter' | 'this_year'

/** GET /sales/overview and /purchases/overview (E1, F1): tiles, 12 months, status, recent, top 5 — refetched on every open. */
export function useOverview(side: 'sales' | 'purchases', period: OverviewPeriod) {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'overview', side, period],
    queryFn: async ({ signal }) => (await api.request<{ data: ReportData }>('GET', `/${side}/overview`, { query: { period }, signal })).data.data,
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

/** Overview meta (E1/F1) as the backend builds it (app/Queries/Reports/TradeOverviewQuery). */
export interface OverviewMeta {
  months: { month: string; label: string; value: string }[]
  status: Record<'draft' | 'unpaid' | 'part_paid' | 'paid' | 'overdue', { count: number; value: string }>
  recent: { id: number; number: string; date: string; party: string | null; total: string; status: string; payment_status: string }[]
}
