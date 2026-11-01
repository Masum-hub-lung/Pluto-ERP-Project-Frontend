import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Member } from '../../api/contract.gen'
import { useBranches } from '../../api/platform'
import { useCompany, useInvitationAction, useInvitations, useInvite, useMember, useMemberStatus, useMembers, useRoles, useUpdateMember } from '../../api/settings'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { initials } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'
import { ActivityLine } from './parts'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ConflictBanner } from '../../components/ConflictBanner'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { Forbidden, NotFound } from '../../components/states'
import { SettingsLayout } from './SettingsLayout'

/**
 * K8 Users, K9 Invite, K10 User details (Settings.dc.html; FR-006–FR-008; BR-059–BR-061; backlog P15.2-FE-06). People
 * with role, last active and status, seats used; open invitations with Resend / Revoke; a member's role, branches,
 * 2-step status, what the role allows and recent activity, with Deactivate (their next request signs them out) and
 * Reactivate. Only an Owner hands out the Owner role; the company always keeps one active Owner (the API says so).
 */
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never')
const STATUS: Record<string, ['positive' | 'neutral' | 'warning', string]> = { active: ['positive', 'Active'], deactivated: ['neutral', 'Deactivated'], invited: ['warning', 'Invited'] }

export function Users() {
  const { DataTable, Button, Badge, Card, Input, EmptyState, Select } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const { get, set, search, setSearch, page } = useListParams()
  const status = get('status')
  const list = useMembers({ q: get('q') || undefined, status: status || undefined, page })
  const invites = useInvitations()
  const company = useCompany()
  const action = useInvitationAction()
  const [inviting, setInviting] = useState(false)
  if (!can('settings.users')) return <Forbidden permission="settings.users" what="users" />
  const seats = company.data ? `${company.data.seats_used} of ${company.data.seat_limit} seats in use` : ''

  const columns: DataColumn[] = [
    { key: 'name', label: 'Name', render: (_v, r) => (
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="lf-avatar" aria-hidden style={{ width: 30, height: 30, fontSize: 12 }}>{initials(r.name)}</span>
        <span style={{ display: 'flex', flexDirection: 'column' }}><strong>{r.name}</strong><span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.email}</span></span>
      </span>) },
    { key: 'role', label: 'Role' }, { key: 'last', label: 'Last active' },
    { key: 'tfa', label: '2-step', render: (v: boolean) => (v ? <Badge tone="positive">On</Badge> : <Badge tone="neutral">Off</Badge>) },
    { key: 'status', label: 'Status', render: (v: string) => <Badge tone={STATUS[v]?.[0] ?? 'neutral'} dot>{STATUS[v]?.[1] ?? v}</Badge> },
  ]
  const rows = (list.data?.data ?? []).map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role_name, last: when(m.last_active_at), tfa: m.two_factor_enabled, status: m.status }))

  async function act(id: number, a: 'resend' | 'revoke', email: string) {
    try {
      await action.mutateAsync({ id, action: a })
      toast({ tone: 'positive', title: a === 'resend' ? `Invitation sent again to ${email}` : `Invitation to ${email} withdrawn` })
    } catch (e) {
      toast({ tone: 'negative', title: 'Could not do that', description: e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : undefined })
    }
  }

  return (
    <SettingsLayout current="Users" eyebrow="Settings › People" title="Users" description={`People who can sign in to this company. ${seats}`}
      actions={<Button variant="primary" icon="user-plus" onClick={() => setInviting(true)} data-testid="invite-user">Invite user</Button>}>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      {(invites.data ?? []).length > 0 && (
        <Card title="Invitations not accepted yet">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="invitations">
            {invites.data!.map((i) => (
              <li key={i.id} className="se-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span style={{ display: 'flex', flexDirection: 'column' }}><strong>{i.name ? `${i.name} · ` : ''}{i.email}</strong>
                  <span style={{ fontSize: 13, color: i.status === 'expired' ? 'var(--negative)' : 'var(--ink-muted)' }}>
                    {i.status === 'expired' ? 'Expired' : `Link valid until ${when(i.expires_at)}`}</span></span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <Button size="sm" onClick={() => void act(i.id, 'resend', i.email)}>Resend</Button>
                  <Button size="sm" variant="ghost" onClick={() => void act(i.id, 'revoke', i.email)}>Revoke</Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card padding="none">
        <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}><Input icon="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" aria-label="Search people" /></div>
          <Select aria-label="Status" value={status} onChange={(e) => set({ status: e.target.value || null })}
            options={[{ value: '', label: 'Everyone' }, { value: 'active', label: 'Active' }, { value: 'deactivated', label: 'Deactivated' }]} />
        </div>
        <div style={{ overflowX: 'auto' }} data-testid="users-table">
          <DataTable caption="Users" columns={columns} rows={rows} loading={list.isPending} onRowClick={(r: { id: number }) => navigate(`/settings/users/${r.id}`)}
            emptyState={<EmptyState icon="users" title="Nobody matches" description="Clear the search or invite someone." />} />
        </div>
      </Card>
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </SettingsLayout>
  )
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const { Field, Input, Select, Button } = ds()
  const toast = useToast()
  const roles = useRoles()
  const branches = useBranches()
  const invite = useInvite()
  const idem = useIdempotencyKey()
  const { can } = useSession()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [branchIds, setBranchIds] = useState<number[]>([])
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  const ownerOk = can('settings.roles') // only an Owner (who holds every permission) can make someone Owner; the API checks too
  async function submit() {
    setError(null)
    try {
      await invite.mutateAsync({ idempotencyKey: idem.key, input: { email: email.trim(), name: name.trim() || null, role_id: Number(role), branch_ids: branchIds } })
      idem.reset()
      toast({ tone: 'positive', title: `Invitation sent to ${email.trim()}`, description: 'The link is valid for 7 days.' })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title="Invite user" description="They get an e-mail with a link valid for 7 days. An invitation uses a seat." onClose={onClose} testId="invite-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={invite.isPending} disabled={!email.trim() || !role} onClick={() => void submit()} data-testid="send-invite">Send invite</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />
        <Field label="Email address" required error={fe('email')} htmlFor="inv-email"><Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!fe('email')} autoFocus /></Field>
        <Field label="Name" htmlFor="inv-name"><Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Role" required error={fe('role_id')} htmlFor="inv-role">
          <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value)}
            options={[{ value: '', label: 'Choose a role' }, ...(roles.data ?? []).filter((r) => ownerOk || r.slug !== 'owner').map((r) => ({ value: String(r.id), label: r.name }))]} />
        </Field>
        {(branches.data ?? []).length > 1 && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            <legend style={{ fontWeight: 600, marginBottom: 4 }}>Locations they may work with</legend>
            <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Leave all unticked for every location</span>
            {branches.data!.map((b) => (
              <label key={b.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={branchIds.includes(b.id)} onChange={(e) => setBranchIds(e.target.checked ? [...branchIds, b.id] : branchIds.filter((x) => x !== b.id))} />{b.name}
              </label>
            ))}
          </fieldset>
        )}
      </div>
    </ResponsiveDialog>
  )
}

export function UserDetails() {
  const { id } = useParams()
  const { can } = useSession()
  const q = useMember(Number(id))
  if (!can('settings.users')) return <Forbidden permission="settings.users" what="users" />
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this user" back="/settings/users" backLabel="Users" />
  if (!q.data) return q.error ? <ProblemBanner error={q.error} onRetry={() => void q.refetch()} /> : <PageSkeleton template="detail" />
  return <Details m={q.data} reload={() => void q.refetch()} />
}

function Details({ m, reload }: { m: Member; reload: () => void }) {
  const { Card, Select, Button, Badge } = ds()
  const { me } = useSession()
  const toast = useToast()
  const navigate = useNavigate()
  const roles = useRoles()
  const branches = useBranches()
  const update = useUpdateMember()
  const status = useMemberStatus()
  const [role, setRole] = useState(String(m.role_id))
  const [branchIds, setBranchIds] = useState<number[]>(m.branch_ids ?? [])
  const [confirm, setConfirm] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const self = m.user_id === me?.id
  const dirty = role !== String(m.role_id) || JSON.stringify([...branchIds].sort()) !== JSON.stringify([...(m.branch_ids ?? [])].sort())

  async function save() {
    setError(null)
    try {
      await update.mutateAsync({ id: m.id, version: m.version, input: { role_id: Number(role), branch_ids: branchIds } })
      toast({ tone: 'positive', title: `${m.name} updated` })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else setError(e)
    }
  }
  async function setActive(a: 'deactivate' | 'reactivate') {
    setError(null)
    try {
      await status.mutateAsync({ id: m.id, action: a })
      setConfirm(false)
      toast({ tone: 'positive', title: a === 'deactivate' ? `${m.name} is deactivated` : `${m.name} is active again`,
        description: a === 'deactivate' ? 'They were signed out everywhere.' : undefined })
      reload()
    } catch (e) { setConfirm(false); setError(e) }
  }

  return (
    <SettingsLayout current="Users" eyebrow="Settings › People › Users" title={m.name} description={m.email}
      actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" icon="arrow-left" onClick={() => navigate('/settings/users')}>Users</Button>
        {!self && m.status === 'active' && <Button variant="danger" onClick={() => setConfirm(true)} data-testid="deactivate-user">Deactivate</Button>}
        {m.status === 'deactivated' && <Button onClick={() => void setActive('reactivate')} loading={status.isPending} data-testid="reactivate-user">Reactivate</Button>}
      </div>}>
      {conflict && <ConflictBanner onReload={() => { setConflict(false); reload() }} />}
      <ProblemBanner error={error} />
      <Card title="Access">
        <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <span><strong>Status</strong> <Badge tone={STATUS[m.status]?.[0] ?? 'neutral'} dot>{STATUS[m.status]?.[1] ?? m.status}</Badge></span>
          <span><strong>2-step</strong> {m.two_factor_enabled ? <Badge tone="positive">On</Badge> : <Badge tone="neutral">Off</Badge>}</span>
          <span><strong>Last active</strong> {when(m.last_active_at)}</span>
        </div>
        <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontWeight: 600 }}>Role</span>
          <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} disabled={m.status !== 'active'}
            options={(roles.data ?? []).map((r) => ({ value: String(r.id), label: r.name }))} />
        </div>
        {(branches.data ?? []).length > 1 && (
          <div className="se-row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}><strong>Locations</strong><span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>None ticked = every location</span></span>
            <span style={{ display: 'grid', gap: 4 }}>
              {branches.data!.map((b) => (
                <label key={b.id} style={{ display: 'flex', gap: 8 }}>
                  <input type="checkbox" checked={branchIds.includes(b.id)} onChange={(e) => setBranchIds(e.target.checked ? [...branchIds, b.id] : branchIds.filter((x) => x !== b.id))} />{b.name}
                </label>
              ))}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12 }}>
          <Button variant="ghost" disabled={!dirty} onClick={() => { setRole(String(m.role_id)); setBranchIds(m.branch_ids ?? []) }}>Discard</Button>
          <Button variant="primary" disabled={!dirty} loading={update.isPending} onClick={() => void save()} data-testid="save-member">Save changes</Button>
        </div>
      </Card>
      <Card title="What the role allows" subtitle={`${m.permissions?.length ?? 0} permissions`}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} data-testid="member-permissions">
          {(m.permissions ?? []).map((p) => <Badge key={p} tone="neutral">{p}</Badge>)}
        </div>
      </Card>
      <Card title="Recent activity">
        {(m.recent_activity ?? []).length === 0 ? <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Nothing recorded yet.</p>
          : <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{m.recent_activity!.map((a) => <ActivityLine key={a.id} a={a} />)}</ul>}
      </Card>
      {confirm && <ConfirmDialog title={`Deactivate ${m.name}?`} tone="negative" confirmLabel="Deactivate" loading={status.isPending}
        description="They are signed out everywhere at once and cannot sign in to this company. Vouchers waiting for their approval stay in the queue. You can reactivate them later if a seat is free."
        onConfirm={() => void setActive('deactivate')} onClose={() => setConfirm(false)} />}
    </SettingsLayout>
  )
}
