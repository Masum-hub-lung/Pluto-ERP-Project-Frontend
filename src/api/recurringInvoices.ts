import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { PageMeta, RecurringInvoice, RecurringInvoiceCreate, RecurringTemplateInput } from './contract.gen'

/**
 * PEP-517 repeating sales invoices: "Repeat this invoice", the list, pause / change / end. Each run (06:00 Dhaka, on the
 * server) writes a draft invoice, so a change here also refreshes the invoice lists.
 */
const keys = {
  all: (cid: number | null) => ['company', cid, 'recurring-invoices'] as const,
  list: (cid: number | null, f: object) => ['company', cid, 'recurring-invoices', 'list', f] as const,
}

export function useRecurringInvoices(f: { active?: string; page?: number }) {
  return useQuery({
    queryKey: keys.list(api.getCompany(), f),
    queryFn: async ({ signal }) => (await api.request<{ data: RecurringInvoice[]; meta: PageMeta }>('GET', '/recurring-invoices', { query: f, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useRepeatInvoice(invoiceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: RecurringInvoiceCreate; idempotencyKey: string }) =>
      (await api.request<{ data: RecurringInvoice }>('POST', `/sales-invoices/${invoiceId}/repeat`, { body: input, idempotencyKey })).data.data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }) },
  })
}

export function useUpdateRecurringInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input, version }: { id: number; input: RecurringTemplateInput; version: number }) =>
      (await api.request<{ data: RecurringInvoice }>('PATCH', `/recurring-invoices/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }) },
  })
}
