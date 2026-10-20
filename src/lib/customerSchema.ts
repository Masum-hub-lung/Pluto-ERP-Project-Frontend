import { z } from 'zod'
import type { PartyInput } from '../api/contract.gen'

/**
 * Client-side shape checks for B2/B3 (03 §7 layer 1). The server is authoritative and re-validates everything;
 * these give instant feedback with the same messages as the API.
 */
const mobileRx = /^01\d{3}-?\d{6}$/
const moneyRx = /^\d{1,16}(\.\d{1,2})?$/

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Enter the customer or supplier name').max(190, 'Use at most 190 characters'),
  category: z.enum(['', 'business', 'individual', 'walk_in']),
  party_group_id: z.string(),
  contact_person: z.string().trim().max(120, 'Use at most 120 characters'),
  mobile: z.string().trim().min(1, 'Enter a mobile number')
    .transform((s) => s.replace(/[\s()]/g, ''))
    .refine((s) => mobileRx.test(s), 'Mobile numbers have 11 digits starting 01'),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid e-mail address').max(190)]),
  alt_phone: z.string().trim().max(20, 'Use at most 20 characters'),
  address: z.string().trim().max(255, 'Use at most 255 characters'),
  district: z.string(),
  area: z.string().trim().max(80, 'Use at most 80 characters'),
  payment_term_id: z.string(),
  credit_limit: z.union([z.literal(''), z.string().trim().regex(moneyRx, 'Enter an amount with up to 2 decimals, e.g. "500000.00"')]),
  price_tier: z.enum(['standard', 'wholesale']),
  tax_registration_no: z.string().trim().max(40, 'Use at most 40 characters'),
  notes: z.string().max(2000, 'Use at most 2000 characters'),
})

export type CustomerFormValues = z.input<typeof customerSchema>
export type CustomerFormParsed = z.output<typeof customerSchema>

export const emptyCustomer: Readonly<CustomerFormValues> = Object.freeze({
  name: '', category: '', party_group_id: '', contact_person: '', mobile: '', email: '', alt_phone: '', address: '',
  district: '', area: '', payment_term_id: '', credit_limit: '', price_tier: 'standard', tax_registration_no: '', notes: '',
})

/** Form values -> PartyInput (05 §10): empty strings become null, ids numbers, mobile normalised to 01XXX-XXXXXX. */
export function toPartyInput(v: CustomerFormParsed): PartyInput {
  const nil = (s: string) => (s.trim() === '' ? null : s.trim())
  const m = /^(01\d{3})-?(\d{6})$/.exec(v.mobile)
  return {
    party_type: 'customer',
    name: v.name.trim(),
    category: v.category === '' ? null : v.category,
    party_group_id: v.party_group_id ? Number(v.party_group_id) : null,
    contact_person: nil(v.contact_person),
    mobile: m ? `${m[1]}-${m[2]}` : v.mobile,
    email: nil(v.email),
    alt_phone: nil(v.alt_phone),
    address: nil(v.address),
    district: nil(v.district),
    area: nil(v.area),
    payment_term_id: v.payment_term_id ? Number(v.payment_term_id) : null,
    credit_limit: nil(v.credit_limit),
    price_tier: v.price_tier,
    tax_registration_no: nil(v.tax_registration_no),
    notes: nil(v.notes),
  }
}

/** PartyInput field name -> form field name (server errors land on the right input). */
export const serverFieldMap: Record<string, keyof CustomerFormValues> = {
  name: 'name', category: 'category', party_group_id: 'party_group_id', contact_person: 'contact_person', mobile: 'mobile',
  email: 'email', alt_phone: 'alt_phone', address: 'address', district: 'district', area: 'area', payment_term_id: 'payment_term_id',
  credit_limit: 'credit_limit', price_tier: 'price_tier', tax_registration_no: 'tax_registration_no', notes: 'notes',
}
