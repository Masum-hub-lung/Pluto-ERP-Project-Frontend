import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Employee, EmployeeInput, PageMeta } from './contract.gen'

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
