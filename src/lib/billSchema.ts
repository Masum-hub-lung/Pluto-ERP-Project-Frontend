import { z } from 'zod'
import type { Party, Product, PurchaseBill, PurchaseBillInput } from '../api/contract.gen'
import { completeIndexes, emptyLine, isBlankLine, isCompleteLine, type LineValues } from '../components/document/lines'

/**
 * F3 purchase bill form (backlog P4.5-FE-02): shape checks only (03 §7 layer 1). Blank lines are ignored; a line that
 * is started but incomplete gets its own message; the server re-validates everything and owns every figure.
 */
export interface BillFormValues {
  party: Party | null
  supplier_bill_no: string
  date: string
  due_date: string
  warehouse_id: string
  /** The purchase order this bill receives (F3 "From PO"); '' when none. */
  purchase_order_id?: string
  notes: string
  internal_note: string
  lines: LineValues[]
}

const line = z.custom<LineValues>()

export const billSchema = z.object({
  party: z.custom<Party | null>().refine((p) => !!p, 'Choose the supplier'),
  supplier_bill_no: z.string().trim().min(1, "Enter the supplier's bill number").max(60, 'Use at most 60 characters'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the bill date'),
  due_date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')]),
  warehouse_id: z.string().min(1, 'Choose where the goods are received'),
  purchase_order_id: z.string().optional(),
  notes: z.string().max(2000, 'Use at most 2000 characters'),
  internal_note: z.string().max(2000, 'Use at most 2000 characters'),
  lines: z.array(line),
}).superRefine((v, ctx) => {
  if (v.due_date && v.date && v.due_date < v.date) ctx.addIssue({ code: 'custom', path: ['due_date'], message: 'The due date cannot be before the bill date' })
  let started = 0
  v.lines.forEach((l, i) => {
    if (isBlankLine(l)) return
    started++
    if (isCompleteLine(l)) return
    const path = ['lines', i, !l.product ? 'product' : !l.quantity.trim() || /^0*(\.0*)?$/.test(l.quantity.trim()) ? 'quantity' : 'price']
    const message = !l.product ? 'Choose an item' : path[2] === 'quantity' ? 'Enter a quantity above 0 (up to 3 decimals)' : 'Check the cost (up to 4 decimals) and discount (0–100)'
    ctx.addIssue({ code: 'custom', path, message })
  })
  if (started === 0) {
    ctx.addIssue({ code: 'custom', path: ['lines', 0, 'product'], message: 'Add at least one item' })
  }
})

/** Form values → API body; only complete lines are sent, in form order (see completeIndexes). */
export function toBillInput(v: BillFormValues): PurchaseBillInput {
  return {
    party_id: v.party?.id ?? 0,
    supplier_bill_no: v.supplier_bill_no.trim(),
    bill_date: v.date,
    due_date: v.due_date || null,
    warehouse_id: Number(v.warehouse_id),
    ...(v.purchase_order_id ? { purchase_order_id: Number(v.purchase_order_id) } : {}),
    notes: v.notes.trim() || null,
    internal_note: v.internal_note.trim() || null,
    lines: completeIndexes(v.lines).map((i) => {
      const l = v.lines[i]!
      return {
        product_id: l.product!.id, description: l.description.trim() || null, quantity: l.quantity.trim(), unit_cost: l.price.trim(),
        discount_pct: l.discount_pct.trim() || undefined, tax_rule_id: l.tax_rule_id ? Number(l.tax_rule_id) : null,
        ...(v.purchase_order_id && l.po_line_id ? { purchase_order_line_id: l.po_line_id } : {}),
      }
    }),
  }
}

/** The bill resource's line (contract types it loosely as a record). */
interface BillLine {
  product_id: number; product_code: string; product_name: string; unit: string; description: string | null; quantity: string; unit_cost: string
  discount_pct: string | null; tax_rule_id: number | null; purchase_order_line_id?: number | null
}

/** Stored bill → form values. Lines carry only the product's code, name and unit, which is all the grid shows. */
export function billToForm(b: PurchaseBill | null, party: Party | null, today: string, warehouseId = ''): BillFormValues {
  if (!b) return { party: null, supplier_bill_no: '', date: today, due_date: '', warehouse_id: warehouseId, purchase_order_id: '', notes: '', internal_note: '', lines: [emptyLine()] }
  const lines = (b.lines as unknown as BillLine[]).map((l): LineValues => ({
    product: { id: l.product_id, code: l.product_code, name: l.product_name, unit: l.unit, track_stock: true } as Product,
    description: l.description ?? '', quantity: l.quantity, price: l.unit_cost, discount_pct: l.discount_pct && !/^0+(\.0+)?$/.test(l.discount_pct) ? l.discount_pct : '',
    tax_rule_id: l.tax_rule_id ? String(l.tax_rule_id) : '', po_line_id: l.purchase_order_line_id ?? null,
  }))
  // Contract gap (noted on PEP-140): the bill resource has no notes/internal_note yet, so they reload empty.
  const ext = b as PurchaseBill & { notes?: string | null; internal_note?: string | null }
  return {
    party, supplier_bill_no: b.supplier_bill_no, date: b.bill_date, due_date: b.due_date, warehouse_id: String(b.warehouse_id),
    purchase_order_id: b.purchase_order_id ? String(b.purchase_order_id) : '',
    notes: ext.notes ?? '', internal_note: ext.internal_note ?? '', lines: lines.length ? lines : [emptyLine()],
  }
}

/** API field paths that are not lines → form fields. */
export const billFieldMap: Record<string, keyof BillFormValues> = {
  party_id: 'party', supplier_bill_no: 'supplier_bill_no', bill_date: 'date', due_date: 'due_date', warehouse_id: 'warehouse_id', notes: 'notes', internal_note: 'internal_note',
}
