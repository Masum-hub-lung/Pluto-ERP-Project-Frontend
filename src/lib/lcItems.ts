import type { LcLine, LcLineInput, Product } from '../api/contract.gen'

/**
 * The items of a letter of credit as the forms hold them (PEP-487): item, quantity, unit (one of the item's units,
 * BR-069), unit cost in the LC currency and an optional description. Used by the LC form (M3), the "Add items" dialog
 * and an amendment's added items (M4). Amounts stay strings and nothing is added up here: the items total comes back
 * from the server (`LetterOfCredit.lines_total`) when the LC is saved.
 */
export interface LcItemRow {
  product: Product | null
  /** '' = the item's base unit. */
  unit_id: string
  quantity: string
  unit_cost: string
  description: string
}

export const emptyItem = (): LcItemRow => ({ product: null, unit_id: '', quantity: '', unit_cost: '', description: '' })

const qtyRx = /^\d{1,15}(\.\d{1,3})?$/
const costRx = /^\d{1,14}(\.\d{1,4})?$/
const zeroRx = /^0*(\.0*)?$/

export const isBlankItem = (r: LcItemRow) => !r.product && !r.quantity.trim() && !r.unit_cost.trim() && !r.description.trim()

/** What is wrong with a row the user started, per field; {} when it can be sent. */
export function itemProblems(r: LcItemRow): Partial<Record<'product' | 'quantity' | 'unit_cost' | 'description', string>> {
  const out: Partial<Record<'product' | 'quantity' | 'unit_cost' | 'description', string>> = {}
  if (!r.product) out.product = 'Choose an item'
  const q = r.quantity.trim()
  if (!qtyRx.test(q)) out.quantity = 'Enter a quantity with up to 3 decimals'
  else if (zeroRx.test(q)) out.quantity = 'The quantity must be more than 0'
  if (!costRx.test(r.unit_cost.trim())) out.unit_cost = 'Enter a unit cost of 0 or more with up to 4 decimals'
  if (r.description.trim().length > 255) out.description = 'Use at most 255 characters'
  return out
}

/** Form row indexes of the rows that are sent (blank rows are ignored), in order: API line i = form row indexes[i]. */
export const sentIndexes = (rows: LcItemRow[]) => rows.flatMap((r, i) => (isBlankItem(r) ? [] : [i]))

/** Rows → LcLineInput[] (blank rows dropped). */
export function toLcLines(rows: LcItemRow[]): LcLineInput[] {
  return rows.filter((r) => !isBlankItem(r)).map((r) => ({
    product_id: r.product?.id ?? 0, quantity: r.quantity.trim(), unit_cost: r.unit_cost.trim(),
    ...(r.unit_id ? { unit_id: Number(r.unit_id) } : {}), ...(r.description.trim() ? { description: r.description.trim() } : {}),
  }))
}

/** The LC's stored items → rows. A stored line carries only the item's code and name; its units are fetched by the editor. */
export function linesToRows(lines: LcLine[] | undefined): LcItemRow[] {
  return (lines ?? []).map((l) => ({
    product: { id: l.product_id, code: l.product_code, name: l.product_name, unit: l.unit, track_stock: true } as Product,
    unit_id: l.unit_id ? String(l.unit_id) : '', quantity: l.quantity, unit_cost: l.unit_cost, description: l.description ?? '',
  }))
}

/** 422 paths `lines.N.field` (N = position among the lines sent) → `rowIndex.field` messages for the editor. */
export function itemErrors(fieldErrors: Record<string, string[]>, indexes: number[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, msgs] of Object.entries(fieldErrors)) {
    const m = /^lines\.(\d+)(?:\.(.+))?$/.exec(path)
    const row = m ? indexes[Number(m[1])] : undefined
    if (m && row !== undefined && msgs[0]) out[`${row}.${m[2] === 'product_id' || !m[2] ? 'product' : m[2]}`] = msgs[0]
  }
  return out
}

/** The names of the chosen items, for the bank wording of the goods (prefill only). */
export const itemNames = (rows: LcItemRow[]) => rows.flatMap((r) => (r.product ? [r.product.name] : [])).join(', ').slice(0, 500)
