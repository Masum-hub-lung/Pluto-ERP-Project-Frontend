import type { AuditLog } from '../../api/contract.gen'

/** One audit line on K10 (who did what, when). */
export function ActivityLine({ a }: { a: AuditLog }) {
  const what = a.action.replace(/_/g, ' ')
  return (
    <li className="se-row" style={{ flexWrap: 'wrap', gap: 8 }}>
      <span style={{ textTransform: 'capitalize' }}>{what}</span>
      <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
        {new Date(a.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        {a.ip_address ? ` · ${a.ip_address}` : ''}
      </span>
    </li>
  )
}
