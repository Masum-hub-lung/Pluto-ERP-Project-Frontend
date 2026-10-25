import { z } from 'zod'
import type { DeliveryUpdate, Party, Product, SalesInvoice, SalesInvoiceInput } from '../api/contract.gen'
import { completeIndexes, emptyLine, isBlankLine, isCompleteLine, type LineValues } from '../components/document/lines'

/**
 * E3/E6 sales invoice form (backlog P5.2-FE-03/04): shape checks only (03 §7 layer 1). Blank lines are ignored; a line
 * that is started but incomplete gets its own message; the server re-validates everything and owns every figure.
 * Delivery details (challan, vehicle, time) are not part of SalesInvoiceInput: they are saved with PATCH …/delivery.
 */
export interface InvoiceFormValues {
  party: Party | null
  customer_po_ref: string
  date: string
  due_date: string
  payment_term_id: string
  warehouse_id: string
  notes: string
  internal_note: string
  challan_no: string
  vehicle_no: string
  delivered_at: string
  lines: LineValues[]
}

const line = z.custom<LineValues>()
const priceRx = /^\d{1,16}(\.\d{1,2})?$/

export const invoiceSchema = z.object({
  party: z.custom<Party | null>().refine((p) => !!p, 'Choose the customer'),
  customer_po_ref: z.string().trim().max(60, 'Use at most 60 characters'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the invoice date'),
  due_date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')]),
  payment_term_id: z.string(),
  warehouse_id: z.string().min(1, 'Choose the warehouse the goods leave from'),
  notes: z.string().max(65535, 'This note is too long'),
  internal_note: z.string().max(65535, 'This note is too long'),
  challan_no: z.string().trim().max(30, 'Use at most 30 characters'),
  vehicle_no: z.string().trim().max(40, 'Use at most 40 characters'),
  delivered_at: z.string(),
  lines: z.array(line),
}).superRefine((v, ctx) => {
  if (v.due_date && v.date && v.due_date < v.date) ctx.addIssue({ code: 'custom', path: ['due_date'], message: 'The due date cannot be before the invoice date' })
  let started = 0
  v.lines.forEach((l, i) => {
    if (isBlankLine(l)) return
    started++
    if (isCompleteLine(l) && priceRx.test(l.price.trim())) return
    const path = ['lines', i, !l.product ? 'product' : !l.quantity.trim() || /^0*(\.0*)?$/.test(l.quantity.trim()) ? 'quantity' : 'price']
    const message = !l.product ? 'Choose an item' : path[2] === 'quantity' ? 'Enter a quantity above 0 (up to 3 decimals)' : 'Check the price (up to 2 decimals) and discount (0–100)'
    ctx.addIssue({ code: 'custom', path, message })
  })
  if (started === 0) {
    ctx.addIssue({ code: 'custom', path: ['lines', 0, 'product'], message: 'Add at least one item' })
  }
})

/** The price a chosen item starts with: the wholesale price for a wholesale customer (if the item has one), else the selling price. */
export function tierPrice(p: Product, party: Party | null): string {
  return party?.price_tier === 'wholesale' && p.wholesale_price ? p.wholesale_price : p.selling_price
}

/** Form values → API body; only complete lines are sent, in form order (see completeIndexes). */
export function toInvoiceInput(v: InvoiceFormValues): SalesInvoiceInput {
  return {
    party_id: v.party?.id ?? 0,
    invoice_date: v.date,
    due_date: v.due_date || null,
    payment_term_id: v.payment_term_id ? Number(v.payment_term_id) : null,
    warehouse_id: Number(v.warehouse_id),
    customer_po_ref: v.customer_po_ref.trim() || null,
    notes: v.notes.trim() || null,
    internal_note: v.internal_note.trim() || null,
    lines: completeIndexes(v.lines).map((i) => {
      const l = v.lines[i]!
      return {
        product_id: l.product!.id, description: l.description.trim() || null, quantity: l.quantity.trim(), unit_price: l.price.trim(),
        discount_pct: l.discount_pct.trim() || undefined, tax_rule_id: l.tax_rule_id ? Number(l.tax_rule_id) : null,
      }
    }),
  }
}

/** Delivery fields → PATCH body; the time is sent with its offset (datetime-local is the browser's local time). */
export function toDeliveryUpdate(v: Pick<InvoiceFormValues, 'challan_no' | 'vehicle_no' | 'delivered_at'>): DeliveryUpdate {
  return { challan_no: v.challan_no.trim() || null, vehicle_no: v.vehicle_no.trim() || null, delivered_at: v.delivered_at ? new Date(v.delivered_at).toISOString() : null }
}

/** Stored delivery (resource `delivery`, ISO time) → form fields (datetime-local, browser time). */
export function deliveryToForm(d: SalesInvoice['delivery']): Pick<InvoiceFormValues, 'challan_no' | 'vehicle_no' | 'delivered_at'> {
  const at = typeof d?.delivered_at === 'string' ? new Date(d.delivered_at) : null
  const local = at && !Number.isNaN(at.getTime()) ? new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ''
  return { challan_no: typeof d?.challan_no === 'string' ? d.challan_no : '', vehicle_no: typeof d?.vehicle_no === 'string' ? d.vehicle_no : '', delivered_at: local }
}

/** True when the delivery fields differ from what is stored (so a PATCH is needed after saving). */
export function deliveryChanged(v: InvoiceFormValues, stored: SalesInvoice['delivery']): boolean {
  const s = deliveryToForm(stored)
  return v.challan_no.trim() !== s.challan_no || v.vehicle_no.trim() !== s.vehicle_no || v.delivered_at !== s.delivered_at
}

/** Stored invoice → form values. Lines carry only the product's code, name and unit, which is all the grid shows. */
export function invoiceToForm(inv: SalesInvoice | null, party: Party | null, today: string, warehouseId = ''): InvoiceFormValues {
  if (!inv) {
    return { party: null, customer_po_ref: '', date: today, due_date: '', payment_term_id: '', warehouse_id: warehouseId, notes: '', internal_note: '',
      challan_no: '', vehicle_no: '', delivered_at: '', lines: [emptyLine()] }
  }
  const lines = inv.lines.map((l): LineValues => ({
    product: { id: l.product_id, code: l.product_code, name: l.product_name, unit: l.unit, track_stock: true } as Product,
    description: l.description ?? '', quantity: l.quantity, price: l.unit_price, discount_pct: l.discount_pct && !/^0+(\.0+)?$/.test(l.discount_pct) ? l.discount_pct : '',
    tax_rule_id: l.tax_rule_id ? String(l.tax_rule_id) : '',
  }))
  // Contract gap (noted on PEP-149): the invoice resource has no notes/internal_note/payment_term_id, so they reload empty.
  const ext = inv as SalesInvoice & { notes?: string | null; internal_note?: string | null; payment_term_id?: number | null }
  return {
    party, customer_po_ref: inv.customer_po_ref ?? '', date: inv.invoice_date, due_date: inv.due_date, payment_term_id: ext.payment_term_id ? String(ext.payment_term_id) : '',
    warehouse_id: String(inv.warehouse_id), notes: ext.notes ?? '', internal_note: ext.internal_note ?? '', ...deliveryToForm(inv.delivery),
    lines: lines.length ? lines : [emptyLine()],
  }
}

/** API field paths that are not lines → form fields. */
export const invoiceFieldMap: Record<string, keyof InvoiceFormValues> = {
  party_id: 'party', invoice_date: 'date', due_date: 'due_date', payment_term_id: 'payment_term_id', warehouse_id: 'warehouse_id',
  customer_po_ref: 'customer_po_ref', notes: 'notes', internal_note: 'internal_note', challan_no: 'challan_no', vehicle_no: 'vehicle_no', delivered_at: 'delivered_at',
}
