import { z } from 'zod'
import type { Warehouse, WarehouseInput } from '../api/contract.gen'

/**
 * Client-side shape checks for the D7 warehouse dialog (03 §7 layer 1; backlog P3.2-FE-02). The server re-validates
 * everything (unique code, active branch, the inventory ledger, "holds stock" before inactive).
 */
const max = (n: number) => z.string().trim().max(n, `Use at most ${n} characters`)

export const warehouseSchema = z.object({
  name: z.string().trim().min(1, 'Enter the warehouse name').max(120, 'Use at most 120 characters'),
  code: z.string().trim().min(1, 'Enter a warehouse code').max(20, 'Use at most 20 characters')
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Use letters, digits and dashes, e.g. WH-NGJ'),
  branch_id: z.string().min(1, 'Choose the branch this warehouse belongs to'),
  address: max(255),
  phone: max(30),
  status: z.enum(['active', 'planned', 'inactive']),
  opens_on: z.string(),
  is_default_for_sales: z.boolean(),
})

export type WarehouseFormValues = z.input<typeof warehouseSchema>
export type WarehouseFormParsed = z.output<typeof warehouseSchema>

export const emptyWarehouse: Readonly<WarehouseFormValues> = Object.freeze({
  name: '', code: '', branch_id: '', address: '', phone: '', status: 'active', opens_on: '', is_default_for_sales: false,
})

export function toWarehouseForm(w: Warehouse): WarehouseFormValues {
  return {
    name: w.name, code: w.code, branch_id: String(w.branch_id), address: w.address ?? '', phone: w.phone ?? '', status: w.status,
    opens_on: w.opens_on ?? '', is_default_for_sales: w.is_default_for_sales,
  }
}

/** Form values -> WarehouseInput (05): empty strings become null, the code upper-cased, the branch a number. */
export function toWarehouseInput(v: WarehouseFormParsed): WarehouseInput {
  const nil = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    name: v.name.trim(), code: v.code.trim().toUpperCase(), branch_id: Number(v.branch_id), address: nil(v.address), phone: nil(v.phone),
    status: v.status, opens_on: nil(v.opens_on), is_default_for_sales: v.is_default_for_sales,
  }
}
