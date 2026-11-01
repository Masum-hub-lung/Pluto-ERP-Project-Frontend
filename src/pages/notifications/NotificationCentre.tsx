import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Notification } from '../../api/contract.gen'
import { useMarkAllRead, useMarkRead, useNotifications } from '../../api/approvals'
import { notificationPath } from '../../app/NotificationBell'
import { useToast } from '../../app/toast'
import { ds } from '../../ds'
import { useListParams } from '../../lib/useListParams'
import { ApprovalDrawer } from '../../components/ApprovalDrawer'
import { ProblemBanner } from '../../components/ProblemBanner'

/**
 * L3 Notifications centre (States.dc.html L3; FR-013; backlog P14.2-FE-06): /notifications with tabs All, Unread,
 * Approvals, Alerts (?tab=), newest first and grouped by day (Dhaka). Opening one marks it read and opens what it links
 * to — an approval request opens the L4 drawer; "Mark all read" clears the bell.
 */
const TABS = [{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }, { value: 'approvals', label: 'Approvals' }, { value: 'alerts', label: 'Alerts' }]
const ICON: Record<string, string> = { approvals: 'stamp', alerts: 'triangle-alert', info: 'bell' }

const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

export function dayLabel(key: string, today: string): string {
  const d = new Date(`${key}T00:00:00Z`)
  const diff = Math.round((new Date(`${today}T00:00:00Z`).getTime() - d.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function NotificationCentre() {
  const { PageHeader, Tabs, Card, Button, EmptyState, Skeleton, Pagination, Icon, Badge } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { get, set, page } = useListParams()
  const tab = get('tab', 'all')
  const filter = tab === 'unread' ? { unread: 'true' as const } : tab === 'approvals' || tab === 'alerts' ? { category: tab } : {}
  const list = useNotifications({ ...filter, page, per_page: 30 })
  const unread = useNotifications({ unread: 'true', per_page: 1 })
  const read = useMarkRead()
  const readAll = useMarkAllRead()
  const [approval, setApproval] = useState<number | null>(null)
  const rows = list.data?.data ?? []
  const today = day(new Date().toISOString())
  const byDay: Array<[string, Notification[]]> = []
  for (const n of rows) {
    const k = day(n.created_at)
    const g = byDay.find(([key]) => key === k)
    g ? g[1].push(n) : byDay.push([k, [n]])
  }

  const open = (n: Notification) => {
    if (!n.read_at) read.mutate(n.id)
    if (n.link_type === 'approval_requests' && n.link_id) { setApproval(n.link_id); return }
    const path = notificationPath(n)
    if (path) navigate(path)
  }
  const markAll = () => readAll.mutate(undefined, { onSuccess: () => toast({ tone: 'positive', title: 'All notifications marked as read' }) })

  return (
    <>
      <PageHeader title="Notifications" description="Approvals waiting for you, alerts about money due, and what happened to your requests."
        actions={<Button variant="secondary" icon="check-check" disabled={readAll.isPending || (unread.data?.meta.total ?? 0) === 0} loading={readAll.isPending} onClick={markAll}
          data-testid="centre-read-all">Mark all read</Button>} />
      <div style={{ overflowX: 'auto', marginBottom: 16 }} data-testid="notification-tabs">
        <Tabs key={tab} value={tab} onChange={(v) => set({ tab: v === 'all' ? null : v })}
          items={TABS.map((t) => (t.value === 'unread' ? { ...t, count: unread.data?.meta.total ?? 0 } : t))} />
      </div>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      {list.isPending && <Skeleton height={200} />}
      {!list.isPending && rows.length === 0 && (
        <EmptyState icon="bell" title={tab === 'unread' ? 'You are all caught up' : tab === 'approvals' ? 'No approval requests' : tab === 'alerts' ? 'No alerts' : 'No notifications yet'}
          description="Approval requests, overdue invoices and bills coming due appear here." />
      )}
      {byDay.map(([k, items]) => (
        <section key={k} style={{ marginBottom: 16 }} aria-label={dayLabel(k, today)}>
          <h2 style={{ font: '600 13px/18px var(--font-sans)', color: 'var(--ink-muted)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{dayLabel(k, today)}</h2>
          <Card padding="none">
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((n, i) => (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n)} data-testid={`centre-notification-${n.id}`} data-unread={n.read_at ? 'false' : 'true'}
                    style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', padding: '12px 16px', border: 0, borderTop: i ? '1px solid var(--line)' : 0,
                      background: n.read_at ? 'transparent' : 'var(--accent-wash, var(--surface))', textAlign: 'left', font: 'inherit', color: 'var(--ink)', cursor: 'pointer', minHeight: 44 }}>
                    <span style={{ color: n.category === 'alerts' ? 'var(--warning, var(--negative))' : 'var(--ink-muted)', marginTop: 2 }}><Icon name={ICON[n.category] ?? 'bell'} size={18} /></span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: n.read_at ? 400 : 600 }}>{n.title}</span>
                      {n.body && <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{n.body}</span>}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: 'none' }}>
                      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{new Date(n.created_at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' })}</span>
                      {!n.read_at && <Badge tone="accent" dot>New</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}
      {(list.data?.meta.last_page ?? 1) > 1 && (
        <Pagination page={page} pageCount={list.data!.meta.last_page} total={list.data!.meta.total} pageSize={30} onChange={(p: number) => set({ page: p === 1 ? null : String(p) })} />
      )}
      {approval && <ApprovalDrawer id={approval} onClose={() => setApproval(null)} />}
    </>
  )
}
