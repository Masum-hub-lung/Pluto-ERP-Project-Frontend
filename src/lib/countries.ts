/**
 * Countries for suppliers (C1 filter, C2 country select; R-33). Bangladesh first, then the usual sourcing countries
 * of Bangladeshi traders; names come from the browser (Intl), so any ISO code the API returns still shows a name.
 */
export const SUPPLIER_COUNTRIES = ['BD', 'CN', 'IN', 'MY', 'ID', 'SG', 'TH', 'VN', 'TR', 'AE', 'SA', 'BR', 'AR', 'US', 'GB', 'DE', 'JP', 'KR', 'PK', 'LK']

let names: Intl.DisplayNames | null = null

export function countryName(code: string | null | undefined): string {
  if (!code) return '—'
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return names.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

/**
 * Default trading currency when the country changes on C2 (the user can still pick another). Only currencies the
 * backend has (seeded: BDT, CNY, EUR, GBP, INR, JPY, SGD, USD); everyone else trades in USD.
 */
const COUNTRY_CURRENCY: Record<string, string> = { BD: 'BDT', CN: 'CNY', IN: 'INR', SG: 'SGD', JP: 'JPY', GB: 'GBP', DE: 'EUR' }
export const defaultCurrency = (country: string) => COUNTRY_CURRENCY[country] ?? 'USD'
