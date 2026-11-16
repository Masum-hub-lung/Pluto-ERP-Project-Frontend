import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { Announcement, AnnouncementInput } from '../../api/contract.gen'
import { useToast } from '../../app/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ConflictBanner } from '../../components/ConflictBanner'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { ds, type DataColumn } from '../../ds'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'

/**
 * PEP-513 Announcements tab of the platform console (K17): post a message every company sees as a banner until each
 * person closes it; schedule it (start / end), stop it, change it or delete it.
 */
const TONES = [{ value: 'info', label: 'Information' }, { value: 'warning', label: 'Warning' }, { value: 'success', label: 'Good news' }]
const when = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—')
/** ISO time → the value a datetime-local input shows, in Dhaka time. */
const toLocal = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 6 * 3600_000).toISOString().slice(0, 16) : '')
/** datetime-local value (Dhaka) → ISO with the +06:00 offset; empty → null. */
const fromLocal = (v: string) => (v ? `${v}:00+06:00` : null)

function status(a: Announcement): { tone: 'positive' | 'neutral' | 'warning'; text: string } {
  const now = Date.now()
  if (!a.is_active) return { tone: 'neutral', text: 'Stopped' }
  if (a.starts_at && new Date(a.starts_at).getTime() > now) return { tone: 'warning', text: 'Scheduled' }
  if (a.ends_at && new Date(a.ends_at).getTime() <= now) return { tone: 'neutral', text: 'Ended' }
  return { tone: 'positive', text: 'Showing' }
}

export function AnnouncementsPanel() {
  const { Card, Button, DataTable, Badge, EmptyState } = ds()
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({
    queryKey: ['platform', 'announcements'] as const,
    queryFn: async ({ signal }) => (await api.request<{ data: Announcement[] }>('GET', '/platform/announcements', { company: false, signal })).data.data,
    staleTime: 0,
  })
  const del = useMutation({
    mutationFn: async (id: number) => { await api.request('DELETE', `/platform/announcements/${id}`, { company: false }) },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['platform', 'announcements'] }); void qc.invalidateQueries({ queryKey: ['announcements'] }) },
  })
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Announcement | null>(null)
  const rows = (list.data ?? []).map((a) => ({ ...a, a }))
  const columns: DataColumn[] = [
    { key: 'title', label: 'Message', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px', whiteSpace: 'normal', maxWidth: 420 }}>
        <span style={{ fontWeight: 600 }}>{r.title}</span>{r.body && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.body}</span>}
      </span>) },
    { key: 'tone', label: 'Kind', render: (v: string) => TONES.find((t) => t.value === v)?.label ?? v },
    { key: 'starts_at', label: 'From', render: (v: string | null) => (v ? when(v) : 'At once') },
    { key: 'ends_at', label: 'Until', render: (v: string | null) => (v ? when(v) : 'Until stopped') },
    { key: 'status', label: 'Status', render: (_v, r) => { const s = status(r.a as Announcement); return <Badge tone={s.tone} dot>{s.text}</Badge> } },
    { key: 'edit', label: '', render: (_v, r) => (
      <span style={{ display: 'inline-flex', gap: 4, whiteSpace: 'nowrap' }}>
        <Button size="sm" variant="secondary" icon="pencil" onClick={() => setEditing(r.a as Announcement)} aria-label={`Edit ${r.title}`} data-testid={`edit-announcement-${r.id}`}>Edit</Button>
        <Button size="sm" variant="ghost" icon="trash-2" onClick={() => setDeleting(r.a as Announcement)} aria-label={`Delete ${r.title}`}>Delete</Button>
      </span>) },
  ]
  return (
    <Card padding="none">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '16px 20px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, font: '600 16px/22px var(--font-sans)' }}>Announcements</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--ink-muted)', fontSize: 13 }}>Shown to everyone in every company at the top of Pluto, until each person closes it.</p>
        </div>
        <Button variant="primary" icon="bell" onClick={() => setEditing('new')} data-testid="new-announcement">New announcement</Button>
      </div>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <div style={{ overflowX: 'auto' }}>
        <DataTable caption="Announcements" columns={columns} rows={rows} loading={list.isPending}
          emptyState={<EmptyState icon="bell" title="No announcements yet" description="Tell every company about an update, a new feature or planned downtime." />} />
      </div>
      {editing && <AnnouncementDialog announcement={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog title={`Delete "${deleting.title}"?`} confirmLabel="Delete" tone="negative" loading={del.isPending} onClose={() => setDeleting(null)}
        onConfirm={() => del.mutate(deleting.id, { onSuccess: () => { toast({ tone: 'positive', title: 'Announcement deleted' }); setDeleting(null) } })}>
        It disappears for everyone at once.
      </ConfirmDialog>}
    </Card>
  )
}

function AnnouncementDialog({ announcement, onClose }: { announcement: Announcement | null; onClose: () => void }) {
  const { Field, Input, Select, Button, Switch } = ds()
  const qc = useQueryClient()
  const toast = useToast()
  const idem = useIdempotencyKey()
  const [v, setV] = useState({ title: announcement?.title ?? '', body: announcement?.body ?? '', tone: announcement?.tone ?? 'info',
    starts_at: toLocal(announcement?.starts_at), ends_at: toLocal(announcement?.ends_at), is_active: announcement?.is_active ?? true })
  const [error, setError] = useState<unknown>(null)
  const save = useMutation({
    mutationFn: async (input: AnnouncementInput) => (await (announcement
      ? api.request<{ data: Announcement }>('PUT', `/platform/announcements/${announcement.id}`, { company: false, body: input, ifMatch: `W/"${announcement.version}"` })
      : api.request<{ data: Announcement }>('POST', '/platform/announcements', { company: false, body: input, idempotencyKey: idem.key }))).data.data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['platform', 'announcements'] }); void qc.invalidateQueries({ queryKey: ['announcements'] }) },
  })
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  async function submit() {
    setError(null)
    try {
      await save.mutateAsync({ title: v.title.trim(), body: v.body.trim() || null, tone: v.tone as 'info', starts_at: fromLocal(v.starts_at), ends_at: fromLocal(v.ends_at), is_active: v.is_active })
      idem.reset()
      toast({ tone: 'positive', title: announcement ? 'Announcement saved' : 'Announcement posted', description: v.is_active ? 'Everyone sees it at the top of Pluto.' : 'It is stopped: nobody sees it.' })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title={announcement ? 'Edit announcement' : 'New announcement'} description="Everyone in every company sees it until they close it." onClose={onClose} testId="announcement-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!v.title.trim()} onClick={() => void submit()} data-testid="announcement-save">{announcement ? 'Save' : 'Post'}</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        {error instanceof ApiError && error.code === 'version_conflict' ? <ConflictBanner onReload={onClose} /> : <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />}
        <Field label="Title" required htmlFor="an-title" error={fe('title')} hint="Short, e.g. Update tonight at 11 pm">
          <Input id="an-title" value={v.title} maxLength={120} onChange={(e) => setV({ ...v, title: e.target.value })} invalid={!!fe('title')} autoFocus /></Field>
        <Field label="Message" htmlFor="an-body" error={fe('body')} hint="Optional, up to 500 characters">
          <Input id="an-body" value={v.body} maxLength={500} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
        <Field label="Kind" htmlFor="an-tone"><Select id="an-tone" value={v.tone} onChange={(e) => setV({ ...v, tone: e.target.value as 'info' })} options={TONES} /></Field>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field label="Show from (Dhaka time)" htmlFor="an-from" hint="Empty = at once" error={fe('starts_at')}>
            <Input id="an-from" type="datetime-local" value={v.starts_at} onChange={(e) => setV({ ...v, starts_at: e.target.value })} /></Field>
          <Field label="Show until (Dhaka time)" htmlFor="an-until" hint="Empty = until stopped" error={fe('ends_at')}>
            <Input id="an-until" type="datetime-local" value={v.ends_at} onChange={(e) => setV({ ...v, ends_at: e.target.value })} /></Field>
        </div>
        {announcement && <Switch label="Showing (turn off to stop it)" checked={v.is_active} onChange={(on: boolean) => setV({ ...v, is_active: on })} />}
      </div>
    </ResponsiveDialog>
  )
}
