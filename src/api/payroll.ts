import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Employee, EmployeeInput, PageMeta, PayrollPayment, PayrollPaymentInput, PayrollRun, PayrollRunCreate, PayrollRunUpdate } from './contract.gen'

/**
 * Payroll (PEP-519): employees first (PEP-520). A plan module (`payroll`) and private: payroll.* permissions.
 * Gross salary and every later figure come from the API.
 */
const keys = {
  all: (cid: number | null) => ['company', cid, 'payroll'] as const,
  employees: (cid: number | null, f: object) => ['company', cid, 'payroll', 'employees', f] as const,
  employee: (cid: number | null, id: number) => ['company', cid, 'payroll', 'employee', id] as const,
}

export interface EmployeeFilters { q?: string; status?: string; department?: string; sort?: string; page?: number }

export function useEmployees(f: EmployeeFilters) {
  return useQuery({
    queryKey: keys.employees(api.getCompany(), f),
    queryFn: async ({ signal }) => (await api.request<{ data: Employee[]; meta: PageMeta }>('GET', '/employees', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useEmployee(id: number) {
  return useQuery({
    queryKey: keys.employee(api.getCompany(), id),
    queryFn: async ({ signal }) => (await api.request<{ data: Employee }>('GET', `/employees/${id}`, { signal })).data.data,
    enabled: id > 0,
  })
}

export function useSaveEmployee(id: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, version, idempotencyKey }: { input: EmployeeInput; version?: number; idempotencyKey?: string }) =>
      id
        ? (await api.request<{ data: Employee }>('PATCH', `/employees/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data
        : (await api.request<{ data: Employee }>('POST', '/employees', { body: input, idempotencyKey })).data.data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }) },
  })
}

/** PEP-521 salary sheets. Every figure (prorated structure, gross, net, totals) is the API's; the page sends only what was typed. */
export function usePayrollRuns(f: { status?: string; page?: number }) {
  return useQuery({
    queryKey: [...keys.all(api.getCompany()), 'runs', f],
    queryFn: async ({ signal }) => (await api.request<{ data: PayrollRun[]; meta: PageMeta }>('GET', '/payroll-runs', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function usePayrollRun(id: number) {
  return useQuery({
    queryKey: [...keys.all(api.getCompany()), 'run', id],
    queryFn: async ({ signal }) => (await api.request<{ data: PayrollRun }>('GET', `/payroll-runs/${id}`, { signal })).data.data,
    enabled: id > 0,
  })
}

export function usePayrollRunAction(id: number) {
  const qc = useQueryClient()
  const done = () => { void qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }) }
  return {
    create: useMutation({
      mutationFn: async ({ input, idempotencyKey }: { input: PayrollRunCreate; idempotencyKey: string }) =>
        (await api.request<{ data: PayrollRun }>('POST', '/payroll-runs', { body: input, idempotencyKey })).data.data,
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: async ({ input, version }: { input: PayrollRunUpdate; version: number }) =>
        (await api.request<{ data: PayrollRun }>('PUT', `/payroll-runs/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: async () => { await api.request<void>('DELETE', `/payroll-runs/${id}`) }, onSuccess: done }),
    approve: useMutation({
      mutationFn: async ({ idempotencyKey }: { idempotencyKey: string }) => (await api.request<{ data: PayrollRun }>('POST', `/payroll-runs/${id}/approve`, { idempotencyKey })).data.data,
      onSuccess: done,
    }),
    cancel: useMutation({
      mutationFn: async ({ reason, idempotencyKey }: { reason: string; idempotencyKey: string }) =>
        (await api.request<{ data: PayrollRun }>('POST', `/payroll-runs/${id}/cancel`, { body: { reason }, idempotencyKey })).data.data,
      onSuccess: done,
    }),
  }
}

/** PEP-522 salary payments of a sheet; paying or reversing refreshes the sheet (paid amounts, status) too. */
export function usePayrollPayments(runId: number) {
  return useQuery({
    queryKey: [...keys.all(api.getCompany()), 'payments', runId],
    queryFn: async ({ signal }) => (await api.request<{ data: PayrollPayment[] }>('GET', `/payroll-runs/${runId}/payments`, { signal })).data.data,
    enabled: runId > 0,
  })
}

export function usePayrollPaymentAction(runId: number) {
  const qc = useQueryClient()
  const done = () => { void qc.invalidateQueries({ queryKey: keys.all(api.getCompany()) }); void qc.invalidateQueries({ queryKey: ['company', api.getCompany(), 'money-accounts'] }) }
  return {
    pay: useMutation({
      mutationFn: async ({ input, idempotencyKey }: { input: PayrollPaymentInput; idempotencyKey: string }) =>
        (await api.request<{ data: PayrollPayment }>('POST', `/payroll-runs/${runId}/payments`, { body: input, idempotencyKey })).data.data,
      onSuccess: done,
    }),
    reverse: useMutation({
      mutationFn: async ({ id, reason, idempotencyKey }: { id: number; reason: string; idempotencyKey: string }) =>
        (await api.request<{ data: PayrollPayment }>('POST', `/payroll-payments/${id}/reverse`, { body: { reason }, idempotencyKey })).data.data,
      onSuccess: done,
    }),
  }
}
