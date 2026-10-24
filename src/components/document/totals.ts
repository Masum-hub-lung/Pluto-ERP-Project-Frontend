import type { DocumentCalculation } from '../../api/contract.gen'
import { formatTaka } from '../../lib/format'

/**
 * The rows of the totals panel, straight from the calculate response (DEC-09, TC-FE-002): each figure is the API's
 * decimal string, only formatted for display. Discount and rounding rows show only when not zero. No arithmetic.
 */
export interface TotalsRow { key: string; label: string; value: string; strong?: boolean }

const isZero = (v: string) => /^-?0+(\.0+)?$/.test(v.trim())

export function totalsRows(r: DocumentCalculation): TotalsRow[] {
  const rows: TotalsRow[] = [{ key: 'subtotal', label: 'Subtotal', value: formatTaka(r.subtotal) }]
  if (!isZero(r.discount_total)) rows.push({ key: 'discount', label: 'Discount', value: `− ${formatTaka(r.discount_total)}` })
  rows.push({ key: 'tax', label: 'Tax', value: formatTaka(r.tax_total) })
  if (!isZero(r.rounding_adjustment)) rows.push({ key: 'rounding', label: 'Rounding', value: formatTaka(r.rounding_adjustment) })
  rows.push({ key: 'total', label: 'Total', value: formatTaka(r.total, { symbol: true }), strong: true })
  return rows
}
