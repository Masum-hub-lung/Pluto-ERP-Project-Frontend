import { useAuditLog, type AuditableType } from '../api/audit'
import { lf } from '../ds'
import { actionLabel, changes, timeAgo } from '../lib/activity'
import { ProblemBanner } from './ProblemBanner'

/**
 * Activity tab (B4, C4, D3, E5, F4, H13 …): who did what and when, newest first, with "old → new" for changed
 * fields. Relative time with the exact time in the tooltip; "Show more" loads older entries.
 */
export function ActivityTimeline({ type, id }: { type: AuditableType; id: number }) {
  const { Skeleton, Button, EmptyState, Icon } = lf()
  const q = useAuditLog(type, id)
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (q.isPending) return <div role="status" aria-label="Loading activity" style={{ display: 'grid', gap: 10 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}</div>
  const entries = q.data.pages.flatMap((p) => p.data)
  if (entries.length === 0) return <EmptyState icon="history" title="No activity yet" description="Changes to this record will appear here." />
  return (
    <div>
      <ol data-testid="activity-timeline" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
        {entries.map((e, i) => (
          <li key={e.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 12, paddingBottom: i === entries.length - 1 ? 0 : 18, position: 'relative' }}>
            <span aria-hidden style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--brand-soft)', color: 'var(--brand-ink)', zIndex: 1 }}>
              <Icon name={e.action === 'created' ? 'plus' : e.action === 'deleted' ? 'trash-2' : e.action === 'deactivated' ? 'x' : 'pencil'} size={14} />
            </span>
            {i < entries.length - 1 && <span aria-hidden style={{ position: 'absolute', left: 13.5, top: 30, bottom: 0, width: 1, background: 'var(--line)' }} />}
            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'baseline' }}>
                <strong>{actionLabel(e.action)}</strong>
                <span style={{ color: 'var(--ink-muted)' }}>by {e.user?.name ?? 'the system'}</span>
                <time dateTime={e.created_at} title={new Date(e.created_at).toLocaleString('en-GB')} style={{ color: 'var(--ink-muted)', fontSize: 13 }}>· {timeAgo(e.created_at)}</time>
              </div>
              {e.action !== 'created' && changes(e).length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 2, fontSize: 13 }}>
                  {changes(e).map((c) => (
                    <li key={c.field} style={{ overflowWrap: 'anywhere' }}>
                      <span style={{ color: 'var(--ink-muted)' }}>{c.field}:</span> <span className="lf-num">{c.from}</span> → <span className="lf-num">{c.to}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
      {q.hasNextPage && <div style={{ marginTop: 16 }}><Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Show more</Button></div>}
    </div>
  )
}
