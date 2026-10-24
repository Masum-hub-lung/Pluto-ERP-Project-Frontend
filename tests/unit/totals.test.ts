import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { DocumentCalculation } from '../../src/api/contract.gen'
import { totalsRows } from '../../src/components/document/totals'

const calc = (over: Partial<DocumentCalculation> = {}): DocumentCalculation => ({
  lines: [], warnings: [], subtotal: '23400.00', discount_total: '468.00', tax_total: '1146.60', rounding_adjustment: '0.40', total: '24079.00',
  amount_in_words: 'Taka twenty-four thousand seventy-nine only', ...over,
})

test('TC-FE-002: the panel shows the server figures exactly as given, only formatted', () => {
  // Deliberately inconsistent figures: if the panel added anything up, the total would not be 24,079.00.
  const rows = totalsRows(calc({ total: '99999.99' }))
  assert.deepEqual(rows.map((r) => [r.key, r.value]), [
    ['subtotal', '23,400.00'], ['discount', '− 468.00'], ['tax', '1,146.60'], ['rounding', '0.40'], ['total', '৳ 99,999.99'],
  ])
})

test('zero discount and rounding rows are left out; tax always shows', () => {
  assert.deepEqual(totalsRows(calc({ discount_total: '0.00', rounding_adjustment: '-0.00', tax_total: '0.00' })).map((r) => r.key), ['subtotal', 'tax', 'total'])
})

test('no client arithmetic on money in the document components', () => {
  for (const f of ['totals.ts', 'TotalsPanel.tsx', 'useCalculate.ts']) {
    const src = readFileSync(`src/components/document/${f}`, 'utf8')
    assert.doesNotMatch(src, /parseFloat|Number\(\s*(r|result|line)\.|\b(subtotal|total|tax_total|discount_total|line_total)\s*([+*/]|\s-\s)/, f)
  }
})
