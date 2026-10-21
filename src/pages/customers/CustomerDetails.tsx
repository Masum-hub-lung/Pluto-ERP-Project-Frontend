import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useCustomer } from '../../api/parties'
import { useSession } from '../../auth/session'
import { lf } from '../../ds'
import { formatTaka, initials, termLabel } from '../../lib/format'
import { ActivityTimeline } from '../../components/ActivityTimeline'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'

/**
 * B4 Customer details (Parties.dc.html party header + details): Overview and Activity tabs (tab in the URL,
 * ?tab=activity). The Transactions, Ledger and Statement tabs need posted documents, which arrive with the sales
 * slice; they are not shown yet.
 */
export function CustomerDetails() {
  const { Badge, Button, Icon, Tabs } = lf()
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { can } = useSession()
  const q = useCustomer(id)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'activity' ? 'activity' : 'overview'

  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this customer" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  const p = q.data.party
  if (p.party_type !== 'customer') return <NotFound what="this customer" />
  const place = [p.area, p.district].filter(Boolean).join(', ')
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
    { label: 'Price list', value: p.price_tier === 'wholesale' ? 'Wholesale' : 'Standard' },
    { label: 'Ledger', value: `${p.ledger_code} · Sundry debtors` },
    { label: 'Tax registration', value: p.tax_registration_no || '—' },
  ]
  const panel = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)' } as const

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', minWidth: 0 }}>
          <span style={{ width: 56, height: 56, borderRadius: 14, flex: 'none', display: 'grid', placeItems: 'center', background: 'var(--brand-soft)', color: 'var(--brand-ink)', font: '600 20px/1 var(--font-sans)' }}>{initials(p.name)}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <h1 style={{ margin: 0, font: '500 28px/34px var(--font-serif)' }} data-testid="customer-name">{p.name}</h1>
              <Badge tone={p.status === 'active' ? 'positive' : 'neutral'} dot>{p.status === 'active' ? 'Active' : p.status === 'inactive' ? 'Inactive' : 'Prospect'}</Badge>
            </div>
            <span style={{ color: 'var(--ink-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
              <span className="lf-code" data-testid="customer-code">{p.code}</span>
              {p.contact_person && <span>{p.contact_person}</span>}
              {p.mobile && <span className="lf-num">{p.mobile}</span>}
              {place && <span>{place}</span>}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="ghost" icon="arrow-left" onClick={() => navigate('/customers')}>All customers</Button>
          {can('parties.edit') && <Button variant="secondary" icon="pencil" onClick={() => navigate(`/customers/${p.id}/edit`)} data-testid="edit-customer">Edit</Button>}
        </div>
      </div>

      <div className="lf-grid">
        <SummaryTile label="Balance" testId="customer-balance" value={`${formatTaka(p.balance, { symbol: true })} ${p.balance_side === 'cr' ? 'Cr' : 'Dr'}`}
          sub={p.balance_side === 'cr' && p.balance !== '0.00' ? 'Advance received' : 'Receivable today'} />
        <SummaryTile label="Overdue" value={formatTaka(p.overdue, { symbol: true })} tone={p.overdue !== '0.00' ? 'negative' : undefined}
          sub="Posted invoices past their due date" />
      </div>

      <Tabs items={[{ value: 'overview', label: 'Overview' }, { value: 'activity', label: 'Activity' }]} value={tab}
        onChange={(v) => setParams(v === 'activity' ? { tab: 'activity' } : {}, { replace: true })} />

      {tab === 'activity' && (
        <section style={{ ...panel, padding: '16px 20px' }} aria-label="Activity">
          <ActivityTimeline type="party" id={p.id} />
        </section>
      )}

      {tab === 'overview' && <div className="lf-grid" style={{ alignItems: 'start' }}>
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
        {p.notes && (
          <section className="lf-c4" style={{ ...panel, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ margin: 0, font: '650 16px/24px var(--font-sans)' }}>Notes</h2>
            <span style={{ whiteSpace: 'pre-wrap' }}>{p.notes}</span>
          </section>
        )}
      </div>}
    </>
  )
}
