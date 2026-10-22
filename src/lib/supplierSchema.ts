import { z } from 'zod'
import type { PartyInput } from '../api/contract.gen'

/**
 * Client-side shape checks for C2/C3 (03 §7 layer 1; backlog P2.2-FE-03). Like the customer schema, but the mobile is
 * required and BD-formatted only when the country is Bangladesh (R-33), and suppliers carry trading fields
 * (country, currency, port of loading, default purchase ledger) and one bank account. The server re-validates all.
 */
const mobileRx = /^01\d{3}-?\d{6}$/
const moneyRx = /^\d{1,16}(\.\d{1,2})?$/
const max = (n: number) => z.string().trim().max(n, `Use at most ${n} characters`)

export const supplierSchema = z.object({
  name: z.string().trim().min(1, "Enter the supplier's name").max(190, 'Use at most 190 characters'),
  category: z.enum(['', 'manufacturer', 'distributor', 'service_provider', 'individual']),
  party_group_id: z.string(),
  contact_person: max(120),
  country_code: z.string().regex(/^[A-Z]{2}$/, 'Choose a country'),
  default_currency_code: z.string().regex(/^[A-Z]{3}$/, 'Choose a currency'),
  mobile: z.string().trim().transform((s) => s.replace(/[\s()]/g, '')),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid e-mail address').max(190)]),
  alt_phone: max(20),
  address: max(255),
  district: z.string(),
  area: max(80),
  port_of_loading: max(120),
  payment_term_id: z.string(),
  credit_limit: z.union([z.literal(''), z.string().trim().regex(moneyRx, 'Enter an amount with up to 2 decimals, e.g. "500000.00"')]),
  default_purchase_ledger_id: z.string(),
  tax_registration_no: max(40),
  bank_name: max(120),
  bank_account_name: max(150),
  bank_account_number: max(40),
  bank_branch: max(120),
  notes: z.string().max(2000, 'Use at most 2000 characters'),
}).superRefine((v, ctx) => {
  if (v.country_code === 'BD') {
    if (!v.mobile) ctx.addIssue({ code: 'custom', path: ['mobile'], message: 'Enter a mobile number' })
    else if (!mobileRx.test(v.mobile)) ctx.addIssue({ code: 'custom', path: ['mobile'], message: 'Enter 11 digits starting 01, e.g. 01711-284530' })
  }
  if (v.bank_account_number && !v.bank_name) ctx.addIssue({ code: 'custom', path: ['bank_name'], message: 'Enter the bank name' })
  if (v.bank_name && !v.bank_account_number) ctx.addIssue({ code: 'custom', path: ['bank_account_number'], message: 'Enter the account number' })
})

export type SupplierFormValues = z.input<typeof supplierSchema>
export type SupplierFormParsed = z.output<typeof supplierSchema>

export const emptySupplier: Readonly<SupplierFormValues> = Object.freeze({
  name: '', category: '', party_group_id: '', contact_person: '', country_code: 'BD', default_currency_code: 'BDT', mobile: '', email: '',
  alt_phone: '', address: '', district: '', area: '', port_of_loading: '', payment_term_id: '', credit_limit: '', default_purchase_ledger_id: '',
  tax_registration_no: '', bank_name: '', bank_account_name: '', bank_account_number: '', bank_branch: '', notes: '',
})

/** Form values -> PartyInput (05 §10): empty strings become null, ids numbers, a BD mobile normalised to 01XXX-XXXXXX. */
export function toSupplierInput(v: SupplierFormParsed): PartyInput {
  const nil = (s: string) => (s.trim() === '' ? null : s.trim())
  const m = /^(01\d{3})-?(\d{6})$/.exec(v.mobile)
  return {
    party_type: 'supplier',
    name: v.name.trim(),
    category: v.category === '' ? null : v.category,
    party_group_id: v.party_group_id ? Number(v.party_group_id) : null,
    contact_person: nil(v.contact_person),
    country_code: v.country_code,
    default_currency_code: v.default_currency_code,
    mobile: v.country_code === 'BD' && m ? `${m[1]}-${m[2]}` : nil(v.mobile),
    email: nil(v.email),
    alt_phone: nil(v.alt_phone),
    address: nil(v.address),
    district: nil(v.district),
    area: nil(v.area),
    port_of_loading: nil(v.port_of_loading),
    payment_term_id: v.payment_term_id ? Number(v.payment_term_id) : null,
    credit_limit: nil(v.credit_limit),
    default_purchase_ledger_id: v.default_purchase_ledger_id ? Number(v.default_purchase_ledger_id) : null,
    tax_registration_no: nil(v.tax_registration_no),
    bank_accounts: v.bank_name.trim() ? [{ bank_name: v.bank_name.trim(), account_name: nil(v.bank_account_name), account_number: v.bank_account_number.trim(),
      branch: nil(v.bank_branch), is_default: true }] : [],
    notes: nil(v.notes),
  }
}

/** PartyInput field name -> form field name (server errors land on the right input). */
export const supplierFieldMap: Record<string, keyof SupplierFormValues> = {
  name: 'name', category: 'category', party_group_id: 'party_group_id', contact_person: 'contact_person', country_code: 'country_code',
  default_currency_code: 'default_currency_code', mobile: 'mobile', email: 'email', alt_phone: 'alt_phone', address: 'address',
  district: 'district', area: 'area', port_of_loading: 'port_of_loading', payment_term_id: 'payment_term_id', credit_limit: 'credit_limit',
  default_purchase_ledger_id: 'default_purchase_ledger_id', tax_registration_no: 'tax_registration_no', notes: 'notes',
  'bank_accounts.0.bank_name': 'bank_name', 'bank_accounts.0.account_name': 'bank_account_name',
  'bank_accounts.0.account_number': 'bank_account_number', 'bank_accounts.0.branch': 'bank_branch',
}
