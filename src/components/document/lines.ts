import type { CalculatedLine, Product } from '../../api/contract.gen'

/**
 * Document lines as the editors hold them (backlog P4.4-FE-03). Amounts stay strings; `product` keeps the chosen
 * item for display (code, unit). Blank trailing lines are ignored when calculating and saving, so the API's lines
 * are numbered by complete line only — `mapResults` puts its results back on the form's rows.
 */
export interface LineValues {
  product: Product | null
  description: string
  quantity: string
  price: string
  discount_pct: string
  tax_rule_id: string
  /** The purchase order line a bill line receives (F3 "From PO", P10.2-FE-01); kept through edits so posting updates the order. */
  po_line_id?: number | null
}

export const emptyLine = (): LineValues => ({ product: null, description: '', quantity: '', price: '', discount_pct: '', tax_rule_id: '' })

const qtyRx = /^\d{1,15}(\.\d{1,3})?$/
const costRx = /^\d{1,14}(\.\d{1,4})?$/
const pctRx = /^\d{1,3}(\.\d{1,4})?$/

/** Nothing typed and no item chosen. */
export function isBlankLine(l: LineValues): boolean {
  return !l.product && !l.description.trim() && !l.quantity.trim() && !l.price.trim() && !l.discount_pct.trim() && !l.tax_rule_id
}

/** Enough to calculate: an item, a quantity > 0, a price ≥ 0 and a valid discount. */
export function isCompleteLine(l: LineValues): boolean {
  return !!l.product && qtyRx.test(l.quantity.trim()) && !/^0*(\.0*)?$/.test(l.quantity.trim()) && costRx.test(l.price.trim())
    && (l.discount_pct.trim() === '' || percentOk(l.discount_pct.trim()))
}

/** 0–100 with up to 4 decimals, compared as text (no floats). */
function percentOk(v: string): boolean {
  if (!pctRx.test(v)) return false
  const [int, frac = ''] = v.split('.')
  const n = Number(int) // the whole-number part only: at most three digits, exact
  return n < 100 || (n === 100 && /^0*$/.test(frac))
}

/** Form row indexes of the complete lines, in order (API line i+1 = form row indexes[i]). */
export function completeIndexes(lines: LineValues[]): number[] {
  return lines.flatMap((l, i) => (isCompleteLine(l) ? [i] : []))
}

/** Calculate results keyed by form row. */
export function mapResults(lines: CalculatedLine[] | undefined, indexes: number[]): Record<number, CalculatedLine> {
  const out: Record<number, CalculatedLine> = {}
  for (const l of lines ?? []) {
    const row = indexes[l.line_no - 1]
    if (row !== undefined) out[row] = l
  }
  return out
}

/** API error paths lines.N.field (N = position among the lines sent) → form row paths lines.R.field. */
export function remapLineErrors(errors: Record<string, string[]>, indexes: number[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [path, msgs] of Object.entries(errors)) {
    const m = /^lines\.(\d+)\.(.+)$/.exec(path)
    out[m && indexes[Number(m[1])] !== undefined ? `lines.${indexes[Number(m[1])]}.${m[2] === 'unit_cost' || m[2] === 'unit_price' ? 'price' : m[2] === 'product_id' ? 'product' : m[2]}` : path] = msgs
  }
  return out
}
