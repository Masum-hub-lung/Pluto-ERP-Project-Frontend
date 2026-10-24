import { z } from 'zod'
import type { Product, ProductInput } from '../api/contract.gen'

/**
 * Client-side shape checks for D2/D3 (03 §7 layer 1; backlog P3.2-FE-06/07). Amounts stay decimal strings (never
 * numbers): money 2 decimals, cost 4, quantities 3. Services carry no stock settings (CF-09). The server re-validates
 * everything: unique code and barcode, the income/expense ledger natures, tax rule and supplier.
 */
const moneyRx = /^\d{1,16}(\.\d{1,2})?$/
const costRx = /^\d{1,14}(\.\d{1,4})?$/
const qtyRx = /^\d{1,15}(\.\d{1,3})?$/
const optional = (rx: RegExp, message: string) => z.union([z.literal(''), z.string().trim().regex(rx, message)])

export const productSchema = z.object({
  item_type: z.enum(['product', 'service']),
  name: z.string().trim().min(1, 'Enter the item name').max(190, 'Use at most 190 characters'),
  code: z.union([z.literal(''), z.string().trim().max(30, 'Use at most 30 characters').regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Use letters, digits and dashes, e.g. OIL-0001')]),
  category_id: z.string(),
  stock_group_id: z.string(),
  unit_id: z.string().min(1, 'Choose a unit'),
  barcode: z.string().trim().max(40, 'Use at most 40 characters'),
  selling_price: z.string().trim().min(1, 'Enter the selling price').regex(moneyRx, 'Enter an amount with up to 2 decimals, e.g. "920.00"'),
  wholesale_price: optional(moneyRx, 'Enter an amount with up to 2 decimals'),
  last_purchase_cost: optional(costRx, 'Enter a cost with up to 4 decimals'),
  tax_rule_id: z.string(),
  income_ledger_id: z.string().min(1, 'Choose the income account'),
  expense_ledger_id: z.string(),
  is_active: z.boolean(),
  warehouses: z.array(z.object({
    warehouse_id: z.number(),
    name: z.string(),
    reorder_level: optional(qtyRx, 'Up to 3 decimals'),
    reorder_qty: optional(qtyRx, 'Up to 3 decimals'),
  })),
})

export type ProductFormValues = z.input<typeof productSchema>
export type ProductFormParsed = z.output<typeof productSchema>

export const emptyProduct: Readonly<ProductFormValues> = Object.freeze({
  item_type: 'product', name: '', code: '', category_id: '', stock_group_id: '', unit_id: '', barcode: '', selling_price: '', wholesale_price: '',
  last_purchase_cost: '', tax_rule_id: '', income_ledger_id: '', expense_ledger_id: '', is_active: true, warehouses: [],
})

/**
 * Product → form values. The Product schema has no unit_id or expense_ledger_id (contract gaps noted on PEP-102/111):
 * the unit is matched by name by the caller; the expense account is left empty and only sent when changed.
 */
export function toProductForm(p: Product, unitId: string, warehouses: { id: number; name: string }[]): ProductFormValues {
  const levels = new Map((p.warehouses ?? []).map((l) => [l.warehouse_id, l]))
  return {
    item_type: p.item_type, name: p.name, code: p.code, category_id: p.category ? String(p.category.id) : '', stock_group_id: p.stock_group ? String(p.stock_group.id) : '',
    unit_id: unitId, barcode: p.barcode ?? '', selling_price: p.selling_price, wholesale_price: p.wholesale_price ?? '', last_purchase_cost: p.last_purchase_cost ?? '',
    tax_rule_id: p.tax_rule_id ? String(p.tax_rule_id) : '', income_ledger_id: String(p.income_ledger_id), expense_ledger_id: '', is_active: p.is_active,
    warehouses: warehouses.map((w) => ({ warehouse_id: w.id, name: w.name, reorder_level: trimZeros(levels.get(w.id)?.reorder_level), reorder_qty: trimZeros(levels.get(w.id)?.reorder_qty) })),
  }
}

/** "20.000" → "20", "0.000" → "" (shown as an empty box). String-only, no number conversion. */
export function trimZeros(v: string | null | undefined): string {
  if (!v) return ''
  const t = v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v
  return /^0*$/.test(t) ? '' : t
}

/**
 * Form values → ProductInput (05). Empty strings become null; services send no warehouse rows; on edit the expense
 * account is only sent when the user chose one (see toProductForm).
 */
export function toProductInput(v: ProductFormParsed, mode: 'add' | 'edit'): ProductInput {
  const nil = (s: string) => (s.trim() === '' ? null : s.trim())
  const id = (s: string) => (s ? Number(s) : null)
  const service = v.item_type === 'service'
  const input: ProductInput = {
    item_type: v.item_type, name: v.name.trim(), category_id: id(v.category_id), stock_group_id: id(v.stock_group_id), unit_id: Number(v.unit_id),
    barcode: nil(v.barcode), selling_price: v.selling_price.trim(), wholesale_price: nil(v.wholesale_price), last_purchase_cost: service ? null : nil(v.last_purchase_cost),
    tax_rule_id: id(v.tax_rule_id), income_ledger_id: Number(v.income_ledger_id), is_active: v.is_active,
  }
  if (v.code.trim() || mode === 'edit') input.code = v.code.trim() ? v.code.trim().toUpperCase() : undefined
  if (v.expense_ledger_id || mode === 'add') input.expense_ledger_id = id(v.expense_ledger_id)
  if (!service) input.warehouses = v.warehouses.map((w) => ({ warehouse_id: w.warehouse_id, reorder_level: w.reorder_level || '0', reorder_qty: w.reorder_qty || '0' }))
  return input
}
