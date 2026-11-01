import { useEffect, useState } from 'react'
import type { NotificationPreferences, UserPreferences } from '../../api/contract.gen'
import { useNotificationPreferences, usePreferences, useSaveNotificationPreferences, useSavePreferences } from '../../api/settings'
import { useToast } from '../../app/toast'
import { ds } from '../../ds'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SettingsLayout } from './SettingsLayout'

/**
 * K12 Notifications and K13 Appearance (Settings.dc.html; FR-013, FR-086; backlog P15.2-FE-08). Notifications are per
 * company: in the app and by e-mail for each event, and the daily summary time (07:30, 08:00 or 09:00). Text
 * messages are not available yet. Appearance (theme, density, text size, reduced motion) follows the user to every
 * company and device; the shell applies it at once.
 */
const EVENTS: Record<string, [string, string]> = {
  approval_requested: ['A voucher needs my approval', 'When someone submits a voucher above their limit and you can approve it'],
  approval_approved: ['My voucher was approved', ''], approval_rejected: ['My voucher was rejected', 'With the reason'],
  invoice_overdue: ['An invoice falls overdue', 'The morning after its due date'], bill_due_soon: ['A bill is due in 3 days', ''],
  daily_summary: ['Daily summary', 'Sales, cash, overdue and stock in one e-mail each morning'],
}

export function NotificationSettings() {
  const { Card, Select, Button, Badge } = ds()
  const toast = useToast()
  const q = useNotificationPreferences()
  const save = useSaveNotificationPreferences()
  const [draft, setDraft] = useState<NotificationPreferences | null>(null)
  useEffect(() => { if (q.data) setDraft(q.data) }, [q.data])
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(q.data)
  const guard = useUnsavedChangesBlocker(dirty, 'Your notification choices are not saved.')
  if (!draft) return q.error ? <ProblemBanner error={q.error} onRetry={() => void q.refetch()} /> : <PageSkeleton template="form" />
  const set = (key: string, channel: 'in_app' | 'email', on: boolean) =>
    setDraft({ ...draft, events: draft.events.map((e) => (e.event_key === key ? { ...e, [channel]: on } : e)) })

  return (
    <SettingsLayout current="Notifications" eyebrow="Settings › You" title="Notifications" description="What reaches you, and where. These choices are yours, for this company."
      actions={<div style={{ display: 'flex', gap: 8 }}>
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(q.data!)}>Discard</Button>
        <Button variant="primary" disabled={!dirty} loading={save.isPending} data-testid="save-notifications"
          onClick={() => void save.mutateAsync(draft).then(() => toast({ tone: 'positive', title: 'Notification choices saved' }))
            .catch(() => toast({ tone: 'negative', title: 'Could not save; try again' }))}>Save changes</Button>
      </div>}>
      <Card padding="none">
        <div style={{ overflowX: 'auto' }}>
          <table className="lf-statement" data-testid="notification-matrix">
            <thead><tr><th scope="col">Event</th><th scope="col" style={{ textAlign: 'center' }}>In the app</th><th scope="col" style={{ textAlign: 'center' }}>E-mail</th>
              <th scope="col" style={{ textAlign: 'center' }}>Text message</th></tr></thead>
            <tbody>
              {draft.events.map((e) => (
                <tr key={e.event_key}>
                  <td><strong>{EVENTS[e.event_key]?.[0] ?? e.event_key}</strong>{EVENTS[e.event_key]?.[1] && <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{EVENTS[e.event_key][1]}</div>}</td>
                  <td style={{ textAlign: 'center' }}>{e.event_key === 'daily_summary' ? '—'
                    : <input type="checkbox" aria-label={`${EVENTS[e.event_key]?.[0]}: in the app`} checked={e.in_app} onChange={(x) => set(e.event_key, 'in_app', x.target.checked)} style={{ width: 18, height: 18 }} />}</td>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" aria-label={`${EVENTS[e.event_key]?.[0]}: e-mail`} checked={e.email} data-testid={`email-${e.event_key}`}
                    onChange={(x) => set(e.event_key, 'email', x.target.checked)} style={{ width: 18, height: 18 }} /></td>
                  <td style={{ textAlign: 'center' }}><Badge tone="neutral">Later</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Daily summary time">
        <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <span>Sent at this time (Dhaka) when the daily summary e-mail is on</span>
          <Select aria-label="Daily summary time" value={draft.daily_summary_time ?? '08:00'} onChange={(e) => setDraft({ ...draft, daily_summary_time: e.target.value })}
            options={['07:30', '08:00', '09:00'].map((t) => ({ value: t, label: t }))} />
        </div>
      </Card>
      {guard.dialog}
    </SettingsLayout>
  )
}

export function Appearance() {
  const { Card, Segmented, Switch, Button } = ds()
  const toast = useToast()
  const q = usePreferences()
  const save = useSavePreferences()
  const [draft, setDraft] = useState<UserPreferences | null>(null)
  useEffect(() => { if (q.data) setDraft(q.data) }, [q.data])
  if (!draft) return q.error ? <ProblemBanner error={q.error} onRetry={() => void q.refetch()} /> : <PageSkeleton template="form" />
  const apply = async (patch: Partial<UserPreferences>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    try {
      await save.mutateAsync(next)
    } catch {
      toast({ tone: 'negative', title: 'Could not save your appearance choice' })
      setDraft(q.data ?? null)
    }
  }
  return (
    <SettingsLayout current="Appearance" eyebrow="Settings › You" title="Appearance" description="How Pluto looks for you, on every device. Changes apply at once.">
      <Card title="Theme">
        <div role="radiogroup" aria-label="Theme" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }} data-testid="theme-choice">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <Button key={t} variant={draft.theme === t ? 'primary' : 'secondary'} icon={t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor'} onClick={() => void apply({ theme: t })}
              data-testid={`theme-${t}`}>{t === 'system' ? 'Same as my device' : t === 'light' ? 'Light' : 'Dark'}</Button>
          ))}
        </div>
      </Card>
      <Card title="Reading">
        <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontWeight: 600 }}>Table density</span>
          <Segmented options={[{ value: 'default', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} value={draft.density ?? 'default'} onChange={(v) => void apply({ density: v as UserPreferences['density'] })} />
        </div>
        <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontWeight: 600 }}>Text size</span>
          <Segmented options={[{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }]} value={draft.text_size ?? 'm'} onChange={(v) => void apply({ text_size: v as UserPreferences['text_size'] })} />
        </div>
        <div className="se-row">
          <span style={{ fontWeight: 600 }}>Reduce motion</span>
          <Switch key={`rm-${String(draft.reduce_motion)}`} checked={!!draft.reduce_motion} onChange={(v) => void apply({ reduce_motion: v })} label={draft.reduce_motion ? 'On' : 'Off'} />
        </div>
      </Card>
    </SettingsLayout>
  )
}
