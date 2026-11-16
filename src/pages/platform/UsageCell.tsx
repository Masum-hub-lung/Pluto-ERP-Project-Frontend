import type { CompanyUsage } from '../../api/contract.gen'
import { ds } from '../../ds'

/**
 * PEP-512 usage of a customer company in the platform console: the latest sign-in of its own people, this month's
 * invoices, bills and vouchers, active people in 30 days, and a "Quiet 7+ days" flag (all worked out by the API).
 */
export function ago(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Never signed in'
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'Signed in today'
  if (days === 1) return 'Signed in yesterday'
  if (days < 60) return `Signed in ${days} days ago`
  return `Signed in ${Math.floor(days / 30)} months ago`
}

export function workLine(u: CompanyUsage): string {
  const parts = [[u.invoices_this_month, 'invoice'], [u.bills_this_month, 'bill'], [u.vouchers_this_month, 'voucher']] as const
  const done = parts.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`)
  return done.length ? `This month: ${done.join(', ')}` : 'Nothing entered this month'
}

export function UsageCell({ usage }: { usage: CompanyUsage | undefined }) {
  const { Badge } = ds()
  if (!usage) return <span>—</span>
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', lineHeight: '18px', maxWidth: 220, whiteSpace: 'normal' }}>
      {usage.quiet && <Badge tone="warning" dot>Quiet 7+ days</Badge>}
      <span>{ago(usage.last_sign_in_at)}</span>
      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{workLine(usage)} · {usage.active_people_30d} active {usage.active_people_30d === 1 ? 'person' : 'people'}</span>
    </span>
  )
}
