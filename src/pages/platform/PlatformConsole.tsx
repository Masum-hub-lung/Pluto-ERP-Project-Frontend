import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { PlatformCompany } from '../../api/contract.gen'
import { useCompanyStatus, useCreatePlatformCompany, usePlatformCompanies } from '../../api/platformConsole'
import { useToast } from '../../app/toast'
import { PLATFORM_CONSOLE, useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
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
 * admin never joins it) and suspends or reactivates one with a reason kept in that company's audit log. Only for
 * platform admins (Me.platform_admin); the API also requires a 2-step sign-in and says so (platform_two_factor_required).
 */
const STATUS = [{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]
const BUSINESS = [
  { value: 'private_limited', label: 'Private limited company' }, { value: 'sole_proprietorship', label: 'Sole proprietorship' },
  { value: 'partnership', label: 'Partnership' }, { value: 'public_limited', label: 'Public limited company' },
]
const when = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—')

export function PlatformConsole() {
  const { PageHeader, Button, Input, Tabs, DataTable, EmptyState, Badge, Banner } = ds()
  const { can } = useSession()
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

  if (!allowed) return <Forbidden what="the platform console" />
  const twoStep = list.error instanceof ApiError && list.error.code === 'platform_two_factor_required'

  const rows = (list.data?.data ?? []).map((c) => ({ ...c, id: c.id, company: c }))
  const columns: DataColumn[] = [
    { key: 'legal_name', label: 'Company', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.legal_name}</span>
        {r.trading_name && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.trading_name}</span>}
      </span>) },
    { key: 'owner', label: 'Owner', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
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
        cards={{ columns, rows, loading: list.isPending && !twoStep, mobileColumns: ['legal_name', 'owner', 'last_activity_at', 'status'], badgeKey: 'status', empty }}
        toolbar={<div style={{ flex: '1 1 280px', maxWidth: 380 }}>
          <Input icon="search" placeholder="Search company or owner e-mail" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search companies" />
        </div>}>
        <DataTable caption="Companies" columns={columns} rows={rows} loading={list.isPending && !twoStep} emptyState={empty}
          rowActions={(r: PlatformCompany) => r.status === 'active'
            ? <Button size="sm" variant="ghost" onClick={() => setChanging({ c: r, action: 'suspend' })} data-testid={`suspend-${r.id}`}>Suspend</Button>
            : r.status === 'suspended' ? <Button size="sm" variant="secondary" onClick={() => setChanging({ c: r, action: 'reactivate' })} data-testid={`reactivate-${r.id}`}>Reactivate</Button> : null} />
      </ListCard>
      </>}
      {creating && <CreateCompanyDialog onClose={() => setCreating(false)} />}
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
