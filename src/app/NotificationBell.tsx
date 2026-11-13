import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Notification } from '../api/contract.gen'
import { useMarkAllRead, useMarkRead, useNotifications } from '../api/approvals'
import { ds } from '../ds'
import { ApprovalDrawer } from '../components/ApprovalDrawer'

/**
 * L3 notification panel (05 notifications; FR-013; backlog P7.2-FE-08). The Shell passes the unread count to the
 * top bar's bell (polled every 60 s) and opens this panel from it. An approval request opens the L4 drawer; other
 * notifications open what they link to. Opening one marks it read.
 */
export function useUnreadCount() {
  const q = useNotifications({ unread: 'true', per_page: 1 }, true)
  return q.data?.meta.total ?? 0
}

/** The page a notification opens (approval requests open the L4 drawer instead). */
export function notificationPath(n: Pick<Notification, 'link_type' | 'link_id'>): string | null {
  if (!n.link_id) return null
  return ({ journal_entries: `/accounting/vouchers/${n.link_id}`, sales_invoices: `/sales/invoices/${n.link_id}`, purchase_bills: `/purchases/bills/${n.link_id}`,
    letters_of_credit: `/lc/${n.link_id}`, lc_loans: `/lc/loans/${n.link_id}` } as Record<string, string>)[n.link_type ?? ''] ?? null
}

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { Button, EmptyState, Skeleton } = ds()
  const navigate = useNavigate()
  const list = useNotifications({ per_page: 20 })
  const read = useMarkRead()
  const readAll = useMarkAllRead()
  const [approval, setApproval] = useState<number | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (approval) return
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !panel.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.lf-topbar')) onClose()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [onClose, approval])

  const open = (n: Notification) => {
    if (!n.read_at) read.mutate(n.id)
    if (n.link_type === 'approval_requests' && n.link_id) { setApproval(n.link_id); return }
    const path = notificationPath(n)
    if (path) { onClose(); navigate(path) }
  }
  const rows = list.data?.data ?? []

  return (
    <>
      <div ref={panel} role="dialog" aria-label="Notifications" data-testid="notification-panel"
        style={{ position: 'absolute', right: 56, top: 'calc(100% - 4px)', width: 'min(380px, calc(100vw - 32px))', maxHeight: '70vh', overflowY: 'auto', zIndex: 30,
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-2, var(--shadow-1))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
          <strong>Notifications</strong>
          <span style={{ display: 'flex', gap: 4 }}>
            <Button variant="ghost" size="sm" disabled={readAll.isPending || !rows.some((n) => !n.read_at)} onClick={() => readAll.mutate()} data-testid="read-all">Mark all read</Button>
            <Button variant="ghost" size="sm" onClick={() => { onClose(); navigate('/notifications') }} data-testid="see-all-notifications">See all</Button>
          </span>
        </div>
        {list.isPending && <div style={{ padding: 14 }}><Skeleton height={48} /></div>}
        {!list.isPending && rows.length === 0 && <EmptyState icon="bell" title="Nothing new" description="Approvals and alerts appear here." />}
        {rows.map((n) => (
          <button key={n.id} type="button" onClick={() => open(n)} data-testid={`notification-${n.id}`}
            style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%', textAlign: 'left', padding: '10px 14px', border: 0, borderBottom: '1px solid var(--line)',
              background: n.read_at ? 'transparent' : 'var(--accent-wash, var(--surface))', cursor: 'pointer', color: 'var(--ink)', font: 'inherit' }}>
            <span style={{ fontWeight: n.read_at ? 400 : 600 }}>{n.title}</span>
            {n.body && <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{n.body}</span>}
            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{new Date(n.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</span>
          </button>
        ))}
      </div>
      {approval && <ApprovalDrawer id={approval} onClose={() => { setApproval(null); onClose() }} />}
    </>
  )
}
