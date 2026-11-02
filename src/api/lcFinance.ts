import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  BankFacility, BankFacilityInput, FxRevaluation, FxRevaluationRequest, LcLoan, LcLoanConvert, LcLoanInterest, LcLoanRepaymentInput, PageMeta,
} from './contract.gen'

/**
 * LC finance inside the LC portal (P16.5; 05 bank-facilities, lc-loans, lc-loan-repayments, fx-revaluations; 06 §12.11–12.13):
 * bank limits with live use, PAD/LTR loans (interest is always the API's quote), period-end FX revaluation. Keys under
 * ['company', cid, 'lc', 'finance', …], so every LC mutation's refresh (['company', cid, 'lc']) refreshes them too.
 */
const cid = () => api.getCompany()
const base = () => ['company', cid(), 'lc', 'finance'] as const

/** Repayments, reversals and revaluations post journals: books, banks, parties and reports move with them. */
function useRefresh() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['company', cid(), 'lc'] })
    for (const k of ['money-accounts', 'banking', 'accounting', 'purchase-bills', 'parties', 'party-accounts', 'reports', 'dashboard']) {
      void qc.invalidateQueries({ queryKey: ['company', cid(), k] })
    }
  }
}

// ---------------------------------------------------------------- bank facilities (M8 "Banks and limits")

export function useBankFacilities() {
  return useQuery({
    queryKey: [...base(), 'facilities'],
    queryFn: async ({ signal }) => (await api.request<{ data: BankFacility[]; meta: PageMeta }>('GET', '/bank-facilities', { signal })).data.data,
    staleTime: 0, refetchOnMount: 'always',
  })
}

export function useSaveBankFacility() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input, version }: { id?: number; input: BankFacilityInput; version?: number }) =>
      (id
        ? await api.request<{ data: BankFacility }>('PUT', `/bank-facilities/${id}`, { body: input, ifMatch: `W/"${version}"` })
        : await api.request<{ data: BankFacility }>('POST', '/bank-facilities', { body: input })).data.data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['company', cid(), 'lc'] }) },
  })
}

// ---------------------------------------------------------------- PAD/LTR loans

export interface LoanFilters { status?: string; bank_account_id?: number; letter_of_credit_id?: number; q?: string; sort?: string; page?: number; per_page?: number }

export function useLcLoans(f: LoanFilters, enabled = true) {
  return useQuery({
    queryKey: [...base(), 'loans', f],
    queryFn: async ({ signal }) => (await api.request<{ data: LcLoan[]; meta: PageMeta }>('GET', '/lc-loans', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useLcLoan(id: number) {
  return useQuery({
    queryKey: [...base(), 'loan', id],
    queryFn: async ({ signal }) => (await api.request<{ data: LcLoan }>('GET', `/lc-loans/${id}`, { signal })).data.data,
    enabled: id > 0,
    staleTime: 0, refetchOnMount: 'always',
  })
}

/** The interest the API works out for a repayment date (the dialog never computes it). */
export function useLoanInterest(id: number, asOf: string) {
  return useQuery({
    queryKey: [...base(), 'interest', id, asOf],
    queryFn: async ({ signal }) => (await api.request<{ data: LcLoanInterest }>('GET', `/lc-loans/${id}/interest`, { query: { as_of: asOf }, signal })).data.data,
    enabled: id > 0 && /^\d{4}-\d{2}-\d{2}$/.test(asOf),
    staleTime: 0,
  })
}

export function useRepayLoan(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: LcLoanRepaymentInput; idempotencyKey: string }) =>
      (await api.request<{ data: LcLoan }>('POST', `/lc-loans/${id}/repayments`, { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useConvertLoan(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, version }: { input: LcLoanConvert; version: number }) =>
      (await api.request<{ data: LcLoan }>('POST', `/lc-loans/${id}/convert`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: refresh,
  })
}

export function useReverseRepayment() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ id, reason, idempotencyKey }: { id: number; reason: string; idempotencyKey: string }) =>
      (await api.request<{ data: LcLoan }>('POST', `/lc-loan-repayments/${id}/reverse`, { body: { reason }, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

// ---------------------------------------------------------------- FX revaluation

export function useFxRevaluations(f: { page?: number; per_page?: number; sort?: string }) {
  return useQuery({
    queryKey: [...base(), 'fx', f],
    queryFn: async ({ signal }) => (await api.request<{ data: FxRevaluation[]; meta: PageMeta }>('GET', '/fx-revaluations', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useFxRevaluation() {
  const refresh = useRefresh()
  const preview = useMutation({
    mutationFn: async (input: FxRevaluationRequest) => (await api.request<{ data: FxRevaluation }>('POST', '/fx-revaluations/preview', { body: input })).data.data,
  })
  const post = useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: FxRevaluationRequest; idempotencyKey: string }) =>
      (await api.request<{ data: FxRevaluation }>('POST', '/fx-revaluations', { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
  const reverse = useMutation({
    mutationFn: async ({ id, reason, idempotencyKey }: { id: number; reason: string; idempotencyKey: string }) =>
      (await api.request<{ data: FxRevaluation }>('POST', `/fx-revaluations/${id}/reverse`, { body: { reason }, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
  return { preview, post, reverse }
}

/** One revalued item as FxRevaluationService returns it (FxRevaluation.lines is typed `obj` in the contract). */
export interface FxLine {
  source: 'purchase_bill' | 'lc_acceptance'; purchase_bill_id: number | null; letter_of_credit_id: number | null; party_id: number; reference: string | null
  party_name: string | null; currency_code: string; foreign_outstanding: string; book_rate: string; closing_rate: string; difference: string
}

export const LOAN_KIND: Record<string, string> = { pad: 'PAD', ltr: 'LTR' }
export const LOAN_STATUS: Record<string, { label: string; tone: 'neutral' | 'positive' | 'negative' | 'warning' | 'info' }> = {
  open: { label: 'Open', tone: 'info' }, repaid: { label: 'Repaid', tone: 'positive' }, reversed: { label: 'Reversed', tone: 'neutral' },
}
export const FINANCED_BY: Record<string, string> = { own: 'Own funds', pad: 'Bank finance (PAD)', ltr: 'Bank finance (LTR)' }
