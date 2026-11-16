import { z } from 'zod'
import type { Employee, EmployeeInput } from '../api/contract.gen'

/** P2 Employee form (PEP-520): shape only; the server checks the rest (leaving date, money format) and works out gross. */
const money = (label: string, required = false) =>
  z.string().trim().refine((v) => (required ? v !== '' : true), `Enter the ${label}`)
    .refine((v) => v === '' || /^\d{1,13}(\.\d{1,2})?$/.test(v), 'Enter an amount of 0 or more with up to 2 decimals')

export const employeeSchema = z.object({
  name: z.string().trim().min(1, 'Enter the name').max(150),
  designation: z.string().trim().max(80),
  department: z.string().trim().max(80),
  mobile: z.string().trim().max(20),
  email: z.string().trim().max(190).refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Enter a valid e-mail'),
  national_id: z.string().trim().max(30),
  joining_date: z.string().min(1, 'Choose the joining date'),
  basic_salary: money('basic salary', true),
  house_rent: money('house rent'),
  medical: money('medical allowance'),
  conveyance: money('conveyance'),
  pay_method: z.enum(['cash', 'bank', 'mobile']),
  bank_name: z.string().trim().max(120),
  account_no: z.string().trim().max(40),
  notes: z.string().trim().max(500),
})

export type EmployeeFormValues = z.input<typeof employeeSchema>
export type EmployeeFormParsed = z.output<typeof employeeSchema>

export const emptyEmployee: EmployeeFormValues = {
  name: '', designation: '', department: '', mobile: '', email: '', national_id: '', joining_date: '', basic_salary: '', house_rent: '', medical: '',
  conveyance: '', pay_method: 'cash', bank_name: '', account_no: '', notes: '',
}

export function employeeToForm(e: Employee | null): EmployeeFormValues {
  if (!e) return { ...emptyEmployee }
  const zero = (v: string) => (v === '0.00' ? '' : v)
  return {
    name: e.name, designation: e.designation ?? '', department: e.department ?? '', mobile: e.mobile ?? '', email: e.email ?? '', national_id: e.national_id ?? '',
    joining_date: e.joining_date, basic_salary: e.basic_salary, house_rent: zero(e.house_rent), medical: zero(e.medical), conveyance: zero(e.conveyance),
    pay_method: e.pay_method, bank_name: e.bank_name ?? '', account_no: e.account_no ?? '', notes: e.notes ?? '',
  }
}

/** Form values → EmployeeInput (empty optional text → null; empty allowances → 0 on the server). */
export function toEmployeeInput(v: EmployeeFormParsed): EmployeeInput {
  const opt = (s: string) => (s === '' ? null : s)
  return {
    name: v.name, designation: opt(v.designation), department: opt(v.department), mobile: opt(v.mobile), email: opt(v.email), national_id: opt(v.national_id),
    joining_date: v.joining_date, basic_salary: v.basic_salary, house_rent: opt(v.house_rent), medical: opt(v.medical), conveyance: opt(v.conveyance),
    pay_method: v.pay_method, bank_name: v.pay_method === 'bank' ? opt(v.bank_name) : null, account_no: v.pay_method === 'cash' ? null : opt(v.account_no), notes: opt(v.notes),
  }
}
