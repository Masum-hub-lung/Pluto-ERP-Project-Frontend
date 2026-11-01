import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import type { Role } from '../../api/contract.gen'
import { useDeleteRole, usePermissionCatalogue, useRoles, useSaveRole } from '../../api/settings'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ConflictBanner } from '../../components/ConflictBanner'
import { DeleteDialog } from '../../components/DeleteDialog'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { Forbidden } from '../../components/states'
import { SettingsLayout } from './SettingsLayout'

/**
 * K11 Roles and permissions (Settings.dc.html; FR-007; BR-060; R-10; backlog P15.2-FE-07): role chips, the module ×
 * View/Create/Edit/Approve/Delete matrix plus the special permissions, and the two approval limits (both required;
 * 0.00 = everything needs approval). The Owner role is read-only (it always has everything). New role, Duplicate
 * (copy_from_role_id), Save (PUT with If-Match), Delete for a role without members.
 */
const ACTIONS = ['view', 'create', 'edit', 'approve', 'delete']
const MODULES: Record<string, string> = { dashboard: 'Dashboard', parties: 'Customers and suppliers', inventory: 'Inventory', sales: 'Sales', purchases: 'Purchases',
  lc: 'Letters of credit', banking: 'Cash, bank, income and expenses', accounting: 'Accounting', reports: 'Reports', settings: 'Settings' }

interface Draft { name: string; description: string; permissions: string[]; payment_approval_limit: string; journal_approval_limit: string }
const draftOf = (r: Role): Draft => ({ name: r.name, description: r.description ?? '', permissions: [...r.permissions].sort(),
  payment_approval_limit: r.payment_approval_limit ?? '', journal_approval_limit: r.journal_approval_limit ?? '' })

export function Roles() {
  const { can } = useSession()
  const roles = useRoles()
  const cat = usePermissionCatalogue()
  if (!can('settings.roles')) return <Forbidden permission="settings.roles" what="roles and permissions" />
  if (!roles.data || !cat.data) return roles.error ? <ProblemBanner error={roles.error} onRetry={() => void roles.refetch()} /> : <PageSkeleton template="form" />
  return <Editor roles={roles.data} modules={cat.data.modules as unknown as Module[]} />
}

interface Module { module: string; permissions: Array<{ key: string; action: string; description: string; special: boolean }> }

function Editor({ roles, modules }: { roles: Role[]; modules: Module[] }) {
  const { Button, Card, Badge, Field, Input } = ds()
  const toast = useToast()
  const save = useSaveRole()
  const del = useDeleteRole()
  const [selected, setSelected] = useState(roles.find((r) => !r.is_system)?.id ?? roles[0].id)
  const role = roles.find((r) => r.id === selected) ?? roles[0]
  // A role just created is selected once the refreshed list has it (until then the current role stays on screen).
  const [pending, setPending] = useState<number | null>(null)
  useEffect(() => { if (pending && roles.some((r) => r.id === pending)) { setSelected(pending); setPending(null) } }, [roles, pending])
  const [draft, setDraft] = useState<Draft>(() => draftOf(role))
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState(false)
  const [creating, setCreating] = useState<null | { copyFrom: Role | null }>(null)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => { setDraft(draftOf(role)); setError(null); setConflict(false) }, [role.id, role.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const locked = role.is_system
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(role))
  const guard = useUnsavedChangesBlocker(dirty, `Your changes to ${role.name} are not saved.`)
  const has = (k: string) => draft.permissions.includes(k)
  const toggle = (k: string) => setDraft({ ...draft, permissions: has(k) ? draft.permissions.filter((p) => p !== k) : [...draft.permissions, k].sort() })
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)

  async function submit() {
    setError(null)
    try {
      await save.mutateAsync({ id: role.id, version: role.version, input: { name: draft.name.trim(), description: draft.description.trim() || null, permissions: draft.permissions,
        payment_approval_limit: draft.payment_approval_limit.replace(/,/g, '').trim(), journal_approval_limit: draft.journal_approval_limit.replace(/,/g, '').trim() } })
      toast({ tone: 'positive', title: `${draft.name} saved`, description: 'Members get the change on their next click.' })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else setError(e)
    }
  }

  const special = modules.flatMap((m) => m.permissions.filter((p) => p.special).map((p) => ({ ...p, module: m.module })))

  return (
    <SettingsLayout current="Roles and permissions" eyebrow="Settings › People" title="Roles and permissions" description="What each role may see and do, and the amounts it may post without approval."
      actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button icon="plus" onClick={() => setCreating({ copyFrom: null })} data-testid="new-role">New role</Button>
        <Button icon="copy" onClick={() => setCreating({ copyFrom: role })} data-testid="duplicate-role">Duplicate</Button>
      </div>}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="tablist" aria-label="Roles" data-testid="role-chips">
        {roles.map((r) => (
          <button key={r.id} type="button" role="tab" aria-selected={r.id === role.id} onClick={() => setSelected(r.id)} className="lf-btn lf-btn-sm"
            style={{ borderRadius: 16, background: r.id === role.id ? 'var(--ink)' : 'var(--surface)', color: r.id === role.id ? 'var(--surface)' : 'var(--ink)', border: '1px solid var(--line)' }}>
            {r.name} <span style={{ opacity: 0.7 }}>· {r.members_count}</span>
          </button>
        ))}
      </div>
      {conflict && <ConflictBanner onReload={() => { setConflict(false); setDraft(draftOf(role)) }} />}
      <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />
      {locked && <Card><p style={{ margin: 0 }}><Badge tone="accent">Owner</Badge> The Owner role always has every permission and no approval limit. It cannot be changed.</p></Card>}
      {!locked && (
        <Card title="Role">
          <div className="lf-grid" style={{ gap: 16 }}>
            <div className="lf-c6"><Field label="Name" required error={fe('name')} htmlFor="role-name"><Input id="role-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field></div>
            <div className="lf-c6"><Field label="Description" htmlFor="role-desc"><Input id="role-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field></div>
            <div className="lf-c6"><Field label="Payments without approval up to (৳)" required hint="0.00 = every payment needs approval" error={fe('payment_approval_limit')} htmlFor="role-pay">
              <Input id="role-pay" mono align="right" inputMode="decimal" value={draft.payment_approval_limit} onChange={(e) => setDraft({ ...draft, payment_approval_limit: e.target.value })} /></Field></div>
            <div className="lf-c6"><Field label="Journal vouchers without approval up to (৳)" required hint="0.00 = every journal needs approval" error={fe('journal_approval_limit')} htmlFor="role-jv">
              <Input id="role-jv" mono align="right" inputMode="decimal" value={draft.journal_approval_limit} onChange={(e) => setDraft({ ...draft, journal_approval_limit: e.target.value })} /></Field></div>
          </div>
        </Card>
      )}
      <Card title="Permissions" padding="none">
        <div style={{ overflowX: 'auto' }}>
          <table className="lf-statement" data-testid="permission-matrix">
            <thead><tr><th scope="col">Module</th>{ACTIONS.map((a) => <th key={a} scope="col" style={{ textAlign: 'center', textTransform: 'capitalize' }}>{a}</th>)}</tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.module}>
                  <td>{MODULES[m.module] ?? m.module}</td>
                  {ACTIONS.map((a) => {
                    const p = m.permissions.find((x) => x.action === a)
                    return (
                      <td key={a} style={{ textAlign: 'center' }}>
                        {p ? <input type="checkbox" aria-label={`${MODULES[m.module] ?? m.module}: ${a}`} checked={locked || has(p.key)} disabled={locked} onChange={() => toggle(p.key)}
                          data-testid={`perm-${p.key}`} style={{ width: 18, height: 18 }} /> : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {special.length > 0 && (
          <div style={{ padding: 16, display: 'grid', gap: 8 }}>
            <strong>Special permissions</strong>
            {special.map((p) => (
              <label key={p.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={locked || has(p.key)} disabled={locked} onChange={() => toggle(p.key)} data-testid={`perm-${p.key}`} />
                {p.description || p.key} <span className="lf-mono" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{p.key}</span>
              </label>
            ))}
          </div>
        )}
      </Card>
      {!locked && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Button variant="ghost" icon="trash-2" disabled={role.members_count > 0} onClick={() => setDeleting(true)} data-testid="delete-role">
            {role.members_count > 0 ? `In use by ${role.members_count}` : 'Delete role'}</Button>
          <span style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(draftOf(role))}>Discard</Button>
            <Button variant="primary" disabled={!dirty || !draft.name.trim()} loading={save.isPending} onClick={() => void submit()} data-testid="save-role">Save changes</Button>
          </span>
        </div>
      )}
      {creating && <NewRoleDialog copyFrom={creating.copyFrom} onClose={(id) => { setCreating(null); if (id) setPending(id) }} />}
      {deleting && <DeleteDialog name={role.name} what="role" loading={del.isPending} onClose={() => setDeleting(false)}
        onConfirm={async () => { await del.mutateAsync(role.id); setDeleting(false); setSelected(roles[0].id); toast({ tone: 'positive', title: `${role.name} deleted` }) }} />}
      {guard.dialog}
    </SettingsLayout>
  )
}

function NewRoleDialog({ copyFrom, onClose }: { copyFrom: Role | null; onClose: (id?: number) => void }) {
  const { Field, Input, Button } = ds()
  const toast = useToast()
  const save = useSaveRole()
  const idem = useIdempotencyKey()
  const [name, setName] = useState(copyFrom ? `${copyFrom.name} (copy)` : '')
  const [pay, setPay] = useState(copyFrom?.payment_approval_limit ?? '0.00')
  const [jv, setJv] = useState(copyFrom?.journal_approval_limit ?? '0.00')
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  async function submit() {
    setError(null)
    try {
      const r = await save.mutateAsync({ idempotencyKey: idem.key, input: { name: name.trim(), permissions: [], payment_approval_limit: pay.trim() || '0.00',
        journal_approval_limit: jv.trim() || '0.00', copy_from_role_id: copyFrom?.id ?? null } })
      idem.reset()
      toast({ tone: 'positive', title: `${r.name} added`, description: copyFrom ? `With the permissions of ${copyFrom.name}` : 'Tick what it may do, then save.' })
      onClose(r.id)
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title={copyFrom ? `Duplicate ${copyFrom.name}` : 'New role'} onClose={() => onClose()} testId="new-role-dialog"
      footer={<><Button variant="ghost" onClick={() => onClose()}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => void submit()} data-testid="create-role">Add role</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />
        <Field label="Name" required error={fe('name')} htmlFor="nr-name"><Input id="nr-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Payments without approval up to (৳)" required error={fe('payment_approval_limit')} htmlFor="nr-pay">
          <Input id="nr-pay" mono align="right" inputMode="decimal" value={pay ?? ''} onChange={(e) => setPay(e.target.value)} /></Field>
        <Field label="Journal vouchers without approval up to (৳)" required error={fe('journal_approval_limit')} htmlFor="nr-jv">
          <Input id="nr-jv" mono align="right" inputMode="decimal" value={jv ?? ''} onChange={(e) => setJv(e.target.value)} /></Field>
        {copyFrom?.is_system && <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Copies every permission; set limits for the new role.</span>}
      </div>
    </ResponsiveDialog>
  )
}
