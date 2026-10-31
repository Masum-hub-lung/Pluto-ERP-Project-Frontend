import { z } from 'zod'
import type { Party, Product, PurchaseBillInput, PurchaseOrder, PurchaseOrderInput, Quotation, QuotationInput, SalesInvoiceInput } from '../api/contract.gen'
import { completeIndexes, emptyLine, isBlankLine, isCompleteLine, type LineValues } from '../components/document/lines'

/**
 * E10 quotation and F8 purchase order forms (backlog P10.1-FE-01, P10.2-FE-01): shape checks only (03 §7 layer 1), as
 * for invoices and bills. Blank lines are ignored; a started line must be complete. The figures come from the
 * invoice / bill calculate endpoints (DEC-09), so the forms also build those requests.
 */
export interface QuoteFormValues {
  party: Party | null
  date: string
  valid_until: string
  warehouse_id: string
  payment_term_id: string
  notes: string
  internal_note: string
  lines: LineValues[]
}

export interface OrderFormValues {
  party: Party | null
  date: string
  expected_date: string
  warehouse_id: string
  payment_term_id: string
  exchange_rate: string
  notes: string
  internal_note: string
  lines: LineValues[]
}

const dateRx = /^\d{4}-\d{2}-\d{2}$/
const optionalDate = z.union([z.literal(''), z.string().regex(dateRx, 'Enter a valid date')])

function checkLines(lines: LineValues[], ctx: z.RefinementCtx, priceWord: string) {
  let started = 0
  lines.forEach((l, i) => {
    if (isBlankLine(l)) return
    started++
    if (isCompleteLine(l)) return
    const field = !l.product ? 'product' : !l.quantity.trim() || /^0*(\.0*)?$/.test(l.quantity.trim()) ? 'quantity' : 'price'
    const message = field === 'product' ? 'Choose an item' : field === 'quantity' ? 'Enter a quantity above 0 (up to 3 decimals)' : `Check the ${priceWord} and discount (0–100)`
    ctx.addIssue({ code: 'custom', path: ['lines', i, field], message })
  })
  if (started === 0) ctx.addIssue({ code: 'custom', path: ['lines', 0, 'product'], message: 'Add at least one item' })
}

export const quoteSchema = z.object({
  party: z.custom<Party | null>().refine((p) => !!p, 'Choose the customer or prospect'),
  date: z.string().regex(dateRx, 'Enter the quotation date'),
  valid_until: z.string().regex(dateRx, 'Enter the date the offer is valid until'),
  warehouse_id: z.string(),
  payment_term_id: z.string(),
  notes: z.string().max(65535, 'This note is too long'),
  internal_note: z.string().max(65535, 'This note is too long'),
  lines: z.array(z.custom<LineValues>()),
}).superRefine((v, ctx) => {
  if (v.valid_until && v.date && v.valid_until < v.date) ctx.addIssue({ code: 'custom', path: ['valid_until'], message: 'Valid until cannot be before the quotation date' })
  checkLines(v.lines, ctx, 'price')
})

export const orderSchema = z.object({
  party: z.custom<Party | null>().refine((p) => !!p, 'Choose the supplier'),
  date: z.string().regex(dateRx, 'Enter the order date'),
  expected_date: optionalDate,
  warehouse_id: z.string().min(1, 'Choose where the goods are delivered'),
  payment_term_id: z.string(),
  exchange_rate: z.union([z.literal(''), z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, 'Enter a rate with up to 6 decimals')]),
  notes: z.string().max(2000, 'Use at most 2000 characters'),
  internal_note: z.string().max(2000, 'Use at most 2000 characters'),
  lines: z.array(z.custom<LineValues>()),
}).superRefine((v, ctx) => {
  if (v.expected_date && v.date && v.expected_date < v.date) ctx.addIssue({ code: 'custom', path: ['expected_date'], message: 'The expected date cannot be before the order date' })
  checkLines(v.lines, ctx, 'cost')
})

const lineOut = (l: LineValues) => ({
  product_id: l.product!.id, description: l.description.trim() || null, quantity: l.quantity.trim(),
  discount_pct: l.discount_pct.trim() || undefined, tax_rule_id: l.tax_rule_id ? Number(l.tax_rule_id) : null,
})

export function toQuotationInput(v: QuoteFormValues): QuotationInput {
  return {
    party_id: v.party?.id ?? 0, quotation_date: v.date, valid_until: v.valid_until, warehouse_id: v.warehouse_id ? Number(v.warehouse_id) : null,
    payment_term_id: v.payment_term_id ? Number(v.payment_term_id) : null, notes: v.notes.trim() || null, internal_note: v.internal_note.trim() || null,
    lines: completeIndexes(v.lines).map((i) => ({ ...lineOut(v.lines[i]!), unit_price: v.lines[i]!.price.trim() })),
  }
}

/** The invoice calculate request for a quotation's figures (the API prices quotations exactly like invoices). */
export function quoteCalcInput(v: QuoteFormValues, fallbackWarehouse: string): SalesInvoiceInput {
  const q = toQuotationInput(v)
  return { party_id: q.party_id, invoice_date: q.quotation_date, warehouse_id: Number(v.warehouse_id || fallbackWarehouse), lines: q.lines }
}

export function toOrderInput(v: OrderFormValues): PurchaseOrderInput {
  return {
    party_id: v.party?.id ?? 0, order_date: v.date, expected_date: v.expected_date || null, warehouse_id: Number(v.warehouse_id),
    payment_term_id: v.payment_term_id ? Number(v.payment_term_id) : null, exchange_rate: v.exchange_rate || undefined,
    notes: v.notes.trim() || null, internal_note: v.internal_note.trim() || null,
    lines: completeIndexes(v.lines).map((i) => ({ ...lineOut(v.lines[i]!), unit_cost: v.lines[i]!.price.trim() })),
  }
}

/** The bill calculate request for an order's figures (orders are priced like bills, in the supplier's currency). */
export function orderCalcInput(v: OrderFormValues): PurchaseBillInput {
  const o = toOrderInput(v)
  return { party_id: o.party_id, supplier_bill_no: 'PO', bill_date: o.order_date, warehouse_id: o.warehouse_id, exchange_rate: o.exchange_rate, lines: o.lines }
}

interface StoredLine {
  product_id: number; product_code: string; product_name: string; unit: string; description?: string | null; quantity: string
  unit_price?: string; unit_cost?: string; discount_pct?: string | null; tax_rule_id?: number | null
}

function linesToForm(lines: StoredLine[]): LineValues[] {
  const out = lines.map((l): LineValues => ({
    product: { id: l.product_id, code: l.product_code, name: l.product_name, unit: l.unit, track_stock: true } as Product,
    description: l.description ?? '', quantity: l.quantity, price: l.unit_price ?? l.unit_cost ?? '',
    discount_pct: l.discount_pct && !/^0+(\.0+)?$/.test(l.discount_pct) ? l.discount_pct : '', tax_rule_id: l.tax_rule_id ? String(l.tax_rule_id) : '',
  }))
  return out.length ? out : [emptyLine()]
}

export function quotationToForm(q: Quotation | null, party: Party | null, today: string, validUntil: string): QuoteFormValues {
  if (!q) return { party: null, date: today, valid_until: validUntil, warehouse_id: '', payment_term_id: '', notes: '', internal_note: '', lines: [emptyLine()] }
  return {
    party, date: q.quotation_date, valid_until: q.valid_until, warehouse_id: q.warehouse_id ? String(q.warehouse_id) : '',
    payment_term_id: q.payment_term_id ? String(q.payment_term_id) : '', notes: q.notes ?? '', internal_note: q.internal_note ?? '',
    lines: linesToForm(q.lines as unknown as StoredLine[]),
  }
}

export function orderToForm(o: PurchaseOrder | null, party: Party | null, today: string): OrderFormValues {
  if (!o) return { party: null, date: today, expected_date: '', warehouse_id: '', payment_term_id: '', exchange_rate: '', notes: '', internal_note: '', lines: [emptyLine()] }
  return {
    party, date: o.order_date, expected_date: o.expected_date ?? '', warehouse_id: String(o.warehouse_id), payment_term_id: o.payment_term_id ? String(o.payment_term_id) : '',
    exchange_rate: o.currency_code === 'BDT' ? '' : String(o.exchange_rate), notes: o.notes ?? '', internal_note: o.internal_note ?? '',
    lines: linesToForm(o.lines as unknown as StoredLine[]),
  }
}

export const quoteFieldMap: Record<string, keyof QuoteFormValues> = {
  party_id: 'party', quotation_date: 'date', valid_until: 'valid_until', warehouse_id: 'warehouse_id', payment_term_id: 'payment_term_id', notes: 'notes', internal_note: 'internal_note',
}
export const orderFieldMap: Record<string, keyof OrderFormValues> = {
  party_id: 'party', order_date: 'date', expected_date: 'expected_date', warehouse_id: 'warehouse_id', payment_term_id: 'payment_term_id',
  exchange_rate: 'exchange_rate', notes: 'notes', internal_note: 'internal_note',
}
export const LINE_FIELDS = ['lines.*.product', 'lines.*.quantity', 'lines.*.price', 'lines.*.discount_pct', 'lines.*.tax_rule_id', 'lines.*.description']
