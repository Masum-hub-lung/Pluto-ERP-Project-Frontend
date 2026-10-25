import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { MoneyAccount, MoneyAccountInput } from './contract.gen'

/**
 * Money accounts (05 Banking, G3/G4; backlog P6.2-FE-01). The list is open to every member as a picker: without
 * banking.view only id, name, type and use-for flags come back (docs 12 §3), so pickers must not rely on the other
 * fields. `purpose` keeps active accounts switched on for receipts or payments.
 */
export type MoneyPurpose = 'receipts' | 'payments'
export type MoneyAccountRow = Pick<MoneyAccount, 'id' | 'name' | 'account_type' | 'use_for_receipts' | 'use_for_payments' | 'is_active'> & Partial<MoneyAccount>

const keys = {
  all: (cid: number | null) => ['company', cid, 'money-accounts'] as const,
  list: (cid: number | null, f: { purpose?: MoneyPurpose; type?: string }) => ['company', cid, 'money-accounts', 'list', f] as const,
  one: (cid: number | null, id: number) => ['company', cid, 'money-accounts', id] as const,
}

export function useMoneyAccounts(f: { purpose?: MoneyPurpose; type?: string } = {}) {
  return useQuery({
    queryKey: keys.list(api.getCompany(), f),
    queryFn: async ({ signal }) => (await api.request<{ data: MoneyAccountRow[] }>('GET', '/money-accounts', { query: { ...f }, signal })).data.data,
    staleTime: 60_000,
  })
}

export function useMoneyAccount(id: number) {
  return useQuery({
    queryKey: keys.one(api.getCompany(), id),
    queryFn: async ({ signal }) => (await api.request<{ data: MoneyAccount }>('GET', `/money-accounts/${id}`, { signal })).data.data,
    retry: (n, e: unknown) => (e as { status?: number }).status !== 404 && n < 2,
    enabled: id > 0,
  })
}

function useRefresh() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) })
}

export function useCreateMoneyAccount() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: MoneyAccountInput; idempotencyKey: string }) =>
      (await api.request<{ data: MoneyAccount }>('POST', '/money-accounts', { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

/** PATCH: only the fields sent change; `is_active` is accepted too (contract gap noted on PEP-165). */
export function useUpdateMoneyAccount(id: number) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async ({ input, version }: { input: Partial<MoneyAccountInput> & { is_active?: boolean }; version: number }) =>
      (await api.request<{ data: MoneyAccount }>('PATCH', `/money-accounts/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: refresh,
  })
}
