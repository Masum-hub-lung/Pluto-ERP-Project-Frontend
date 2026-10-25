import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useParty, usePartyAction } from '../../api/parties'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { countryName } from '../../lib/countries'
import { formatTaka, initials, termLabel } from '../../lib/format'
import { PHONE, useMediaQuery } from '../../lib/useMediaQuery'
import { ActivityTimeline } from '../../components/ActivityTimeline'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'
import { PartyAccountLinks, PartyDocumentsTab, PartyOpenItems, PartyPaymentsTab } from '../partyAccounts/PartyTabs'

/** Tabs whose documents arrive with a later phase. */
const LATER: Record<string, { label: string; text: string }> = {
  notes: { label: 'Notes', text: 'Debit notes and returns appear here once purchase returns are released (phase 10).' },
}
const TABS = [{ value: 'overview', label: 'Overview' }, { value: 'bills', label: 'Bills' }, { value: 'payments', label: 'Payments' },
  ...Object.entries(LATER).map(([value, t]) => ({ value, label: t.label })), { value: 'activity', label: 'Activity' }]

/**
 * C4 Supplier details (Supp-Details.dc.html; backlog P2.2-FE-04; pattern B4): header with actions, payable KPIs,
 * Overview (with open bills and advances), Bills, Payments and Activity tabs (tab in the URL, ?tab=…), links to history,
 * ledger and statement (P6.2-FE-06). Notes say when they arrive.
 */
export function SupplierDetails() {
  const { Badge, Button, Icon, Tabs, IconButton, Menu, EmptyState } = ds()
  const phone = useMediaQuery(PHONE)
  const [more, setMore] = useState(false)
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const q = useParty(id)
  const action = usePartyAction(id)
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'overview'

  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this supplier" back="/suppliers" backLabel="Suppliers" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  const p = q.data.party
  if (p.party_type !== 'supplier') return <NotFound what="this supplier" back="/suppliers" backLabel="Suppliers" />
  const local = !p.country_code || p.country_code === 'BD'
  const place = local ? [p.area, p.district].filter(Boolean).join(', ') : countryName(p.country_code)
  const active = p.status !== 'inactive'

  async function toggle() {
    try {
      await action.mutateAsync(active ? 'deactivate' : 'reactivate')
      toast({ tone: 'positive', title: active ? `${p.name} is now inactive` : `${p.name} is active again` })
    } catch (e) {
      toast({ tone: 'negative', title: e instanceof ApiError ? e.problem.title : 'The supplier could not be changed' })
    }
  }

  const contact = [
    { icon: 'users', label: 'Contact person', value: p.contact_person },
    { icon: 'phone', label: 'Mobile', value: p.mobile, mono: true },
    { icon: 'phone', label: 'Alternate number', value: p.alt_phone, mono: true },
    { icon: 'mail', label: 'Email', value: p.email },
    { icon: 'map-pin', label: 'Address', value: [p.address, place].filter(Boolean).join(', ') },
  ].filter((c) => c.value)
  const terms = [
    { label: 'Payment terms', value: termLabel(p.payment_term?.name) },
    { label: 'Credit limit', value: p.credit_limit ? formatTaka(p.credit_limit, { symbol: true }) : 'Not set' },
    { label: 'Country', value: countryName(p.country_code || 'BD') },
    { label: 'Trading currency', value: p.default_currency_code || 'BDT' },
    ...(local ? [] : [{ label: 'Port of loading', value: p.port_of_loading || '—' }]),
    { label: 'Ledger', value: `${p.ledger_code} · Sundry creditors` },
    { label: 'Tax registration', value: p.tax_registration_no || '—' },
  ]
  const panel = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)' } as const
  const payable = p.balance_side === 'cr' || p.balance === '0.00'
  const editItem = can('parties.edit') ? [{ icon: 'pencil', label: 'Edit', onClick: () => navigate(`/suppliers/${p.id}/edit`) },
    { icon: active ? 'x' : 'check', label: active ? 'Make inactive' : 'Reactivate', onClick: () => { setMore(false); void toggle() } }] : []

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px', alignItems: 'flex-end', justifyContent: 'space-between', position: 'relative', paddingRight: phone ? 52 : 0 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', minWidth: 0 }}>
          <span style={{ width: 56, height: 56, borderRadius: 14, flex: 'none', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)', font: '600 20px/1 var(--font-sans)' }}>{initials(p.name)}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <h1 style={{ margin: 0, font: '500 28px/34px var(--font-serif)' }} data-testid="supplier-name">{p.name}</h1>
              <Badge tone={active ? 'positive' : 'neutral'} dot>{active ? 'Active' : 'Inactive'}</Badge>
              {!local && <Badge tone="info">{countryName(p.country_code)}</Badge>}
            </div>
            <span style={{ color: 'var(--ink-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
              <span className="lf-code" data-testid="supplier-code">{p.code}</span>
              {p.contact_person && <span>{p.contact_person}</span>}
              {p.mobile && <span className="lf-num">{p.mobile}</span>}
              {place && <span>{place}</span>}
            </span>
          </div>
        </div>
        {phone ? (
          <div style={{ position: 'absolute', top: 12, right: 12 }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setMore(false) }}>
            <IconButton icon="ellipsis" label="More actions" onClick={() => setMore((o) => !o)} />
            {more && (
              <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 200, zIndex: 20 }}
                items={[...editItem, { icon: 'truck', label: 'All suppliers', onClick: () => navigate('/suppliers') }]} />
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button variant="ghost" icon="arrow-left" onClick={() => navigate('/suppliers')}>All suppliers</Button>
            {can('parties.edit') && <Button variant="secondary" icon={active ? 'x' : 'check'} loading={action.isPending} onClick={() => void toggle()} data-testid="toggle-supplier">{active ? 'Make inactive' : 'Reactivate'}</Button>}
            {can('parties.edit') && <Button variant="secondary" icon="pencil" onClick={() => navigate(`/suppliers/${p.id}/edit`)} data-testid="edit-supplier">Edit</Button>}
            {can('purchases.create') && <Button variant="primary" icon="file-plus-2" onClick={() => navigate('/purchases/bills/new')}>New bill</Button>}
          </div>
        )}
      </div>

      <div className="lf-grid">
        <SummaryTile label="Payable" testId="supplier-balance" value={`${formatTaka(p.balance, { symbol: true })} ${p.balance_side === 'cr' ? 'Cr' : 'Dr'}`}
          sub={payable ? 'What you owe them today' : 'Advance paid to them'} />
        <SummaryTile label="Overdue" value={formatTaka(p.overdue, { symbol: true })} tone={p.overdue !== '0.00' ? 'negative' : undefined}
          sub="Posted bills past their due date" />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ overflowX: 'auto' }}><Tabs key={tab} items={TABS} value={tab} onChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })} /></div>
        <PartyAccountLinks type="supplier" id={p.id} />
      </div>
      {tab === 'bills' && <PartyDocumentsTab type="supplier" partyId={p.id} />}
      {tab === 'payments' && <PartyPaymentsTab type="supplier" partyId={p.id} />}

      {tab === 'activity' && (
        <section style={{ ...panel, padding: '16px 20px' }} aria-label="Activity">
          <ActivityTimeline type="party" id={p.id} />
        </section>
      )}

      {LATER[tab] && (
        <section style={panel} aria-label={LATER[tab].label} data-testid={`tab-${tab}-later`}>
          <EmptyState icon="file-text" title={`${LATER[tab].label} are not in this release yet`} description={LATER[tab].text} />
        </section>
      )}

      {tab === 'overview' && <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c12" style={{ minWidth: 0 }}><PartyOpenItems type="supplier" party={p} /></div>
        <section className="lf-c4" style={{ ...panel, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, font: '650 16px/24px var(--font-sans)' }}>Contact</h2>
          {contact.length === 0 && <span style={{ color: 'var(--ink-muted)' }}>No contact details yet.</span>}
          {contact.map((c) => (
            <div key={c.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--ink-muted)', display: 'inline-flex', paddingTop: 2 }}><Icon name={c.icon} size={16} /></span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="lf-label" style={{ fontSize: 10.5 }}>{c.label}</span>
                <span className={c.mono ? 'lf-num' : undefined}>{c.value}</span>
              </span>
            </div>
          ))}
        </section>
        <section className="lf-c4" style={{ ...panel, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, font: '650 16px/24px var(--font-sans)' }}>Terms</h2>
          {terms.map((t) => (
            <div key={t.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ color: 'var(--ink-muted)' }}>{t.label}</span>
              <span className="lf-num" style={{ fontWeight: 600, textAlign: 'right' }}>{t.value}</span>
            </div>
          ))}
        </section>
        <section className="lf-c4" style={{ ...panel, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Bank accounts">
          <h2 style={{ margin: 0, font: '650 16px/24px var(--font-sans)' }}>Bank accounts</h2>
          {(p.bank_accounts ?? []).length === 0 && <span style={{ color: 'var(--ink-muted)' }}>No bank account yet. Add one when you edit the supplier.</span>}
          {(p.bank_accounts ?? []).map((b) => (
            <div key={b.id ?? b.account_number} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ fontWeight: 600 }}>{b.bank_name}{b.branch ? ` · ${b.branch}` : ''}</span>
              <span className="lf-num">{b.account_number}</span>
              {b.account_name && <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{b.account_name}</span>}
            </div>
          ))}
          {p.notes && (<>
            <h2 style={{ margin: '8px 0 0', font: '650 16px/24px var(--font-sans)' }}>Notes</h2>
            <span style={{ whiteSpace: 'pre-wrap' }}>{p.notes}</span>
          </>)}
        </section>
      </div>}
    </>
  )
}
