import { z } from 'zod'

/**
 * Party opening balance on B2/C2 (backlog P6.2-FE-09; BR-028). The API returns it signed (Dr positive, Cr negative);
 * the form shows an amount and a side. Splitting the sign off is text handling, not arithmetic. A customer's opening
 * is normally Dr (they owe you), a supplier's Cr (you owe them); the server posts it at the financial year's start.
 */
export const openingFields = {
  opening_balance: z.union([z.literal(''), z.string().trim().regex(/^\d{1,16}(\.\d{1,2})?$/, 'Enter an amount with up to 2 decimals, e.g. "185000.00"')]),
  opening_side: z.enum(['dr', 'cr']),
}

export function splitOpening(signed: string | null | undefined, type: 'customer' | 'supplier'): { opening_balance: string; opening_side: 'dr' | 'cr' } {
  const v = (signed ?? '').trim()
  if (!v || /^-?0+(\.0+)?$/.test(v)) return { opening_balance: '', opening_side: type === 'customer' ? 'dr' : 'cr' }
  return v.startsWith('-') ? { opening_balance: v.slice(1), opening_side: 'cr' } : { opening_balance: v, opening_side: 'dr' }
}

/** Sent only when an amount was typed (or cleared to zero on an existing party). */
export function openingInput(v: { opening_balance: string; opening_side: 'dr' | 'cr' }, existing: boolean): { opening_balance?: string; opening_side?: 'dr' | 'cr' } {
  const amount = v.opening_balance.trim()
  if (!amount) return existing ? { opening_balance: '0.00', opening_side: v.opening_side } : {}
  return { opening_balance: amount, opening_side: v.opening_side }
}
