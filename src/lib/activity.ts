import type { AuditLog } from '../api/contract.gen'
import { formatTaka } from './format'

const ACTIONS: Record<string, string> = {
  created: 'Created', updated: 'Edited', deactivated: 'Made inactive', reactivated: 'Reactivated', deleted: 'Deleted',
  posted: 'Posted', cancelled: 'Cancelled', approved: 'Approved', rejected: 'Rejected', submitted: 'Sent for approval',
}

/** "updated" → "Edited"; unknown actions become sentence case ("two_factor_enabled" → "Two factor enabled"). */
export function actionLabel(action: string): string {
  return ACTIONS[action] ?? humanize(action)
}

/** "credit_limit" → "Credit limit", "party_group_id" → "Party group". */
export function humanize(key: string): string {
  const s = key.replace(/_id$/, '').replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** A value as shown in the timeline: money-like decimal strings with lakh grouping, empty as "—". */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^-?\d+\.\d{2}$/.test(v)) return formatTaka(v, { symbol: true })
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Field changes of one entry: every key in old or new values, with "old → new" text. */
export function changes(e: AuditLog): Array<{ field: string; from: string; to: string }> {
  const keys = [...new Set([...Object.keys(e.old_values ?? {}), ...Object.keys(e.new_values ?? {})])]
  return keys.map((k) => ({ field: humanize(k), from: showValue(e.old_values?.[k]), to: showValue(e.new_values?.[k]) }))
}

/** "just now", "5 min ago", "2 h ago", "3 days ago", then the date. `now` is injectable for tests. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? 'day' : 'days'} ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
