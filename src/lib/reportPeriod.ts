/** Report period caption (backlog P9.2-FE-01): dates only, never money. */
const day = (d: unknown) => (typeof d === 'string' ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

/** "As of 30 Jun 2026" or "1 Jul 2025 – 30 Jun 2026" from a ReportData period. */
export function periodText(p: Record<string, unknown>): string {
  if (p.as_of) return `As of ${day(p.as_of)}`
  if (p.from && p.to) return `${day(p.from)} – ${day(p.to)}`
  return ''
}
