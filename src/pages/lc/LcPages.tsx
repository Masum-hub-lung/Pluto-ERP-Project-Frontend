import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { LcAmendment, LcCharge, LcDocumentTemplate, LetterOfCredit } from '../../api/contract.gen'
import {
  chargeLabel, DOC_STATUS, LC_STATUS, useLcAmendments, useLcCostSummary, useLcCharges, useLcMatrix, useLcOverview, useLcs, useLcTemplates, useSaveLcTemplate,
} from '../../api/lc'
import { useMoneyAccounts } from '../../api/money'
import { rowsOf, useReport, type ReportPath } from '../../api/reports'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../../components/ListCard'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ReportLayout } from '../../components/report/ReportLayout'
import { StatementTable } from '../../components/report/StatementTable'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { SummaryTile } from '../../components/SummaryTile'
import { WidgetError } from '../../components/WidgetError'
import { panel } from '../inventory/parts'
import { shortDate } from '../purchases/BillList'
import { DateFilter } from '../reports/filters'
import { ChargeDialog } from './LcDialogs'
import { LcStatusBadge, PayChargeDialog } from './LcDetails'

/**
 * LC module pages (backlog P16.2-FE): M1 dashboard, M2 list, M5 amendments, M6 documents (matrix and checklist templates),
 * M7 charges and cost summary, M8 reports. Every figure is the API's; links go to M4.
 */
const card = { ...panel, padding: '16px 20px' } as const
const h2 = { margin: '0 0 8px', font: '650 16px/24px var(--font-sans)' } as const

function LcNav({ current }: { current: string }) {
  const { Segmented } = ds()
  const navigate = useNavigate()
  const items = [{ value: '/lc', label: 'Overview' }, { value: '/lc/list', label: 'All LCs' }, { value: '/lc/amendments', label: 'Amendments' },
    { value: '/lc/documents', label: 'Documents' }, { value: '/lc/charges', label: 'Charges and cost' }, { value: '/lc/reports', label: 'Reports' }]
  return <div style={{ marginBottom: 16, overflowX: 'auto' }}><Segmented size="sm" value={current} options={items} onChange={(v) => navigate(v)} /></div>
}

interface OverviewRow { id: number; lc_number: string; party: string; bank: string | null; status: string; currency_code: string; amount: string; outstanding_foreign: string; expiry_date: string | null; days_to_expiry: number | null }
interface OverviewMeta {
  pipeline: Array<{ status: string; count: number }>; by_bank: Array<{ bank: string; count: number; planned_bdt: string }>
  deadlines: Array<{ lc_id: number; lc_number: string; kind: string; date: string }>; recent: Array<{ action: string; type: string; id: number; user: string | null; at: string }>
}

/** M1 LC dashboard. */
export function LcDashboard() {
  const { PageHeader, Button, DataTable, EmptyState } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const q = useLcOverview()
  const head = <PageHeader title="LC Management" description="Import letters of credit: what is open, what is due, and what the goods cost."
    actions={can('lc.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/lc/new')} data-testid="new-lc">New LC</Button> : undefined} />
  if (q.error) return <>{head}<LcNav current="/lc" /><ProblemBanner error={q.error} onRetry={() => void q.refetch()} /></>
  if (!q.data) return <PageSkeleton template="detail" />
  const t = q.data.totals as Record<string, string | number>
  const m = (q.data.meta ?? {}) as unknown as OverviewMeta
  const rows = rowsOf(q.data) as unknown as OverviewRow[]
  const alerts = [
    { key: 'expiring', n: Number(t.expiring_15), label: 'expiring within 15 days', to: '/lc/list?group=active&attention=true' },
    { key: 'documents', n: Number(t.documents_attention), label: 'documents missing or discrepant', to: '/lc/documents' },
    { key: 'charges', n: Number(t.unpaid_charges), label: 'charges not paid', to: '/lc/charges?status=unpaid' },
  ].filter((a) => a.n > 0)
  const columns: DataColumn[] = [
    { key: 'lc_number', label: 'LC', mono: true }, { key: 'party', label: 'Supplier' },
    { key: 'out', label: 'Outstanding', align: 'right', mono: true }, { key: 'expiry', label: 'Expiry' },
    { key: 'status', label: 'Status', render: (v: string) => <LcStatusBadge status={v} /> },
  ]
  return (
    <>
      {head}
      <LcNav current="/lc" />
      <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="lc-kpis">
        <SummaryTile label="Active LCs" value={String(t.active)} sub={`${t.pipeline} in the pipeline`} testId="kpi-active" />
        <SummaryTile label="Commitments" value={formatTaka(String(t.active_planned_bdt), { symbol: true })} sub="At planning rates" testId="kpi-commitments" />
        <SummaryTile label="Outstanding" value={formatTaka(String(t.outstanding_bdt), { symbol: true })} sub="Not yet paid, at planning rates" testId="kpi-outstanding" />
        <SummaryTile label="Margin held" value={formatTaka(String(t.margin_held), { symbol: true })} sub={`${formatTaka(String(t.goods_in_transit), { symbol: true })} in transit`} testId="kpi-margin" />
      </div>
      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }} data-testid="lc-alerts">
          {alerts.map((a) => <Button key={a.key} variant="secondary" size="sm" onClick={() => navigate(a.to)}>{a.n} {a.label}</Button>)}
        </div>
      )}
      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ minWidth: 0, display: 'grid', gap: 16 }}>
          <section style={{ ...panel, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px' }}><h2 style={{ ...h2, margin: 0 }}>Active LCs</h2><Link to="/lc/list">All LCs</Link></div>
            <div style={{ overflowX: 'auto' }} data-testid="lc-active">
              <DataTable caption="Active LCs" columns={columns} onRowClick={(r: OverviewRow) => navigate(`/lc/${r.id}`)}
                rows={rows.map((r) => ({ ...r, out: `${r.currency_code} ${r.outstanding_foreign}`, expiry: r.expiry_date ? `${shortDate(r.expiry_date)}${r.days_to_expiry != null ? ` · ${r.days_to_expiry} d` : ''}` : '—' }))}
                emptyState={<EmptyState icon="file-text" title="No active LCs" description="Opened LCs appear here." />} />
            </div>
          </section>
          <section style={card} aria-label="Pipeline">
            <h2 style={h2}>Pipeline</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} data-testid="lc-pipeline">
              {(m.pipeline ?? []).map((p) => <span key={p.status} style={{ ...panel, padding: '6px 12px' }}>{LC_STATUS[p.status]?.label ?? p.status} <strong>{p.count}</strong></span>)}
            </div>
          </section>
        </div>
        <aside className="lf-c4" style={{ display: 'grid', gap: 16 }}>
          <section style={card} aria-label="Next 30 days">
            <h2 style={h2}>Next 30 days</h2>
            {(m.deadlines ?? []).length === 0 ? <p style={{ margin: 0, color: 'var(--ink-muted)' }}>No deadlines.</p> : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {m.deadlines.map((d, i) => <li key={i}><Link to={`/lc/${d.lc_id}`} className="lf-code">{d.lc_number}</Link> {d.kind} · {shortDate(d.date)}</li>)}
              </ul>
            )}
          </section>
          <section style={card} aria-label="By bank">
            <h2 style={h2}>Commitments by bank</h2>
            {(m.by_bank ?? []).length === 0 ? <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Nothing open.</p> : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {m.by_bank.map((b) => <li key={b.bank} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{b.bank} ({b.count})</span><span className="lf-num">{formatTaka(b.planned_bdt, { symbol: true })}</span></li>)}
              </ul>
            )}
          </section>
          <section style={card} aria-label="Recent activity">
            <h2 style={h2}>Recent activity</h2>
            {(m.recent ?? []).length === 0 ? <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Nothing posted in this period.</p> : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6, fontSize: 14 }}>
                {m.recent.map((r, i) => <li key={i}>{r.user ?? 'System'} {r.action} {r.type.replace(/_/g, ' ').replace(/s$/, '')} · {shortDate(r.at.slice(0, 10))}</li>)}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}

const GROUPS = [{ value: 'all', label: 'All' }, { value: 'pipeline', label: 'Draft and awaiting bank' }, { value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed and expired' }]

/** M2 LC list. */
export function LcList() {
  const { PageHeader, Input, Segmented, Select, Switch, Button, DataTable, EmptyState } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const { get, set, search, setSearch, page } = useListParams()
  const banks = useMoneyAccounts({ purpose: 'payments' })
  const group = get('group', 'all')
  const list = useLcs({ q: get('q') || undefined, group: group === 'all' ? undefined : group, bank_account_id: Number(get('bank')) || undefined,
    attention: get('attention') === 'true' ? 'true' : undefined, sort: get('sort') || undefined, page, per_page: 25 })
  const filtered = !!(get('q') || group !== 'all' || get('bank') || get('attention'))
  const rows = (list.data?.data ?? []).map((l: LetterOfCredit) => ({ id: l.id, lc_number: l.lc_number, supplier: `${l.party.name} · ${l.goods_description}`, bank: l.issuing_bank?.name ?? '—',
    amount: `${l.currency_code} ${l.amount}`, outstanding: `${l.currency_code} ${l.outstanding_foreign}`, shipment: l.latest_shipment_date ? shortDate(l.latest_shipment_date) : '—',
    expiry: l.expiry_date ? shortDate(l.expiry_date) : '—', flags: (l.flags ?? []).length, status: l.status }))
  const columns: DataColumn[] = [
    { key: 'lc_number', label: 'LC', mono: true }, { key: 'supplier', label: 'Supplier and goods' }, { key: 'bank', label: 'Issuing bank' },
    { key: 'amount', label: 'Amount', align: 'right', mono: true }, { key: 'outstanding', label: 'Outstanding', align: 'right', mono: true },
    { key: 'shipment', label: 'Latest shipment' }, { key: 'expiry', label: 'Expiry' },
    { key: 'flags', label: 'Attention', render: (v: number) => (v > 0 ? `${v} to check` : '') },
    { key: 'status', label: 'Status', render: (v: string) => <LcStatusBadge status={v} /> },
  ]
  const open = (r: { id: number }) => navigate(`/lc/${r.id}`)
  return (
    <>
      <PageHeader title="Letters of credit" description="Every LC, from draft to closed."
        actions={can('lc.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/lc/new')} data-testid="new-lc">New LC</Button> : undefined} />
      <LcNav current="/lc/list" />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Letters of credit" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: open, mobileColumns: ['lc_number', 'supplier', 'outstanding', 'expiry'], badgeKey: 'status',
          empty: filtered ? <EmptyState icon="search" title="No matches" description="Try other filters." action={<Button variant="secondary" onClick={() => set({ q: null, group: null, bank: null, attention: null })}>Clear filters</Button>} />
            : <EmptyState icon="file-text" title="No letters of credit yet" description="Raise an LC to import goods from a foreign supplier." action={can('lc.create') ? <Button variant="primary" onClick={() => navigate('/lc/new')}>New LC</Button> : undefined} /> }}
        toolbar={<>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}><Input icon="search" placeholder="LC number, supplier, goods or bank ref" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" /></div>
          <Segmented key={group} options={GROUPS} value={group} onChange={(v: string) => set({ group: v === 'all' ? null : v })} />
        </>}
        filters={<>
          <div style={{ width: 220 }}><Select aria-label="Issuing bank" value={get('bank')} onChange={(e) => set({ bank: e.target.value || null })}
            options={[{ value: '', label: 'All banks' }, ...(banks.data ?? []).filter((a) => a.account_type !== 'cash').map((a) => ({ value: String(a.id), label: a.name }))]} /></div>
          <Switch label="Needs attention only" checked={get('attention') === 'true'} onChange={(c: boolean) => set({ attention: c ? 'true' : null })} />
        </>}>
        <DataTable caption="Letters of credit" columns={columns} rows={rows} loading={list.isPending} onRowClick={open} />
      </ListCard>
    </>
  )
}

/** M5 LC amendments. */
export function LcAmendments() {
  const { PageHeader, Segmented, DataTable, EmptyState, Button, Select, Field } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const { get, set, page } = useListParams()
  const status = get('status', 'all')
  const list = useLcAmendments({ status: status === 'all' ? undefined : status, page, per_page: 25 })
  const lcs = useLcs({ group: 'active', per_page: 100 })
  const [pick, setPick] = useState('')
  const numbers = new Map((lcs.data?.data ?? []).map((l) => [l.id, l.lc_number]))
  const rows = (list.data?.data ?? []).map((a: LcAmendment) => ({ ...a, lc: numbers.get(a.letter_of_credit_id) ?? `LC #${a.letter_of_credit_id}`, requested: shortDate(a.requested_on),
    fee: a.bank_fee, what: (a.changes as Array<{ field_key: string; old_value?: string | null; new_value: string }>).map((c) => `${c.field_key.replace(/_/g, ' ')}: ${c.old_value ?? '—'} → ${c.new_value}`).join('; ') }))
  return (
    <>
      <PageHeader title="LC amendments" description="Changes to opened LCs. The LC changes only when the bank's amendment is accepted." />
      <LcNav current="/lc/amendments" />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      {can('lc.edit') && (
        <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', marginBottom: 16 }}>
          <div style={{ width: 280 }}><Field label="Record an amendment for" htmlFor="am-lc">
            <Select id="am-lc" value={pick} onChange={(e) => setPick(e.target.value)} options={[{ value: '', label: 'Choose an opened LC' }, ...(lcs.data?.data ?? []).map((l) => ({ value: String(l.id), label: `${l.lc_number} · ${l.party.name}` }))]} />
          </Field></div>
          <Button variant="primary" disabled={!pick} onClick={() => navigate(`/lc/${pick}?tab=amendments&amend=1`)} data-testid="go-amend">Record amendment</Button>
        </div>
      )}
      <ListCard label="Amendments" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns: [], rows, loading: list.isPending, onOpen: (r: { letter_of_credit_id: number }) => navigate(`/lc/${r.letter_of_credit_id}?tab=amendments`), mobileColumns: ['lc', 'what', 'status'], badgeKey: 'status',
          empty: <EmptyState icon="file-pen" title="No amendments" description="Amendments recorded on an LC appear here." /> }}
        toolbar={<Segmented key={status} value={status} onChange={(v: string) => set({ status: v === 'all' ? null : v })}
          options={[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Pending' }, { value: 'accepted', label: 'Accepted' }, { value: 'refused', label: 'Refused' }]} />}>
        <DataTable caption="Amendments" rows={rows} loading={list.isPending} onRowClick={(r: { letter_of_credit_id: number }) => navigate(`/lc/${r.letter_of_credit_id}?tab=amendments`)}
          columns={[{ key: 'lc', label: 'LC', mono: true }, { key: 'amendment_no', label: 'No.' }, { key: 'requested', label: 'Requested' }, { key: 'what', label: 'Changes' },
            { key: 'fee', label: 'Bank fee (৳)', type: 'amount' }, { key: 'status', label: 'Status' }]} />
      </ListCard>
    </>
  )
}

interface MatrixRow { id: number; lc_number: string; party: string; received: number; pending: number; missing: number; discrepant: number; total: number; documents: Array<{ id: number; name: string; status: string }> }

/** M6 LC documents: status across open LCs, the follow-up list and the checklist templates (GAP-14 editor). */
export function LcDocuments() {
  const { PageHeader, Badge, Button } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const q = useLcMatrix()
  const templates = useLcTemplates()
  const [edit, setEdit] = useState<LcDocumentTemplate | 'new' | null>(null)
  const head = <><PageHeader title="LC documents" description="Which documents are in, pending or missing across open LCs." /><LcNav current="/lc/documents" /></>
  if (q.error) return <>{head}<ProblemBanner error={q.error} onRetry={() => void q.refetch()} /></>
  if (!q.data) return <PageSkeleton template="report" />
  const rows = rowsOf(q.data) as unknown as MatrixRow[]
  const t = q.data.totals as Record<string, number>
  const follow = ((q.data.meta ?? {}) as { follow_up?: Array<{ id: number; name: string; status: string; due_date: string | null; lc_number: string; lc_id: number }> }).follow_up ?? []
  return (
    <>
      {head}
      <div className="lf-grid" style={{ marginBottom: 16 }}>
        <SummaryTile label="Open LCs" value={String(t.lcs)} testId="docs-lcs" />
        <SummaryTile label="Need follow-up" value={String(t.follow_up)} testId="docs-follow" />
      </div>
      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ minWidth: 0 }}>
          <section style={{ ...panel, overflow: 'hidden' }} aria-label="Document status">
            <div style={{ padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(DOC_STATUS).map(([k, s]) => <Badge key={k} tone={s.tone}>{s.label}</Badge>)}
            </div>
            {rows.length === 0 ? <p style={{ padding: 16, margin: 0, color: 'var(--ink-muted)' }}>No opened LCs with documents.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="docs-matrix">
                {rows.map((r) => (
                  <li key={r.id} style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
                    <button type="button" onClick={() => navigate(`/lc/${r.id}?tab=documents`)} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
                      <strong className="lf-code">{r.lc_number}</strong> {r.party} <span style={{ color: 'var(--ink-muted)' }}>· {r.received}/{r.total} in</span>
                    </button>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {r.documents.map((d) => <Badge key={d.id} tone={DOC_STATUS[d.status]?.tone ?? 'neutral'}>{d.name}</Badge>)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="lf-c4" style={{ display: 'grid', gap: 16 }}>
          <section style={card} aria-label="Needs follow-up">
            <h2 style={h2}>Needs follow-up</h2>
            {follow.length === 0 ? <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Nothing overdue.</p> : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }} data-testid="docs-follow-list">
                {follow.map((d) => <li key={d.id}><Link to={`/lc/${d.lc_id}?tab=documents`} className="lf-code">{d.lc_number}</Link> {d.name} · {DOC_STATUS[d.status]?.label ?? d.status}</li>)}
              </ul>
            )}
          </section>
          <section style={card} aria-label="Checklist templates">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ ...h2, margin: 0 }}>Checklist templates</h2>
              {can('lc.create') && <Button size="sm" variant="secondary" icon="plus" onClick={() => setEdit('new')} data-testid="new-template">New</Button>}</div>
            <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }} data-testid="templates">
              {(templates.data ?? []).length === 0 && <li style={{ color: 'var(--ink-muted)' }}>No templates yet.</li>}
              {(templates.data ?? []).map((tp) => (
                <li key={tp.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{tp.name} {tp.is_default && <Badge tone="info">Default</Badge>} <span style={{ color: 'var(--ink-muted)' }}>· {tp.items.length} documents</span></span>
                  {can('lc.edit') && <Button size="sm" variant="ghost" onClick={() => setEdit(tp)}>Edit</Button>}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      {edit && <TemplateDialog template={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function TemplateDialog({ template, onClose }: { template: LcDocumentTemplate | null; onClose: () => void }) {
  const { Field, Input, Button, Switch, IconButton } = ds()
  const toast = useToast()
  const save = useSaveLcTemplate()
  const [name, setName] = useState(template?.name ?? '')
  const [isDefault, setIsDefault] = useState(template?.is_default ?? false)
  const [items, setItems] = useState<Array<{ name: string; provided_by: string; copies: string }>>(
    (template?.items as Array<{ name: string; provided_by: string; copies?: number }> | undefined)?.map((i) => ({ name: i.name, provided_by: i.provided_by, copies: String(i.copies ?? 1) }))
      ?? [{ name: 'Bill of lading', provided_by: 'Supplier', copies: '3' }])
  const [error, setError] = useState<unknown>(null)
  const go = async () => {
    setError(null)
    try {
      const t = await save.mutateAsync({ id: template?.id, input: { name: name.trim(), is_default: isDefault,
        items: items.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), provided_by: i.provided_by.trim() || 'Supplier', copies: Number(i.copies) || 1 })) } })
      toast({ tone: 'positive', title: `Template ${t.name} saved` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  const setItem = (i: number, k: 'name' | 'provided_by' | 'copies', v: string) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  return (
    <ResponsiveDialog title={template ? `Edit ${template.name}` : 'New checklist template'} onClose={onClose} testId="template-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => void go()} data-testid="save-template">Save template</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error} />
        <Field label="Name" htmlFor="tpl-name" required><Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Switch label="Default for new LCs" checked={isDefault} onChange={(c: boolean) => setIsDefault(c)} />
        {items.map((it, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr) 70px 44px', gap: 8, alignItems: 'end' }}>
            <Input aria-label={`Document ${i + 1}`} value={it.name} onChange={(e) => setItem(i, 'name', e.target.value)} placeholder="Document" />
            <Input aria-label={`Provided by ${i + 1}`} value={it.provided_by} onChange={(e) => setItem(i, 'provided_by', e.target.value)} placeholder="Provided by" />
            <Input aria-label={`Copies ${i + 1}`} inputMode="numeric" value={it.copies} onChange={(e) => setItem(i, 'copies', e.target.value.replace(/\D/g, ''))} />
            <IconButton icon="trash-2" label={`Remove document ${i + 1}`} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} />
          </div>
        ))}
        <div><Button size="sm" variant="secondary" icon="plus" onClick={() => setItems((xs) => [...xs, { name: '', provided_by: 'Supplier', copies: '1' }])}>Add document</Button></div>
      </div>
    </ResponsiveDialog>
  )
}

/** M7 charges and cost summary. */
export function LcCharges() {
  const { PageHeader, Segmented, Select, DataTable, EmptyState, Button, Badge, Field } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const { get, set, page } = useListParams()
  const lcs = useLcs({ per_page: 100 })
  const lcId = Number(get('lc')) || 0
  const status = get('status', 'all')
  const list = useLcCharges({ letter_of_credit_id: lcId || undefined, status: status === 'all' ? undefined : status, page, per_page: 25 })
  const [adding, setAdding] = useState(false)
  const [paying, setPaying] = useState<LcCharge | null>(null)
  const rows = (list.data?.data ?? []).map((c) => ({ ...c, type: chargeLabel(c.charge_type), date: shortDate(c.charge_date), amt: c.amount,
    where: c.is_refundable ? 'Margin' : c.tax_rule_id ? 'Recoverable tax' : c.include_in_landed_cost ? (c.allocated ? 'In the goods' : 'Goods in transit') : 'Expense' }))
  return (
    <>
      <PageHeader title="Charges and cost" description="Bank charges, insurance, C&F, duties — and what each import's goods cost in the end."
        actions={can('lc.create') ? <Button variant="primary" icon="plus" onClick={() => setAdding(true)} data-testid="add-charge">Add charge</Button> : undefined} />
      <LcNav current="/lc/charges" />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Charges" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns: [], rows, loading: list.isPending, onOpen: (r: LcCharge) => navigate(`/lc/${r.letter_of_credit_id}?tab=money`), mobileColumns: ['lc_number', 'type', 'amt', 'status'], badgeKey: 'status',
          empty: <EmptyState icon="receipt" title="No charges" description="Charges recorded on LCs appear here." /> }}
        toolbar={<>
          <div style={{ width: 240 }}><Select aria-label="LC" value={lcId ? String(lcId) : ''} onChange={(e) => set({ lc: e.target.value || null })}
            options={[{ value: '', label: 'All LCs' }, ...(lcs.data?.data ?? []).map((l) => ({ value: String(l.id), label: `${l.lc_number} · ${l.party.name}` }))]} /></div>
          <Segmented key={status} value={status} onChange={(v: string) => set({ status: v === 'all' ? null : v })} options={[{ value: 'all', label: 'All' }, { value: 'unpaid', label: 'Not paid' }, { value: 'paid', label: 'Paid' }]} />
        </>}>
        <DataTable caption="Charges" rows={rows} loading={list.isPending} onRowClick={(r: LcCharge) => navigate(`/lc/${r.letter_of_credit_id}?tab=money`)}
          columns={[{ key: 'date', label: 'Date' }, { key: 'lc_number', label: 'LC', mono: true }, { key: 'type', label: 'Charge' }, { key: 'paid_to', label: 'Paid to' },
            { key: 'amt', label: 'Amount (৳)', type: 'amount' }, { key: 'where', label: 'Booked to' },
            { key: 'status', label: 'Paid', render: (v: string) => <Badge tone={v === 'paid' ? 'positive' : 'warning'}>{v === 'paid' ? 'Paid' : 'Not paid'}</Badge> }]}
          rowActions={(r: LcCharge) => r.status === 'unpaid' && r.posting_status !== 'reversed' && can('lc.create') ? <Button size="sm" variant="secondary" onClick={() => setPaying(r)}>Pay</Button> : null} />
      </ListCard>
      <div style={{ height: 16 }} />
      <section style={card} aria-label="Cost summary">
        <h2 style={h2}>Landed cost of an LC</h2>
        <div style={{ width: 280 }}><Field label="LC" htmlFor="cost-lc">
          <Select id="cost-lc" value={lcId ? String(lcId) : ''} onChange={(e) => set({ lc: e.target.value || null })}
            options={[{ value: '', label: 'Choose an LC' }, ...(lcs.data?.data ?? []).map((l) => ({ value: String(l.id), label: l.lc_number }))]} />
        </Field></div>
        {lcId > 0 && <CostCard lcId={lcId} />}
        <p style={{ margin: '12px 0 0', color: 'var(--ink-muted)', fontSize: 13 }}>Duties and taxes are entered as assessed by customs; Pluto does not calculate them.</p>
      </section>
      {adding && <ChargeDialog onClose={() => setAdding(false)} />}
      {paying && <PayChargeDialog charge={paying} onClose={() => setPaying(null)} />}
    </>
  )
}

function CostCard({ lcId }: { lcId: number }) {
  const { Button } = ds()
  const navigate = useNavigate()
  const q = useLcCostSummary(lcId)
  if (q.error) return <WidgetError title="Could not load the cost summary" onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="report" />
  const t = q.data.totals as Record<string, string | null>
  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
      <p style={{ margin: 0 }} data-testid="m7-landed">Landed cost {formatTaka(t.landed_cost ?? '0.00', { symbol: true })}{t.per_unit ? ` · ${formatTaka(t.per_unit, { symbol: true })} a unit` : ''}</p>
      <StatementTable report={q.data} testId="m7-cost-table" />
      <div><Button variant="secondary" onClick={() => navigate(`/lc/${lcId}?tab=cost`)}>Open the LC's cost tab to allocate</Button></div>
    </div>
  )
}

const REPORTS: Array<{ key: string; label: string; description: string }> = [
  { key: 'register', label: 'Register', description: 'Every LC raised in the period' },
  { key: 'status', label: 'Active and expired', description: 'LCs by status' },
  { key: 'outstanding', label: 'Outstanding', description: 'What is still to be paid on open LCs' },
  { key: 'expiry', label: 'Upcoming expiry', description: 'Open LCs by expiry date' },
  { key: 'documents', label: 'Documents', description: 'Document completion per LC' },
  { key: 'amendments', label: 'Amendments', description: 'Amendment history' },
  { key: 'charges', label: 'Charges and payments', description: 'Every charge and payment' },
  { key: 'cost', label: 'Import cost', description: 'Landed cost per LC' },
]

/** M8 LC reports: eight tabs on the shared report layout (Print, Export). */
export function LcReports() {
  const { Tabs, Select, Field } = ds()
  const navigate = useNavigate()
  const report = useParams().report ?? 'register'
  const { get, set } = useListParams()
  const banks = useMoneyAccounts({ purpose: 'payments' })
  const def = REPORTS.find((r) => r.key === report) ?? REPORTS[0]!
  const query = { date_from: get('date_from') || undefined, date_to: get('date_to') || undefined, bank_account_id: get('bank') || undefined, segment: report === 'status' ? get('segment') || undefined : undefined }
  const r = useReport(`lc/${def.key}` as ReportPath, query)
  return (
    <>
      <LcNav current="/lc/reports" />
      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <Tabs value={def.key} onChange={(k: string) => navigate(`/lc/reports/${k}${window.location.search}`)} items={REPORTS.map((x) => ({ value: x.key, label: x.label }))} />
      </div>
      <ReportLayout title={`LC ${def.label.toLowerCase()}`} description={def.description} path={`lc/${def.key}` as ReportPath} query={query} report={r.data} loading={r.isPending}
        error={r.error} onRetry={() => void r.refetch()}
        filters={<>
          <DateFilter id="lc-from" label="From" value={get('date_from')} onChange={(v) => set({ date_from: v || null })} />
          <DateFilter id="lc-to" label="To" value={get('date_to')} onChange={(v) => set({ date_to: v || null })} />
          <div style={{ width: 200 }}><Field label="Bank" htmlFor="lc-rpt-bank"><Select id="lc-rpt-bank" value={get('bank')} onChange={(e) => set({ bank: e.target.value || null })}
            options={[{ value: '', label: 'All banks' }, ...(banks.data ?? []).filter((a) => a.account_type !== 'cash').map((a) => ({ value: String(a.id), label: a.name }))]} /></Field></div>
          {report === 'status' && <div style={{ width: 180 }}><Field label="Segment" htmlFor="lc-seg"><Select id="lc-seg" value={get('segment')} onChange={(e) => set({ segment: e.target.value || null })}
            options={[{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'expired', label: 'Expired' }, { value: 'closed', label: 'Closed' }]} /></Field></div>}
        </>}>
        {r.data && <StatementTable report={r.data} onOpen={(row) => { if (typeof row.url === 'string') navigate(row.url) }} testId={`lc-report-${def.key}`} />}
      </ReportLayout>
    </>
  )
}
