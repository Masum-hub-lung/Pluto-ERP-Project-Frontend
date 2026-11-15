import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { Plan, PlatformCompany } from '../../api/contract.gen'
import { useCompanyPlan, useDeletePlan, usePlans, useSavePlan } from '../../api/platformConsole'
import { useToast } from '../../app/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ConflictBanner } from '../../components/ConflictBanner'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { ds, type DataColumn } from '../../ds'
import { MODULE_LABELS, type ModuleKey } from '../../lib/modules'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'

/**
 * PEP-498 Pluto plans in the platform console (K17): each plan sets how many users and branches a company may have and
 * which modules it gets (LC management, LC finance). Every number can be changed at any time and the companies on the
 * plan follow at once; lowering a limit removes nobody and switching a module off deletes nothing. A company can also
 * have its own exceptions ("Change plan").
 */
const MODULES = Object.keys(MODULE_LABELS) as ModuleKey[]
const modulesText = (m: readonly string[]) => (m.length ? m.map((k) => MODULE_LABELS[k as ModuleKey] ?? k).join(', ') : 'No add-on modules')
const branchesText = (n: number | null | undefined) => (n == null ? 'Unlimited' : String(n))
const whole = (s: string) => /^\d{1,5}$/.test(s.trim()) && Number(s) >= 1

export function PlansPanel() {
  const { Button, DataTable, Badge, EmptyState, Card } = ds()
  const plans = usePlans()
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Plan | null>(null)
  const rows = (plans.data ?? []).map((p) => ({ ...p, plan: p }))
  const columns: DataColumn[] = [
    { key: 'name', label: 'Plan', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.name}</span><span className="lf-mono" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.slug}</span>
      </span>) },
    { key: 'max_users', label: 'Users', align: 'right', render: (v: number) => <span className="lf-num">{v}</span> },
    { key: 'max_branches', label: 'Branches', align: 'right', render: (v: number | null) => <span className="lf-num">{branchesText(v)}</span> },
    { key: 'modules', label: 'Modules', render: (v: string[]) => <span style={{ whiteSpace: 'normal' }}>{modulesText(v)}</span> },
    { key: 'companies', label: 'Companies', align: 'right', render: (v: number) => <span className="lf-num">{v ?? 0}</span> },
    { key: 'is_active', label: 'Status', render: (v: boolean) => <Badge tone={v ? 'positive' : 'neutral'} dot>{v ? 'Offered' : 'Not offered'}</Badge> },
    { key: 'edit', label: '', render: (_v, r) => (
      <span style={{ display: 'inline-flex', gap: 4, whiteSpace: 'nowrap' }}>
        <Button size="sm" variant="secondary" icon="pencil" onClick={() => setEditing(r.plan as Plan)} data-testid={`edit-plan-${r.slug}`} aria-label={`Edit ${r.name}`}>Edit</Button>
        {/* PEP-499: only a plan no company is on can be deleted; the API refuses otherwise (plan_in_use). */}
        {!r.companies && <Button size="sm" variant="ghost" icon="trash-2" onClick={() => setDeleting(r.plan as Plan)} data-testid={`delete-plan-${r.slug}`} aria-label={`Delete ${r.name}`}>Delete</Button>}
      </span>) },
  ]
  return (
    <Card padding="none">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '16px 20px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, font: '600 16px/22px var(--font-sans)' }}>Plans</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--ink-muted)', fontSize: 13 }}>Changes apply at once to every company on the plan. Lowering a limit removes nobody; switching a module off deletes nothing.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')} data-testid="new-plan">New plan</Button>
      </div>
      <ProblemBanner error={plans.error} onRetry={() => void plans.refetch()} />
      <div style={{ overflowX: 'auto' }} data-testid="plans-table">
        <DataTable caption="Plans" columns={columns} rows={rows} loading={plans.isPending}
          emptyState={<EmptyState icon="layers" title="No plans yet" description="Create the plans you sell." action={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New plan</Button>} />} />
      </div>
      {editing && <PlanDialog plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeletePlanDialog plan={deleting} onClose={() => setDeleting(null)} />}
    </Card>
  )
}

function DeletePlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const toast = useToast()
  const del = useDeletePlan()
  return (
    <ConfirmDialog title={`Delete ${plan.name}?`} confirmLabel="Delete plan" tone="negative" loading={del.isPending}
      onConfirm={async () => {
        try {
          await del.mutateAsync(plan.id)
          toast({ tone: 'positive', title: `${plan.name} deleted` })
          onClose()
        } catch (e) {
          toast({ tone: 'negative', title: `${plan.name} was not deleted`, description: e instanceof ApiError ? (e.problem.detail ?? e.message) : 'Try again.' })
          onClose()
        }
      }}
      onClose={onClose}>
      No company is on this plan. It is removed for good; you can create it again later.
    </ConfirmDialog>
  )
}

function ModuleSwitches({ value, onChange, idPrefix }: { value: string[]; onChange: (m: string[]) => void; idPrefix: string }) {
  const { Switch } = ds()
  const set = (m: ModuleKey, on: boolean) => {
    let next = on ? [...new Set([...value, m])] : value.filter((x) => x !== m)
    if (m === 'lc_management' && !on) next = next.filter((x) => x !== 'lc_finance') // finance lives inside LC management
    if (m === 'lc_finance' && on) next = [...new Set([...next, 'lc_management'])]
    onChange(next)
  }
  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid={`${idPrefix}-modules`}>
      {MODULES.map((m) => <Switch key={m} label={MODULE_LABELS[m]} checked={value.includes(m)} onChange={(on: boolean) => set(m, on)} />)}
    </div>
  )
}

function PlanDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const { Field, Input, Button, Switch } = ds()
  const toast = useToast()
  const save = useSavePlan()
  const idem = useIdempotencyKey()
  const [v, setV] = useState({ name: plan?.name ?? '', slug: plan?.slug ?? '', max_users: String(plan?.max_users ?? 5), max_branches: plan?.max_branches == null ? '' : String(plan.max_branches),
    modules: [...(plan?.modules ?? [])], is_active: plan?.is_active ?? true })
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  const conflict = error instanceof ApiError && error.code === 'version_conflict'
  const ok = v.name.trim() && v.slug.trim() && whole(v.max_users) && (v.max_branches.trim() === '' || whole(v.max_branches))
  async function submit() {
    setError(null)
    try {
      const p = await save.mutateAsync({ id: plan?.id, version: plan?.version, idempotencyKey: idem.key, input: { name: v.name.trim(), slug: v.slug.trim(),
        max_users: Number(v.max_users), max_branches: v.max_branches.trim() === '' ? null : Number(v.max_branches), modules: v.modules, is_active: v.is_active } })
      idem.reset()
      toast({ tone: 'positive', title: plan ? `${p.name} saved` : `${p.name} created`, description: plan ? `${p.companies ?? 0} companies on it follow at once.` : 'Put companies on it from the company list.' })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title={plan ? `Edit ${plan.name}` : 'New plan'} description="Users and branches a company may have, and the modules it gets." onClose={onClose} testId="plan-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!ok} onClick={() => void submit()} data-testid="plan-save">{plan ? 'Save plan' : 'Create plan'}</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        {conflict ? <ConflictBanner onReload={onClose} /> : <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />}
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field label="Name" required htmlFor="pl-name" error={fe('name')}><Input id="pl-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus /></Field>
          <Field label="Short name" required hint="Lower-case, e.g. import_pro" htmlFor="pl-slug" error={fe('slug')}>
            <Input id="pl-slug" mono value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} invalid={!!fe('slug')} /></Field>
          <Field label="Users" required htmlFor="pl-users" error={fe('max_users')}>
            <Input id="pl-users" inputMode="numeric" align="right" mono value={v.max_users} onChange={(e) => setV({ ...v, max_users: e.target.value })} invalid={!!fe('max_users')} /></Field>
          <Field label="Branches" hint="Leave empty for unlimited" htmlFor="pl-branches" error={fe('max_branches')}>
            <Input id="pl-branches" inputMode="numeric" align="right" mono value={v.max_branches} placeholder="Unlimited" onChange={(e) => setV({ ...v, max_branches: e.target.value })} invalid={!!fe('max_branches')} /></Field>
        </div>
        <Field label="Modules" error={fe('modules')}><ModuleSwitches value={v.modules} onChange={(m) => setV({ ...v, modules: m })} idPrefix="pl" /></Field>
        <Switch label="Offered to new companies" checked={v.is_active} onChange={(on: boolean) => setV({ ...v, is_active: on })} />
      </div>
    </ResponsiveDialog>
  )
}

/** The Plan cell of the company list: plan name, users used of allowed, and the Change plan button. */
export function PlanCell({ company, onChange }: { company: PlatformCompany; onChange: () => void }) {
  const { Button } = ds()
  const e = company.effective
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', lineHeight: '18px' }}>
      <span><strong>{company.plan?.name ?? '—'}</strong>{company.plan_overrides ? <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}> · own limits</span> : null}</span>
      {e && <span className="lf-mono" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{company.users_used ?? 0}/{e.max_users} users</span>}
      <Button size="sm" variant="ghost" onClick={onChange} data-testid={`plan-${company.id}`} aria-label={`Change the plan of ${company.legal_name}`}>Change plan</Button>
    </span>
  )
}

export function CompanyPlanDialog({ company, onClose }: { company: PlatformCompany; onClose: () => void }) {
  const { Field, Input, Select, Button, Banner, Switch } = ds()
  const toast = useToast()
  const plans = usePlans()
  const assign = useCompanyPlan()
  const o = company.plan_overrides
  const [planId, setPlanId] = useState(String(company.plan?.id ?? ''))
  const [own, setOwn] = useState(!!o)
  const [users, setUsers] = useState(o?.max_users == null ? '' : String(o.max_users))
  const [branches, setBranches] = useState(o?.max_branches == null ? '' : String(o.max_branches))
  const plan = (plans.data ?? []).find((p) => String(p.id) === planId)
  const planModules = plan?.modules ?? []
  // The company's own module list, kept as switches; saved as modules_on / modules_off against the plan.
  const [mods, setMods] = useState<string[]>(company.effective?.modules ?? [])
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  const newUsers = own && users.trim() ? Number(users) : plan?.max_users
  const newBranches = own && branches.trim() ? Number(branches) : plan?.max_branches
  const below = [
    newUsers != null && (company.users_used ?? 0) > newUsers ? `${company.users_used} users already (the new limit is ${newUsers})` : null,
    newBranches != null && (company.branches_used ?? 0) > newBranches ? `${company.branches_used} branches already (the new limit is ${newBranches})` : null,
  ].filter(Boolean) as string[]
  const ok = !!plan && (!own || ((users.trim() === '' || whole(users)) && (branches.trim() === '' || whole(branches))))
  async function submit() {
    if (!plan) return
    setError(null)
    const on = own ? mods.filter((m) => !planModules.includes(m)) : []
    const off = own ? planModules.filter((m) => !mods.includes(m)) : []
    const overrides = own ? { ...(users.trim() ? { max_users: Number(users) } : {}), ...(branches.trim() ? { max_branches: Number(branches) } : {}),
      ...(on.length ? { modules_on: on } : {}), ...(off.length ? { modules_off: off } : {}) } : null
    try {
      const c = await assign.mutateAsync({ id: company.id, input: { plan_id: plan.id, overrides: overrides && Object.keys(overrides).length ? overrides : null } })
      toast({ tone: 'positive', title: `${c.legal_name} is on ${c.plan?.name}`, description: 'Its Owners have been told.' })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title={`Plan for ${company.legal_name}`} description="Its Owners are told the new plan. Nothing is deleted." onClose={onClose} testId="company-plan-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={assign.isPending} disabled={!ok} onClick={() => void submit()} data-testid="company-plan-save">Save plan</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={(error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error) ?? plans.error} />
        <Field label="Plan" required htmlFor="cp-plan" error={fe('plan_id')}>
          <Select id="cp-plan" value={planId} onChange={(e) => { setPlanId(e.target.value); if (!own) setMods((plans.data ?? []).find((p) => String(p.id) === e.target.value)?.modules ?? []) }}
            options={(plans.data ?? []).filter((p) => p.is_active || String(p.id) === planId).map((p) => ({ value: String(p.id), label: `${p.name} · ${p.max_users} users · ${branchesText(p.max_branches)} branches` }))} /></Field>
        {plan && <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-muted)' }} data-testid="cp-plan-summary">{plan.name}: {modulesText(plan.modules)}.
          In use now: <span className="lf-mono">{company.users_used ?? 0}</span> users, <span className="lf-mono">{company.branches_used ?? 0}</span> branches.</p>}
        <Switch label="Give this company its own limits" checked={own} onChange={(on: boolean) => { setOwn(on); if (!on) setMods(planModules) }} />
        {own && <div style={{ display: 'grid', gap: 12 }} data-testid="cp-overrides">
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <Field label="Users" hint={`Plan: ${plan?.max_users ?? '—'}`} htmlFor="cp-users" error={fe('overrides.max_users')}>
              <Input id="cp-users" inputMode="numeric" align="right" mono value={users} placeholder={String(plan?.max_users ?? '')} onChange={(e) => setUsers(e.target.value)} /></Field>
            <Field label="Branches" hint={`Plan: ${branchesText(plan?.max_branches)}`} htmlFor="cp-branches" error={fe('overrides.max_branches')}>
              <Input id="cp-branches" inputMode="numeric" align="right" mono value={branches} placeholder={branchesText(plan?.max_branches)} onChange={(e) => setBranches(e.target.value)} /></Field>
          </div>
          <Field label="Modules for this company"><ModuleSwitches value={mods} onChange={setMods} idPrefix="cp" /></Field>
        </div>}
        {below.length > 0 && <div data-testid="cp-below"><Banner tone="warning" title="Below what the company uses now">
          {below.join('; ')}. Nobody is removed; they cannot add more until they are under the limit.</Banner></div>}
      </div>
    </ResponsiveDialog>
  )
}
