/**
 * Money display without floating point (05 §1: money is a decimal string end to end).
 * Bangladeshi grouping: 1,18,450.00 (lakh / crore).
 */
export function formatTaka(value: string | null | undefined, opts: { symbol?: boolean } = {}): string {
  const v = (value ?? '0').trim()
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v)
  if (!m) return v
  const [, sign, intRaw, fracRaw = ''] = m
  const int = intRaw.replace(/^0+(?=\d)/, '')
  const frac = (fracRaw + '00').slice(0, 2)
  const last3 = int.slice(-3)
  const rest = int.slice(0, -3)
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3
  const body = `${grouped}.${frac}`
  const neg = sign === '-' && /[1-9]/.test(int + frac)
  return (opts.symbol ? '৳ ' : '') + (neg ? `(${body})` : body)
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('')
}

/** "Net 15" -> "Net 15 days" as the design labels terms. */
export function termLabel(name: string | undefined | null): string {
  if (!name) return '—'
  return /^Net \d+$/.test(name) ? `${name} days` : name
}
