import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  LandedCostAllocation, LandedCostRequest, LcAmendment, LcAmendmentInput, LcAmendmentStatus, LcCharge, LcChargeInput, LcCloseRequest, LcDocument, LcDocumentInput,
  LcDocumentTemplate, LcDocumentTemplateInput, LcItemsInput, LcPayment, LcPaymentInput, LcShipment, LcShipmentInput, LcTransition, LetterOfCredit, LetterOfCreditInput, PageMeta,
  ReportData,
} from './contract.gen'

/**
 * Letters of credit and landed cost (05 LC; M1–M8, LC-DlgPay, LC-DlgClose, LC-DrawerCharge; backlog P16.2-FE). Keys under
 * ['company', cid, 'lc', …]. Anything that posts (charges, payments, landed cost, close) also moves money accounts,
 * bills, stock, party balances and reports, so those are refreshed too. Every figure is the API's.
 */
const cid = () => api.getCompany()
const base = () => ['company', cid(), 'lc'] as const

export interface LcListFilters { q?: string; group?: string; bank_account_id?: number; party_id?: number; attention?: 'true'; sort?: string; page?: number; per_page?: number }

export function useLcs(f: LcListFilters, enabled = true) {
  return useQuery({
    queryKey: [...base(), 'list', f],
    queryFn: async ({ signal }) => (await api.request<{ data: LetterOfCredit[]; meta: PageMeta }>('GET', '/letters-of-credit', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useLc(id: number) {
  return useQuery({
    queryKey: [...base(), 'one', id],
    queryFn: async ({ signal }) => (await api.request<{ data: LetterOfCredit }>('GET', `/letters-of-credit/${id}`, { signal })).data.data,
    enabled: id > 0,
    staleTime: 0, refetchOnMount: 'always',
  })
}

/** M1 overview, M6 matrix and M7 cost summary are ReportData; rows/totals/meta as LcQuery builds them. */
export function useLcOverview() {
  return useQuery({
    queryKey: [...base(), 'overview'],
    queryFn: async ({ signal }) => (await api.request<{ data: ReportData }>('GET', '/lc/overview', { signal })).data.data,
    staleTime: 0, refetchOnMount: 'always',
  })
}

export function useLcMatrix() {
  return useQuery({
    queryKey: [...base(), 'matrix'],
    queryFn: async ({ signal }) => (await api.request<{ data: ReportData }>('GET', '/lc-documents/matrix', { signal })).data.data,
    staleTime: 0, refetchOnMount: 'always',
  })
}

export function useLcCostSummary(id: number) {
  return useQuery({
    queryKey: [...base(), 'cost', id],
    queryFn: async ({ signal }) => (await api.request<{ data: ReportData }>('GET', `/letters-of-credit/${id}/cost-summary`, { signal })).data.data,
    enabled: id > 0,
    staleTime: 0, refetchOnMount: 'always',
  })
}

export function useLcTemplates() {
  return useQuery({
    queryKey: [...base(), 'templates'],
    queryFn: async ({ signal }) => (await api.request<{ data: LcDocumentTemplate[] }>('GET', '/lc-document-templates', { signal })).data.data,
    staleTime: 5 * 60_000,
  })
}

export function useLcCharges(f: { letter_of_credit_id?: number; status?: string; q?: string; page?: number; per_page?: number }) {
  return useQuery({
    queryKey: [...base(), 'charges', f],
    queryFn: async ({ signal }) => (await api.request<{ data: LcCharge[]; meta: PageMeta }>('GET', '/lc-charges', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useLcAmendments(f: { status?: string; q?: string; page?: number; per_page?: number }) {
  return useQuery({
    queryKey: [...base(), 'amendments', f],
    queryFn: async ({ signal }) => (await api.request<{ data: LcAmendment[]; meta: PageMeta }>('GET', '/lc-amendments', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useLcReport(report: string, query: Record<string, string | undefined>) {
  const q = Object.fromEntries(Object.entries(query).filter(([, v]) => v)) as Record<string, string>
  return useQuery({
    queryKey: [...base(), 'report', report, q],
    queryFn: async ({ signal }) => (await api.request<{ data: ReportData }>('GET', `/reports/lc/${report}`, { query: q, signal })).data.data,
    placeholderData: keepPreviousData,
    staleTime: 0, refetchOnMount: 'always',
  })
}

function useRefresh(posting = false) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: base() })
    if (posting) {
      for (const k of ['money-accounts', 'banking', 'accounting', 'purchase-bills', 'parties', 'party-accounts', 'stock', 'inventory', 'reports', 'dashboard']) {
        void qc.invalidateQueries({ queryKey: ['company', cid(), k] })
      }
    }
  }
}

const one = (r: { data: { data: LetterOfCredit } }) => r.data.data

export function useCreateLc() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: LetterOfCreditInput; idempotencyKey: string }) =>
      one(await api.request<{ data: LetterOfCredit }>('POST', '/letters-of-credit', { body: input, idempotencyKey })),
    onSuccess: refresh,
  })
}

export function useUpdateLc(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, version }: { input: LetterOfCreditInput; version: number }) =>
      one(await api.request<{ data: LetterOfCredit }>('PUT', `/letters-of-credit/${id}`, { body: input, ifMatch: `W/"${version}"` })),
    onSuccess: refresh,
  })
}

/** PEP-487: the items of an LC that has none (the server creates and links the purchase order that keeps them). */
export function useAddLcItems(id: number) {
  const refresh = useRefresh()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: LcItemsInput; idempotencyKey: string }) =>
      one(await api.request<{ data: LetterOfCredit }>('POST', `/letters-of-credit/${id}/items`, { body: input, idempotencyKey })),
    onSuccess: () => { refresh(); void qc.invalidateQueries({ queryKey: ['company', cid(), 'purchase-orders'] }) },
  })
}

export function useDeleteLc(id: number) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: async () => { await api.request('DELETE', `/letters-of-credit/${id}`) }, onSuccess: refresh })
}

export function useLcTransition(id: number) {
  const refresh = useRefresh(true)
  return useMutation({
    mutationFn: async ({ body, version }: { body: LcTransition; version: number }) =>
      one(await api.request<{ data: LetterOfCredit }>('POST', `/letters-of-credit/${id}/transition`, { body, ifMatch: `W/"${version}"` })),
    onSuccess: refresh,
  })
}

export function useCloseLc(id: number) {
  const refresh = useRefresh(true)
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: { body: LcCloseRequest; idempotencyKey: string }) =>
      one(await api.request<{ data: LetterOfCredit }>('POST', `/letters-of-credit/${id}/close`, { body, idempotencyKey })),
    onSuccess: refresh,
  })
}

export function useAddLcDocument(lcId: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (input: LcDocumentInput) => (await api.request<{ data: LcDocument }>('POST', `/letters-of-credit/${lcId}/documents`, { body: input })).data.data,
    onSuccess: refresh,
  })
}

export function useUpdateLcDocument() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ id, input, version }: { id: number; input: Partial<LcDocumentInput>; version: number }) =>
      (await api.request<{ data: LcDocument }>('PATCH', `/lc-documents/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: refresh,
  })
}

export function useSaveLcTemplate() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ id, input }: { id?: number; input: LcDocumentTemplateInput }) =>
      (await api.request<{ data: LcDocumentTemplate }>(id ? 'PUT' : 'POST', id ? `/lc-document-templates/${id}` : '/lc-document-templates',
        { body: input })).data.data,
    onSuccess: refresh,
  })
}

export function useAddShipment(lcId: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (input: LcShipmentInput) => (await api.request<{ data: LcShipment }>('POST', `/letters-of-credit/${lcId}/shipments`, { body: input })).data.data,
    onSuccess: refresh,
  })
}

export function useUpdateShipment() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ id, input, version }: { id: number; input: LcShipmentInput; version: number }) =>
      (await api.request<{ data: LcShipment }>('PATCH', `/lc-shipments/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: refresh,
  })
}

export function useRecordAmendment(lcId: number) {
  const refresh = useRefresh(true)
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: LcAmendmentInput; idempotencyKey: string }) =>
      (await api.request<{ data: LcAmendment }>('POST', `/letters-of-credit/${lcId}/amendments`, { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useAmendmentStatus() {
  const refresh = useRefresh(true)
  return useMutation({
    mutationFn: async ({ id, input, version }: { id: number; input: LcAmendmentStatus; version: number }) =>
      (await api.request<{ data: LcAmendment }>('PATCH', `/lc-amendments/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: refresh,
  })
}

export function useAddCharge() {
  const refresh = useRefresh(true)
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: LcChargeInput; idempotencyKey: string }) =>
      (await api.request<{ data: LcCharge }>('POST', '/lc-charges', { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function usePayCharge() {
  const refresh = useRefresh(true)
  return useMutation({
    mutationFn: async ({ id, body, idempotencyKey }: { id: number; body: { paid_from_account_id: number; date: string }; idempotencyKey: string }) =>
      (await api.request<{ data: LcCharge }>('POST', `/lc-charges/${id}/pay`, { body, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useRecordLcPayment(lcId: number) {
  const refresh = useRefresh(true)
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: LcPaymentInput; idempotencyKey: string }) =>
      (await api.request<{ data: LcPayment }>('POST', `/letters-of-credit/${lcId}/payments`, { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export type Reversible = 'lc-charges' | 'lc-payments' | 'landed-cost-allocations'

/** Reverse a charge, payment or landed-cost allocation (R-03): a reason is required and kept in the audit log. */
export function useReverseLcItem() {
  const refresh = useRefresh(true)
  return useMutation({
    mutationFn: async ({ kind, id, reason, idempotencyKey }: { kind: Reversible; id: number; reason: string; idempotencyKey: string }) =>
      (await api.request<{ data: unknown }>('POST', `/${kind}/${id}/reverse`, { body: { reason }, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useLandedCost(lcId: number) {
  const refresh = useRefresh(true)
  const preview = useMutation({
    mutationFn: async (input: LandedCostRequest) => (await api.request<{ data: LandedCostAllocation }>('POST', `/letters-of-credit/${lcId}/landed-cost/preview`, { body: input })).data.data,
  })
  const allocate = useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: LandedCostRequest; idempotencyKey: string }) =>
      (await api.request<{ data: LandedCostAllocation }>('POST', `/letters-of-credit/${lcId}/landed-cost`, { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
  return { preview, allocate }
}

export function fetchLcPdf(id: number, signal?: AbortSignal) {
  return api.request<Blob>('GET', `/letters-of-credit/${id}/pdf`, { responseType: 'blob', signal }).then((r) => r.data)
}

// ------------------------------------------------------------------ labels (display only; no figures)

export const LC_STATUS: Record<string, { label: string; tone: 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'accent' }> = {
  draft: { label: 'Draft', tone: 'neutral' }, awaiting_bank: { label: 'Awaiting bank', tone: 'info' }, opened: { label: 'Opened', tone: 'positive' },
  partly_shipped: { label: 'Partly shipped', tone: 'accent' }, documents_presented: { label: 'Documents presented', tone: 'accent' },
  payment_due: { label: 'Payment due', tone: 'warning' }, closed: { label: 'Closed', tone: 'neutral' }, cancelled: { label: 'Cancelled', tone: 'negative' },
  expired: { label: 'Expired', tone: 'negative' },
}

export const CHARGE_TYPES: Array<{ value: LcChargeInput['charge_type']; label: string; landed: boolean }> = [
  { value: 'margin_deposit', label: 'Margin deposit', landed: false },
  { value: 'opening_commission', label: 'LC opening commission', landed: true },
  { value: 'amendment_fee', label: 'Amendment fee', landed: true },
  { value: 'swift_postage', label: 'SWIFT and postage', landed: true },
  { value: 'stamp_documentation', label: 'Stamp and documentation', landed: true },
  { value: 'acceptance_commission', label: 'Acceptance commission', landed: true },
  { value: 'discrepancy_fee', label: 'Discrepancy fee', landed: true },
  { value: 'marine_insurance', label: 'Marine insurance', landed: true },
  { value: 'cf_agent_fee', label: 'C&F agent fee', landed: true },
  { value: 'port_handling', label: 'Port and handling', landed: true },
  { value: 'customs_duty_taxes', label: 'Customs duty and taxes', landed: true },
  { value: 'inland_transport', label: 'Inland transport', landed: true },
  { value: 'other', label: 'Other', landed: true },
]

export const chargeLabel = (t: string) => CHARGE_TYPES.find((c) => c.value === t)?.label ?? t.replace(/_/g, ' ')

export const DOC_STATUS: Record<string, { label: string; tone: 'neutral' | 'positive' | 'negative' | 'warning' | 'info' }> = {
  not_yet_due: { label: 'Not yet due', tone: 'neutral' }, pending: { label: 'Pending', tone: 'info' }, received: { label: 'Received', tone: 'positive' },
  missing: { label: 'Missing', tone: 'negative' }, discrepant: { label: 'Discrepant', tone: 'warning' }, not_required: { label: 'Not required', tone: 'neutral' },
}

export const SHIPMENT_STATUS: Record<string, string> = {
  not_shipped: 'Not shipped', booking_confirmed: 'Booking confirmed', at_sea: 'At sea', arrived: 'Arrived', arrived_cleared: 'Arrived and cleared', not_shipped_expired: 'Not shipped (expired)',
}

export const PAYMENT_KIND: Record<string, string> = { sight_payment: 'Payment', usance_acceptance: 'Acceptance', usance_settlement: 'Settlement at maturity' }

/** Status actions offered for an LC in a status (06 §12.1); the server decides whether each is allowed. */
export function lcActions(status: string): Array<{ action: LcTransition['action']; label: string; danger?: boolean }> {
  switch (status) {
    case 'draft': return [{ action: 'submit', label: 'Submit to bank' }, { action: 'cancel', label: 'Cancel LC', danger: true }]
    case 'awaiting_bank': return [{ action: 'mark_opened', label: 'Mark opened' }, { action: 'mark_refused', label: 'Bank refused', danger: true }, { action: 'cancel', label: 'Cancel LC', danger: true }]
    case 'opened': case 'partly_shipped': return [{ action: 'documents_presented', label: 'Documents presented' }, { action: 'expire', label: 'Mark expired', danger: true }]
    case 'documents_presented': return [{ action: 'payment_due', label: 'Payment due' }]
    case 'closed': return [{ action: 'reopen', label: 'Reopen' }]
    default: return []
  }
}

/** Who can change what: closed, cancelled and expired LCs are read-only except close (BR-040). */
export const lcEditable = (status: string) => ['draft', 'awaiting_bank'].includes(status)
export const lcLive = (status: string) => ['opened', 'partly_shipped', 'documents_presented', 'payment_due'].includes(status)
