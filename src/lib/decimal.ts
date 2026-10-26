/**
 * Compares two API decimal strings ("1234.50", "-0.10") without turning them into numbers: no float maths on money
 * (CLAUDE.md rule 9). Used only to choose a side or an order, never to compute an amount. Invalid input counts as 0.
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a), pb = parse(b)
  if (pa.neg !== pb.neg) return pa.neg ? -1 : 1
  const sign = pa.neg ? -1 : 1
  const ia = pa.int.padStart(pb.int.length, '0'), ib = pb.int.padStart(pa.int.length, '0')
  const len = Math.max(pa.frac.length, pb.frac.length)
  const x = ia + pa.frac.padEnd(len, '0'), y = ib + pb.frac.padEnd(len, '0')
  if (x === y) return 0
  return (x > y ? sign : -sign) as -1 | 1
}

/** True for a well-formed amount above zero ("0.01", "1500"). */
export const isPositiveAmount = (v: string | null | undefined) => !!v && /^\d{1,16}(\.\d{1,2})?$/.test(v.trim()) && compareDecimal(v.trim(), '0') > 0

function parse(v: string) {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec((v ?? '').trim())
  if (!m) return { neg: false, int: '0', frac: '' }
  const int = (m[2] || '0').replace(/^0+(?=\d)/, '')
  const frac = (m[3] ?? '').replace(/0+$/, '')
  const zero = /^0*$/.test(int) && frac === ''
  return { neg: m[1] === '-' && !zero, int, frac }
}
