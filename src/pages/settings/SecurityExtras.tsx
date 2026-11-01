import { useState } from 'react'
import { ApiError } from '../../api/client'
import { useCompanySettings } from '../../api/platform'
import { useChangePassword, useSessionAction, useSessions, useUpdateSettings } from '../../api/settings'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ProblemBanner } from '../../components/ProblemBanner'

/**
 * K14 Security, the rows besides 2-step (FR-002, FR-009, FR-086; BR-061; backlog P15.2-FE-09): change password (every
 * other sign-in ends), where you are signed in (sign one out, or all others), and the Owner's company switches —
 * require 2-step for everyone and sign out after inactivity.
 */
export function PasswordCard() {
  const { Card, Field, Input, Button, Banner } = ds()
  const toast = useToast()
  const change = useChangePassword()
  const [f, setF] = useState({ current_password: '', password: '', password_confirmation: '' })
  const [error, setError] = useState<unknown>(null)
  const [mismatch, setMismatch] = useState(false)
  const fe = (k: string) => (k === 'password_confirmation' && mismatch ? 'The two new passwords do not match' : error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  async function submit() {
    setError(null)
    setMismatch(f.password !== f.password_confirmation)
    if (f.password !== f.password_confirmation) return
    try {
      await change.mutateAsync(f)
      setF({ current_password: '', password: '', password_confirmation: '' })
      toast({ tone: 'positive', title: 'Password changed', description: 'You were signed out on your other devices.' })
    } catch (e) { setError(e) }
  }
  return (
    <Card title="Password">
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate style={{ display: 'grid', gap: 12, maxWidth: 420 }} data-testid="password-form">
        {error instanceof ApiError && !Object.keys(error.fieldErrors).length && <Banner tone="negative" title={error.problem.detail ?? error.problem.title} />}
        <ProblemBanner error={error instanceof ApiError ? null : error} />
        <Field label="Current password" required error={fe('current_password')} htmlFor="pw-current">
          <Input id="pw-current" type="password" autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} invalid={!!fe('current_password')} />
        </Field>
        <Field label="New password" required hint="At least 10 characters, not one that has leaked online" error={fe('password')} htmlFor="pw-new">
          <Input id="pw-new" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} invalid={!!fe('password')} />
        </Field>
        <Field label="Confirm new password" required error={fe('password_confirmation')} htmlFor="pw-confirm">
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={f.password_confirmation} onChange={(e) => setF({ ...f, password_confirmation: e.target.value })} invalid={!!fe('password_confirmation')} />
        </Field>
        <div><Button type="submit" variant="primary" loading={change.isPending} disabled={!f.current_password || f.password.length < 10} data-testid="change-password">Change password</Button></div>
      </form>
    </Card>
  )
}

export function SessionsCard() {
  const { Card, Button, Badge, Skeleton } = ds()
  const toast = useToast()
  const q = useSessions()
  const act = useSessionAction()
  const [confirm, setConfirm] = useState(false)
  const rows = q.data ?? []
  const device = (ua?: string | null, label?: string | null) => {
    if (label && !/Mozilla/.test(label)) return label
    const s = ua ?? label ?? ''
    const browser = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser'
    const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : ''
    return os ? `${browser} on ${os}` : browser
  }
  return (
    <Card title="Where you are signed in" actions={rows.length > 1 ? <Button size="sm" onClick={() => setConfirm(true)} data-testid="sign-out-others">Sign out everywhere else</Button> : undefined}>
      <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
      {q.isPending && <Skeleton height={60} />}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="sessions">
        {rows.map((s) => (
          <li key={s.id} className="se-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>{device(s.user_agent, s.device_label)}{s.current && <Badge tone="positive">This device</Badge>}</span>
              <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{s.ip_address ?? ''}{s.last_seen_at ? ` · last active ${new Date(s.last_seen_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
            </span>
            {!s.current && <Button size="sm" variant="ghost" onClick={() => void act.mutateAsync(s.id).then(() => toast({ tone: 'positive', title: 'Signed out that device' }))}>Sign out</Button>}
          </li>
        ))}
      </ul>
      {confirm && <ConfirmDialog title="Sign out everywhere else?" description="Every other browser and phone signed in to your account is signed out now. This one stays signed in."
        confirmLabel="Sign out others" loading={act.isPending} onClose={() => setConfirm(false)}
        onConfirm={() => void act.mutateAsync('others').then(() => { setConfirm(false); toast({ tone: 'positive', title: 'Signed out everywhere else' }) })} />}
    </Card>
  )
}

/** Owner only (settings.restore is the Owner's): require 2-step for everyone, idle sign-out. */
export function CompanySecurityCard() {
  const { Card, Switch, Select } = ds()
  const { me, can } = useSession()
  const toast = useToast()
  const settings = useCompanySettings()
  const update = useUpdateSettings()
  const s = settings.data
  if (!can('settings.restore') || !s) return null
  async function save(patch: { require_two_factor?: boolean; idle_timeout_minutes?: number | null }) {
    try {
      await update.mutateAsync({ input: patch, version: s!.version })
      toast({ tone: 'positive', title: 'Company security saved' })
    } catch (e) {
      toast({ tone: 'negative', title: 'Could not save', description: e instanceof ApiError ? (Object.values(e.fieldErrors)[0]?.[0] ?? e.problem.detail ?? e.problem.title) : undefined })
    }
  }
  return (
    <Card title="Company security" subtitle="Owner only">
      <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <span style={{ display: 'flex', flexDirection: 'column' }}><strong>Require 2-step verification for everyone</strong>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{me?.two_factor_enabled ? 'Members without it can only open Settings › Security until they turn it on' : 'Turn on 2-step for your own account first'}</span></span>
        <span data-testid="require-two-factor"><Switch key={`r2f-${String(s.require_two_factor)}`} checked={s.require_two_factor} disabled={update.isPending || (!me?.two_factor_enabled && !s.require_two_factor)}
          onChange={(v) => void save({ require_two_factor: v })} label={s.require_two_factor ? 'On' : 'Off'} /></span>
      </div>
      <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <span style={{ display: 'flex', flexDirection: 'column' }}><strong>Sign out after inactivity</strong>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>For everyone in this company</span></span>
        <Select aria-label="Sign out after inactivity" value={String(s.idle_timeout_minutes ?? '')} onChange={(e) => void save({ idle_timeout_minutes: e.target.value ? Number(e.target.value) : null })}
          options={[{ value: '', label: 'Never' }, { value: '15', label: '15 minutes' }, { value: '30', label: '30 minutes' }, { value: '60', label: '1 hour' }, { value: '120', label: '2 hours' }, { value: '240', label: '4 hours' }]} />
      </div>
    </Card>
  )
}
