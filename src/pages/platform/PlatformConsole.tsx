import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { PlatformCompany } from '../../api/contract.gen'
import { useCompanyStatus, useCreatePlatformCompany, useLeaveOwnerAccess, useOwnerAccess, usePlatformCompanies, useSupportAccess } from '../../api/platformConsole'
import { useToast } from '../../app/toast'
import { PLATFORM_CONSOLE, startSupportView, useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { Forbidden } from '../../components/states'
import { SummaryTile } from '../../components/SummaryTile'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'

/**
 * K17 Platform console (PEP-484; API PEP-483): the owner of this Pluto installation sees every customer company — owner,
 * members, status, last activity — creates a company for a new customer (its Owner gets an e-mail invitation; the
 * admin never joins it) and suspends or reactivates one with a reason kept in that company's audit log. PEP-496: "Open
 * as Owner" joins a company as a real Owner member (reason asked; its Owners are told) and switches to it; once joined
 * the action reads "Open" and "Leave" ends the membership. The read-only "View as support" (PEP-485) stays. Only for
 * platform admins (Me.platform_admin); the API also requires a 2-step sign-in and says so (platform_two_factor_required).
 */
const STATUS = [{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]
const BUSINESS = [
  { value: 'private_limited', label: 'Private limited company' }, { value: 'sole_proprietorship', label: 'Sole proprietorship' },
  { value: 'partnership', label: 'Partnership' }, { value: 'public_limited', label: 'Public limited company' },
]
const when = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—')

export function PlatformConsole() {
  const { PageHeader, Button, IconButton, Input, Tabs, DataTable, EmptyState, Badge, Banner } = ds()
  const { can, switchCompany } = useSession()
  const { get, set, search, setSearch, page } = useListParams()
  const status = get('status', 'all')
  const q = get('q')
  const allowed = can(PLATFORM_CONSOLE)
  const list = usePlatformCompanies({ q, status: status === 'all' ? undefined : status, page }, allowed)
  const totals = {
    all: usePlatformCompanies({}, allowed).data?.meta.total,
    active: usePlatformCompanies({ status: 'active' }, allowed).data?.meta.total,
    suspended: usePlatformCompanies({ status: 'suspended' }, allowed).data?.meta.total,
  }
  const [creating, setCreating] = useState(false)
  const [changing, setChanging] = useState<{ c: PlatformCompany; action: 'suspend' | 'reactivate' } | null>(null)
  const [viewing, setViewing] = useState<PlatformCompany | null>(null)
  const [joining, setJoining] = useState<PlatformCompany | null>(null)
  const [leaving, setLeaving] = useState<PlatformCompany | null>(null)

  if (!allowed) return <Forbidden what="the platform console" />
  const twoStep = list.error instanceof ApiError && list.error.code === 'platform_two_factor_required'

  const rows = (list.data?.data ?? []).map((c) => ({ ...c, id: c.id, company: c }))
  const columns: DataColumn[] = [
    { key: 'legal_name', label: 'Company', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px', maxWidth: 200, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
        <span style={{ fontWeight: 600 }}>{r.legal_name}</span>
        {r.trading_name && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.trading_name}</span>}
      </span>) },
    { key: 'owner', label: 'Owner', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px', maxWidth: 200, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
        <span>{r.owner_name ?? r.owner_email ?? 'No owner yet'}</span>
        {r.owner_email && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.owner_pending ? `Invitation sent to ${r.owner_email}` : r.owner_email}</span>}
      </span>) },
    { key: 'members', label: 'Members', align: 'right', render: (v: number) => <span className="lf-num">{v}</span> },
    { key: 'created_at', label: 'Created', render: (v: string) => when(v) },
    { key: 'last_activity_at', label: 'Last activity', render: (v: string | null) => when(v) },
    { key: 'status', label: 'Status', render: (v: string, r) => (
      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
        <Badge tone={v === 'active' ? 'positive' : v === 'suspended' ? 'negative' : 'neutral'} dot>{v === 'active' ? 'Active' : v === 'suspended' ? 'Suspended' : 'Archived'}</Badge>
        {r.owner_pending && <Badge tone="warning">Owner not joined</Badge>}
      </span>) },
  ]
  // PEP-496: work in the company as an Owner. Joined already → "Open" switches straight to it, "Leave" ends the membership.
  const access = (r: PlatformCompany) => (r.owner_access
    ? <><Button size="sm" variant="secondary" onClick={() => void switchCompany(r.id)} data-testid={`open-${r.id}`} aria-label={`Open ${r.legal_name}`}>Open</Button>
        <Button size="sm" variant="ghost" onClick={() => setLeaving(r)} data-testid={`leave-${r.id}`} aria-label={`Leave ${r.legal_name}`}>Leave</Button></>
    : <Button size="sm" variant="secondary" onClick={() => setJoining(r)} data-testid={`owner-${r.id}`} aria-label={`Open ${r.legal_name} as Owner`}>Open as Owner</Button>)
  // Its own column, always visible (row actions only show on hover, and phone cards have none).
  const allColumns: DataColumn[] = [...columns, { key: 'access', label: 'Access', render: (_v, r) => (
    r.status === 'active' ? <span style={{ display: 'inline-flex', gap: 4, whiteSpace: 'nowrap' }}>{access(r.company as PlatformCompany)}</span> : <span style={{ color: 'var(--ink-muted)' }}>Reactivate it first</span>) }]
  const empty = q || status !== 'all'
    ? <EmptyState icon="search" title="No companies match" description="Search by company name or the owner's e-mail." action={<Button variant="secondary" onClick={() => { setSearch(''); set({ q: null, status: null }) }}>Clear filters</Button>} />
    : <EmptyState icon="building-2" title="No customer companies yet" description="Create a company for your first customer; its owner gets an e-mail invitation." action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Create company</Button>} />

  return (
    <>
      <PageHeader eyebrow="Platform" title="Platform console" description="Every company using this Pluto. Customers only ever see their own company."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)} data-testid="create-company" disabled={twoStep}>Create company</Button>} />
      {twoStep && <div data-testid="platform-two-step"><Banner tone="warning" title="Sign in with 2-step verification to use the platform console">
        {(list.error as ApiError).problem.detail} Turn it on in Settings › Security if you have not yet.</Banner></div>}
      {!twoStep && <>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <div className="lf-grid" style={{ marginBottom: 24 }} data-testid="platform-tiles">
        <SummaryTile label="Companies" value={totals.all ?? '—'} sub="On this installation" testId="tile-companies" />
        <SummaryTile label="Active" value={totals.active ?? '—'} sub="Can be opened by their people" testId="tile-active" />
        <SummaryTile label="Suspended" value={totals.suspended ?? '—'} tone={totals.suspended ? 'negative' : undefined} sub="Nobody can open them" testId="tile-suspended" />
        <SummaryTile label="Owners not joined" value={rows.filter((r) => r.owner_pending).length} sub="On this page" testId="tile-pending" />
      </div>
      <div style={{ marginBottom: 12, overflowX: 'auto' }}>
        <Tabs key={status} items={STATUS} value={status} onChange={(v) => set({ status: v === 'all' ? null : v })} />
      </div>
      <ListCard label="Companies" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns: allColumns, rows, loading: list.isPending && !twoStep, mobileColumns: ['legal_name', 'owner', 'last_activity_at', 'status', 'access'], badgeKey: 'status', empty }}
        toolbar={<div style={{ flex: '1 1 280px', maxWidth: 380 }}>
          <Input icon="search" placeholder="Search company or owner e-mail" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search companies" />
        </div>}>
        <DataTable caption="Companies" columns={allColumns} rows={rows} loading={list.isPending && !twoStep} emptyState={empty}
          rowActions={(r: PlatformCompany) => r.status === 'active'
            ? <><span data-testid={`support-${r.id}`}><IconButton icon="eye" size="sm" label={`Open ${r.legal_name} read-only`} onClick={() => setViewing(r)} /></span>
                <Button size="sm" variant="ghost" onClick={() => setChanging({ c: r, action: 'suspend' })} data-testid={`suspend-${r.id}`}>Suspend</Button></>
            : r.status === 'suspended' ? <Button size="sm" variant="secondary" onClick={() => setChanging({ c: r, action: 'reactivate' })} data-testid={`reactivate-${r.id}`}>Reactivate</Button> : null} />
      </ListCard>
      </>}
      {creating && <CreateCompanyDialog onClose={() => setCreating(false)} />}
      {viewing && <SupportDialog company={viewing} onClose={() => setViewing(null)} />}
      {joining && <OwnerDialog company={joining} onClose={() => setJoining(null)} />}
      {leaving && <LeaveDialog company={leaving} onClose={() => setLeaving(null)} />}
      {changing && <StatusDialog company={changing.c} action={changing.action} onClose={() => setChanging(null)} />}
    </>
  )
}

function CreateCompanyDialog({ onClose }: { onClose: () => void }) {
  const { Field, Input, Select, Button } = ds()
  const toast = useToast()
  const create = useCreatePlatformCompany()
  const idem = useIdempotencyKey()
  const [v, setV] = useState({ legal_name: '', trading_name: '', business_type: 'private_limited', owner_email: '', owner_name: '' })
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  const put = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  async function submit() {
    setError(null)
    try {
      const c = await create.mutateAsync({ idempotencyKey: idem.key, input: { legal_name: v.legal_name.trim(), trading_name: v.trading_name.trim() || null,
        business_type: v.business_type as 'private_limited', owner_email: v.owner_email.trim(), owner_name: v.owner_name.trim() || null } })
      idem.reset()
      toast({ tone: 'positive', title: `${c.legal_name} is ready`, description: `An invitation went to ${c.owner_email}. They become its Owner when they accept.` })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title="Create company" description="Pluto sets up the chart of accounts, financial year and number series. You are not added to the company." onClose={onClose} testId="create-company-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={create.isPending} disabled={!v.legal_name.trim() || !v.owner_email.trim()} onClick={() => void submit()} data-testid="create-company-submit">Create and invite owner</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />
        <Field label="Company name" required error={fe('legal_name')} htmlFor="pc-name"><Input id="pc-name" value={v.legal_name} onChange={put('legal_name')} invalid={!!fe('legal_name')} autoFocus /></Field>
        <Field label="Trading name" htmlFor="pc-trading"><Input id="pc-trading" value={v.trading_name} onChange={put('trading_name')} /></Field>
        <Field label="Type of business" required error={fe('business_type')} htmlFor="pc-type"><Select id="pc-type" value={v.business_type} onChange={put('business_type')} options={BUSINESS} /></Field>
        <Field label="Owner's e-mail" required hint="They get a link to set a password and join as Owner" error={fe('owner_email')} htmlFor="pc-email">
          <Input id="pc-email" type="email" value={v.owner_email} onChange={put('owner_email')} invalid={!!fe('owner_email')} /></Field>
        <Field label="Owner's name" htmlFor="pc-owner"><Input id="pc-owner" value={v.owner_name} onChange={put('owner_name')} /></Field>
      </div>
    </ResponsiveDialog>
  )
}

function StatusDialog({ company, action, onClose }: { company: PlatformCompany; action: 'suspend' | 'reactivate'; onClose: () => void }) {
  const { Field, Input, Button } = ds()
  const toast = useToast()
  const change = useCompanyStatus()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const suspend = action === 'suspend'
  async function submit() {
    setError(null)
    try {
      await change.mutateAsync({ id: company.id, action, reason: reason.trim() })
      toast({ tone: suspend ? 'warning' : 'positive', title: suspend ? `${company.legal_name} is suspended` : `${company.legal_name} is active again`,
        description: suspend ? 'Nobody can open it until you reactivate it. Its data is kept.' : 'Its people can open it again.' })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title={suspend ? `Suspend ${company.legal_name}?` : `Reactivate ${company.legal_name}?`} tone={suspend ? 'negative' : 'info'} onClose={onClose} testId="company-status-dialog"
      description={suspend ? 'Everyone in this company is locked out until you reactivate it. Nothing is deleted.' : 'Its owner and members can sign in to it again.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={suspend ? 'danger' : 'primary'} loading={change.isPending} disabled={!reason.trim()} onClick={() => void submit()} data-testid="company-status-submit">{suspend ? 'Suspend company' : 'Reactivate'}</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error} />
        <Field label="Reason" required hint="Kept in the company's audit log" htmlFor="pc-reason"><Input id="pc-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </div>
    </ResponsiveDialog>
  )
}

const DURATIONS = [{ value: '30', label: '30 minutes' }, { value: '60', label: '1 hour' }, { value: '120', label: '2 hours' }, { value: '240', label: '4 hours' }]

/** PEP-485: open the company read-only for support; its owners are told why and until when. */
function SupportDialog({ company, onClose }: { company: PlatformCompany; onClose: () => void }) {
  const { Field, Input, Select, Button } = ds()
  const open = useSupportAccess()
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState('60')
  const [error, setError] = useState<unknown>(null)
  async function submit() {
    setError(null)
    try {
      await open.mutateAsync({ id: company.id, reason: reason.trim(), minutes: Number(minutes) })
      startSupportView(company.id)
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title={`Open ${company.legal_name} read-only?`} tone="info" onClose={onClose} testId="support-dialog"
      description="You can look at everything but change nothing. Its owner gets a notification with your reason, and the visit is in its audit log."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="eye" loading={open.isPending} disabled={!reason.trim()} onClick={() => void submit()} data-testid="support-submit">Open read-only</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error} />
        <Field label="Reason" required hint="The owner sees this" htmlFor="sp-reason"><Input id="sp-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer asked why the trial balance does not tally" autoFocus /></Field>
        <Field label="For" htmlFor="sp-time"><Select id="sp-time" value={minutes} onChange={(e) => setMinutes(e.target.value)} options={DURATIONS} /></Field>
      </div>
    </ResponsiveDialog>
  )
}

/** PEP-496: join the company as an Owner to work in it; its Owners are told why, and every change is under the admin's name. */
function OwnerDialog({ company, onClose }: { company: PlatformCompany; onClose: () => void }) {
  const { Field, Input, Button, Banner } = ds()
  const { switchCompany } = useSession()
  const join = useOwnerAccess()
  const idem = useIdempotencyKey()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const fe = error instanceof ApiError ? error.fieldErrors.reason?.[0] : undefined
  async function submit() {
    setError(null)
    try {
      const joined = await join.mutateAsync({ id: company.id, input: { reason: reason.trim() }, idempotencyKey: idem.key })
      idem.reset()
      await switchCompany(joined.company_id) // starts the app again inside that company, at its dashboard
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title={`Open ${company.legal_name} as Owner?`} tone="info" onClose={onClose} testId="owner-dialog"
      description="You join this company as an Owner and can change everything in it, like its own Owner."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="arrow-right" loading={join.isPending} disabled={!reason.trim()} onClick={() => void submit()} data-testid="owner-submit">Open as Owner</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={fe ? null : error} />
        <Banner tone="info" title="The company knows">
          Its Owners get a notification with your reason, you appear in their Users list as Pluto support, and every change you make is in their audit log under your name.
        </Banner>
        <Field label="Reason" required hint="The company's Owners see this" error={fe} htmlFor="oa-reason">
          <Input id="oa-reason" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} invalid={!!fe} placeholder="e.g. Customer asked us to correct the opening balances" autoFocus /></Field>
      </div>
    </ResponsiveDialog>
  )
}

/** PEP-496: end the Owner membership; the API refuses (409 last_owner) while the admin is the company's only active Owner. */
function LeaveDialog({ company, onClose }: { company: PlatformCompany; onClose: () => void }) {
  const toast = useToast()
  const { companyId } = useSession()
  const leave = useLeaveOwnerAccess()
  const [error, setError] = useState<unknown>(null)
  async function submit() {
    setError(null)
    try {
      await leave.mutateAsync(company.id)
      if (company.id === companyId) { window.location.assign('/platform'); return } // the open company is gone: start again in another one
      toast({ tone: 'positive', title: `You left ${company.legal_name}`, description: 'It is in the company\'s audit log. You can open it as Owner again from here.' })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ConfirmDialog title={`Leave ${company.legal_name}?`} tone="warning" confirmLabel="Leave company" loading={leave.isPending} onConfirm={() => void submit()} onClose={onClose}
      description="You stop being an Owner of this company and can no longer open it. What you did there stays in its books and audit log.">
      <ProblemBanner error={error} />
    </ConfirmDialog>
  )
}
