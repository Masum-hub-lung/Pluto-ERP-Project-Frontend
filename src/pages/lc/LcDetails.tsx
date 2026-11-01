import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { LcCharge, LcDocument, LcPayment, LcShipment, LcTransition, LetterOfCredit } from '../../api/contract.gen'
import {
  chargeLabel, DOC_STATUS, fetchLcPdf, LC_STATUS, lcActions, lcEditable, lcLive, PAYMENT_KIND, SHIPMENT_STATUS, useAmendmentStatus, useLc, useLcCostSummary, usePayCharge,
  useReverseLcItem, useUpdateLcDocument, type Reversible,
} from '../../api/lc'
import { useMoneyAccounts } from '../../api/money'
import { dhakaToday } from '../../api/platform'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ActivityTimeline } from '../../components/ActivityTimeline'
import { AttachmentUploader } from '../../components/AttachmentUploader'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { StatementTable } from '../../components/report/StatementTable'
import { NotFound } from '../../components/states'
import { SummaryTile } from '../../components/SummaryTile'
import { ReasonDialog } from '../../components/trade/TradeParts'
import { DetailHeader, panel, type HeaderAction } from '../inventory/parts'
import { shortDate } from '../purchases/BillList'
import { AmendmentDialog, ChargeDialog, CloseDialog, DocumentDialog, LandedCostDialog, PayDialog, ShipmentDialog, TransitionDialog } from './LcDialogs'

/**
 * M4 LC details (LC-Details.dc.html + variants; backlog P16.2-FE): status and flags, milestones, the money strip and tabs
 * Overview, Terms, Documents, Shipment, Charges and payments, Amendments, Cost, Activity. Every amount is the API's.
 */
const TABS = ['overview', 'terms', 'documents', 'shipments', 'money', 'amendments', 'cost', 'activity'] as const
type Tab = typeof TABS[number]
type Dialog = null | 'charge' | 'pay' | 'close' | 'landed' | 'amend' | 'lot' | 'doc' | { transition: LcTransition['action']; label: string } | { lot: LcShipment }
  | { reverse: Reversible; id: number; what: string } | { payCharge: LcCharge }

export function LcStatusBadge({ status }: { status: string }) {
  const { Badge } = ds()
  const s = LC_STATUS[status] ?? { label: status, tone: 'neutral' as const }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

export function LcDetails() {
  const { Tabs, Badge, Banner, Button } = ds()
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? params.get('tab') as Tab : 'overview'
  const q = useLc(id)
  const [dialog, setDialog] = useState<Dialog>(() => (params.get('amend') === '1' ? 'amend' : null))
  const [pdfError, setPdfError] = useState<unknown>(null)
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this LC" back="/lc/list" backLabel="Letters of credit" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  const lc = q.data
  const pos = (lc.money_position ?? {}) as Record<string, string>
  const live = lcLive(lc.status)
  const open = live || lc.status === 'expired'

  const print = async () => {
    setPdfError(null)
    const w = window.open('', '_blank')
    try {
      const url = URL.createObjectURL(await fetchLcPdf(lc.id))
      if (w) w.location.href = url; else window.location.href = url
    } catch (e) {
      w?.close(); setPdfError(e)
    }
  }

  const actions: HeaderAction[] = [
    ...(lcEditable(lc.status) && can('lc.edit') ? [{ label: 'Edit', icon: 'pencil', onClick: () => navigate(`/lc/${lc.id}/edit`), testId: 'lc-edit' }] : []),
    ...(can('lc.edit') ? lcActions(lc.status).map((a) => ({ label: a.label, icon: a.danger ? 'circle-x' : 'arrow-right', onClick: () => setDialog({ transition: a.action, label: a.label }),
      primary: !a.danger, testId: `lc-action-${a.action}` })) : []),
    ...(live && can('lc.create') ? [{ label: 'Record payment', icon: 'banknote', onClick: () => setDialog('pay'), testId: 'lc-record-payment' }] : []),
    ...(open && can('lc.create') ? [{ label: 'Add charge', icon: 'plus', onClick: () => setDialog('charge'), testId: 'lc-add-charge' }] : []),
    ...(open && can('purchases.create') ? [{ label: 'Receive goods', icon: 'package-plus', onClick: () => navigate(`/purchases/bills/new?lc=${lc.id}`), testId: 'lc-receive' }] : []),
    ...(open && can('lc.edit') ? [{ label: 'Close LC', icon: 'lock', onClick: () => setDialog('close'), testId: 'lc-close' }] : []),
    { label: 'Print', icon: 'printer', onClick: () => void print(), testId: 'lc-print' },
  ]

  return (
    <>
      <DetailHeader title={lc.lc_number} testId="lc-title" badges={<><LcStatusBadge status={lc.status} />{lc.tenor === 'usance' && <Badge tone="info">Usance {lc.usance_days} days</Badge>}</>}
        facts={<><span>{lc.party.name}</span><span>{lc.goods_description}</span>{lc.issuing_bank && <span>{lc.issuing_bank.name}</span>}{lc.bank_reference && <span className="lf-code">{lc.bank_reference}</span>}</>}
        actions={actions} />
      <ProblemBanner error={pdfError} />
      {(lc.flags ?? []).map((f, i) => (
        <div key={i} style={{ marginBottom: 8 }} data-testid={`lc-flag-${f.code}`}><Banner tone="warning">{f.message}</Banner></div>
      ))}
      <ol style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 8, padding: 0, margin: '0 0 16px' }} aria-label="Milestones" data-testid="lc-milestones">
        {(lc.milestones as Array<{ key: string; label: string; date: string | null; done: boolean }>).map((m) => (
          <li key={m.key} data-done={m.done ? 'true' : 'false'} style={{ ...panel, padding: '6px 12px', fontSize: 13, opacity: m.done ? 1 : 0.6 }}>
            {m.done ? '✓ ' : ''}{m.label}{m.date ? ` · ${shortDate(m.date)}` : ''}
          </li>
        ))}
      </ol>
      <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="lc-strip">
        <SummaryTile label={`Amount (${lc.currency_code})`} value={lc.amount} sub={`≈ ${formatTaka(lc.amount_bdt_planned, { symbol: true })} at ${lc.planning_rate}`} testId="lc-amount" />
        <SummaryTile label={`Outstanding (${lc.currency_code})`} value={lc.outstanding_foreign} sub={`Paid ${lc.paid_foreign}`} testId="lc-outstanding" />
        <SummaryTile label="Expiry" value={lc.expiry_date ? shortDate(lc.expiry_date) : '—'} sub={lc.days_to_expiry != null ? `${lc.days_to_expiry} days` : undefined} testId="lc-expiry" />
        <SummaryTile label="Margin held" value={formatTaka(pos.margin_held ?? '0.00', { symbol: true })} sub={`${lc.margin_pct.replace(/\.?0+$/, '')} % · ${formatTaka(lc.margin_amount, { symbol: true })}`} testId="lc-margin" />
      </div>
      <Tabs value={tab} onChange={(t: string) => setParams((p) => { p.set('tab', t); return p }, { replace: true })} items={[
        { value: 'overview', label: 'Overview' }, { value: 'terms', label: 'Terms' }, { value: 'documents', label: 'Documents', count: lc.documents?.length },
        { value: 'shipments', label: 'Shipment', count: lc.shipments?.length }, { value: 'money', label: 'Charges and payments' },
        { value: 'amendments', label: 'Amendments', count: lc.amendments?.length }, { value: 'cost', label: 'Cost' }, { value: 'activity', label: 'Activity' },
      ]} />
      <div style={{ marginTop: 16 }} data-testid={`lc-tab-${tab}`}>
        {tab === 'overview' && <Overview lc={lc} pos={pos} />}
        {tab === 'terms' && <Terms lc={lc} />}
        {tab === 'documents' && <Documents lc={lc} onAdd={() => setDialog('doc')} />}
        {tab === 'shipments' && <Shipments lc={lc} onAdd={() => setDialog('lot')} onOpen={(lot) => setDialog({ lot })} />}
        {tab === 'money' && <Money lc={lc} onReverse={(reverse, rid, what) => setDialog({ reverse, id: rid, what })} onPayCharge={(c) => setDialog({ payCharge: c })} />}
        {tab === 'amendments' && <Amendments lc={lc} onAdd={() => setDialog('amend')} />}
        {tab === 'cost' && <Cost lc={lc} onAllocate={() => setDialog('landed')} onReverse={(rid) => setDialog({ reverse: 'landed-cost-allocations', id: rid, what: 'this allocation' })} />}
        {tab === 'activity' && <ActivityTimeline type="letter_of_credit" id={lc.id} />}
      </div>
      {tab === 'overview' && can('lc.view') && (
        <div style={{ marginTop: 16 }}><AttachmentUploader type="letter_of_credit" recordId={lc.id} canEdit={can('lc.edit')} /></div>
      )}
      {lc.status === 'closed' && <p style={{ color: 'var(--ink-muted)' }}>Closed LCs are read-only.</p>}

      {dialog === 'charge' && <ChargeDialog lc={lc} onClose={() => setDialog(null)} />}
      {dialog === 'pay' && <PayDialog lc={lc} onClose={() => setDialog(null)} />}
      {dialog === 'close' && <CloseDialog lc={lc} onClose={() => setDialog(null)} />}
      {dialog === 'landed' && <LandedCostDialog lc={lc} onClose={() => setDialog(null)} />}
      {dialog === 'amend' && <AmendmentDialog lc={lc} onClose={() => { setDialog(null); if (params.has('amend')) setParams((p) => { p.delete('amend'); return p }, { replace: true }) }} />}
      {dialog === 'lot' && <ShipmentDialog lc={lc} onClose={() => setDialog(null)} />}
      {dialog === 'doc' && <DocumentDialog lc={lc} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'lot' in dialog && <ShipmentDialog lc={lc} lot={dialog.lot} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'transition' in dialog && <TransitionDialog lc={lc} action={dialog.transition} label={dialog.label} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'reverse' in dialog && <ReverseDialog kind={dialog.reverse} id={dialog.id} what={dialog.what} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'payCharge' in dialog && <PayChargeDialog charge={dialog.payCharge} onClose={() => setDialog(null)} />}
      {lc.status === 'draft' && can('lc.edit') && tab === 'overview' && (
        <p style={{ marginTop: 12 }}><Button variant="secondary" onClick={() => navigate(`/lc/${lc.id}/edit`)}>Continue the draft</Button></p>
      )}
    </>
  )
}

function Facts({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, max-content) 1fr', gap: '8px 16px', margin: 0 }}>
      {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt style={{ color: 'var(--ink-muted)' }}>{k}</dt><dd style={{ margin: 0 }}>{v ?? '—'}</dd></div>)}
    </dl>
  )
}

function Overview({ lc, pos }: { lc: LetterOfCredit; pos: Record<string, string> }) {
  const { Card } = ds()
  const t = (v: string | undefined) => formatTaka(v ?? '0.00', { symbol: true })
  return (
    <div className="lf-grid" style={{ alignItems: 'start' }}>
      <div className="lf-c6"><Card title="Money position">
        <Facts rows={[
          [`Paid (${lc.currency_code})`, pos.paid_foreign], ['Paid (৳)', t(pos.paid_bdt)], ['Margin held', t(pos.margin_held)], ['Charges', t(pos.charges_total)],
          ['Charges not paid', t(pos.charges_unpaid)], ['Goods in transit', t(pos.goods_in_transit)], ['Allocated to goods', t(pos.landed_cost_allocated)],
          ['Accepted, not settled', t(pos.acceptance_outstanding)], ['Exchange difference', t(pos.fx_total)],
        ]} />
      </Card></div>
      <div className="lf-c6"><Card title="Key dates">
        <Facts rows={[['Opened', lc.opened_on ? shortDate(lc.opened_on) : null], ['Latest shipment', lc.latest_shipment_date ? shortDate(lc.latest_shipment_date) : null],
          ['Expiry', lc.expiry_date ? shortDate(lc.expiry_date) : null], ['Maturity', lc.maturity_date ? shortDate(lc.maturity_date) : null],
          ['Created', `${shortDate(lc.created_at.slice(0, 10))}${lc.created_by ? ` by ${lc.created_by.name}` : ''}`]]} />
      </Card></div>
    </div>
  )
}

function Terms({ lc }: { lc: LetterOfCredit }) {
  const { Card } = ds()
  return (
    <Card title="Terms">
      <Facts rows={[['Supplier', <Link key="p" to={`/suppliers/${lc.party.id}`}>{lc.party.name}</Link>], ['Goods', lc.goods_description], ['Currency', lc.currency_code],
        ['Amount', `${lc.currency_code} ${lc.amount}`], ['Tolerance', `${lc.tolerance_pct.replace(/\.?0+$/, '')} %`], ['Planning rate', lc.planning_rate],
        ['Planned taka', formatTaka(lc.amount_bdt_planned, { symbol: true })], ['Tenor', lc.tenor === 'usance' ? `Usance, ${lc.usance_days} days` : 'At sight'],
        ['Incoterm', lc.incoterm], ['Issuing bank', lc.issuing_bank?.name], ['Bank reference', lc.bank_reference], ['Opening status', lc.opening_status.replace(/_/g, ' ')],
        ['Margin', `${lc.margin_pct.replace(/\.?0+$/, '')} % · ${formatTaka(lc.margin_amount, { symbol: true })}`]]} />
    </Card>
  )
}

function Documents({ lc, onAdd }: { lc: LetterOfCredit; onAdd: () => void }) {
  const { Card, Button, Select, EmptyState } = ds()
  const { can } = useSession()
  const toast = useToast()
  const upd = useUpdateLcDocument()
  const [error, setError] = useState<unknown>(null)
  const [scan, setScan] = useState<LcDocument | null>(null)
  const editable = can('lc.edit') && !['closed', 'cancelled'].includes(lc.status)
  const docs = lc.documents ?? []
  const change = async (d: LcDocument, status: string) => {
    setError(null)
    try {
      await upd.mutateAsync({ id: d.id, version: d.version, input: { status: status as never, ...(status === 'received' ? { received_date: dhakaToday() } : {}) } })
      toast({ tone: 'positive', title: `${d.name}: ${DOC_STATUS[status]?.label ?? status}` })
    } catch (e) {
      setError(e)
    }
  }
  return (
    <Card title="Required documents" padding="none" actions={editable ? <Button size="sm" variant="secondary" icon="plus" onClick={onAdd} data-testid="lc-add-doc">Add document</Button> : undefined}>
      <ProblemBanner error={error} />
      {docs.length === 0 && <EmptyState icon="file-text" title="No documents listed" description="Add the documents the bank must receive." />}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="lc-docs">
        {docs.map((d) => (
          <li key={d.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderTop: '1px solid var(--line)' }} data-testid={`lc-doc-${d.id}`}>
            <span><strong>{d.name}</strong><br /><span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{d.provided_by} · {d.copies} {d.copies === 1 ? 'copy' : 'copies'}{d.received_date ? ` · received ${shortDate(d.received_date)}` : ''}</span></span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {editable ? (
                <div style={{ width: 170 }}><Select aria-label={`Status of ${d.name}`} value={d.status} onChange={(e) => void change(d, e.target.value)}
                  options={Object.entries(DOC_STATUS).map(([value, s]) => ({ value, label: s.label }))} /></div>
              ) : <span>{DOC_STATUS[d.status]?.label ?? d.status}</span>}
              <Button size="sm" variant="ghost" icon="paperclip" onClick={() => setScan(d)}>Scans{d.attachments?.length ? ` (${d.attachments.length})` : ''}</Button>
            </span>
          </li>
        ))}
      </ul>
      {scan && (
        <ResponsiveDialog title={`Scans — ${scan.name}`} onClose={() => setScan(null)} testId="lc-doc-scans">
          <AttachmentUploader type="lc_document" recordId={scan.id} canEdit={editable} />
        </ResponsiveDialog>
      )}
    </Card>
  )
}

function Shipments({ lc, onAdd, onOpen }: { lc: LetterOfCredit; onAdd: () => void; onOpen: (lot: LcShipment) => void }) {
  const { Card, Button, DataTable, EmptyState } = ds()
  const { can } = useSession()
  const editable = can('lc.edit') && !['closed', 'cancelled', 'draft'].includes(lc.status)
  const rows = (lc.shipments ?? []).map((s) => ({ ...s, status_label: SHIPMENT_STATUS[s.status] ?? s.status, eta_d: s.eta ? shortDate(s.eta) : '—', arrived: s.arrived_on ? shortDate(s.arrived_on) : '—',
    bill: s.purchase_bill_id ? 'Billed' : '—' }))
  return (
    <Card title="Shipment lots" padding="none" actions={editable ? <Button size="sm" variant="secondary" icon="plus" onClick={onAdd} data-testid="lc-add-lot">Add lot</Button> : undefined}>
      <div style={{ overflowX: 'auto' }}>
        <DataTable caption="Lots" rows={rows} onRowClick={editable ? (r: LcShipment) => onOpen(r) : undefined}
          columns={[{ key: 'lot_no', label: 'Lot' }, { key: 'status_label', label: 'Status' }, { key: 'bl_number', label: 'B/L', mono: true }, { key: 'vessel', label: 'Vessel' },
            { key: 'eta_d', label: 'ETA' }, { key: 'arrived', label: 'Arrived' }, { key: 'quantity', label: 'Quantity', align: 'right', mono: true }, { key: 'bill', label: 'Bill' }]}
          emptyState={<EmptyState icon="ship" title="No shipment yet" description="Add a lot when the supplier books the shipment." />} />
      </div>
    </Card>
  )
}

function Money({ lc, onReverse, onPayCharge }: { lc: LetterOfCredit; onReverse: (k: Reversible, id: number, what: string) => void; onPayCharge: (c: LcCharge) => void }) {
  const { Card, DataTable, EmptyState, Button, Badge } = ds()
  const { can } = useSession()
  const editable = !['closed', 'cancelled'].includes(lc.status)
  const charges = (lc.charges ?? []).map((c) => ({ ...c, type: chargeLabel(c.charge_type), date: shortDate(c.charge_date), amt: c.amount,
    where: c.is_refundable ? 'Margin' : c.tax_rule_id ? 'Recoverable tax' : c.include_in_landed_cost ? (c.allocated ? 'In the goods' : 'Goods in transit') : 'Expense' }))
  const payments = (lc.payments ?? []).map((p: LcPayment) => ({ ...p, kind: PAYMENT_KIND[p.payment_kind], date: shortDate(p.payment_date), bdt: p.amount_bdt,
    margin: p.margin_applied, fx: p.fx_difference }))
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card title="Payments" padding="none">
        <div style={{ overflowX: 'auto' }} data-testid="lc-payments">
          <DataTable caption="Payments" rows={payments}
            columns={[{ key: 'date', label: 'Date' }, { key: 'kind', label: 'Kind' }, { key: 'amount_foreign', label: lc.currency_code, align: 'right', mono: true },
              { key: 'bank_rate', label: 'Rate', align: 'right', mono: true }, { key: 'bdt', label: 'Taka (৳)', type: 'amount' }, { key: 'margin', label: 'Margin applied (৳)', type: 'amount' },
              { key: 'fx', label: 'FX difference (৳)', type: 'amount' },
              { key: 'status', label: 'Status', render: (v: string) => <Badge tone={v === 'reversed' ? 'negative' : 'positive'}>{v}</Badge> }]}
            rowActions={(r: LcPayment) => editable && r.status === 'posted' && can('lc.edit')
              ? <Button size="sm" variant="ghost" onClick={() => onReverse('lc-payments', r.id, `this ${PAYMENT_KIND[r.payment_kind]?.toLowerCase()}`)}>Reverse</Button> : null}
            emptyState={<EmptyState icon="banknote" title="No payment yet" description="Record the bank's payment to the supplier at its rate." />} />
        </div>
      </Card>
      <Card title="Charges and import expenses" padding="none">
        <div style={{ overflowX: 'auto' }} data-testid="lc-charges">
          <DataTable caption="Charges" rows={charges}
            columns={[{ key: 'date', label: 'Date' }, { key: 'type', label: 'Charge' }, { key: 'paid_to', label: 'Paid to' }, { key: 'amt', label: 'Amount (৳)', type: 'amount' },
              { key: 'status', label: 'Paid', render: (v: string) => <Badge tone={v === 'paid' ? 'positive' : 'warning'}>{v === 'paid' ? 'Paid' : 'Not paid'}</Badge> },
              { key: 'where', label: 'Booked to' },
              { key: 'posting_status', label: '', render: (v: string) => v === 'reversed' ? <Badge tone="negative">Reversed</Badge> : null }]}
            rowActions={(r: LcCharge) => (editable && r.posting_status !== 'reversed' && <span style={{ display: 'flex', gap: 4 }}>
              {r.status === 'unpaid' && can('lc.create') && <Button size="sm" variant="secondary" onClick={() => onPayCharge(r)} data-testid={`pay-charge-${r.id}`}>Pay</Button>}
              {!r.allocated && can('lc.edit') && <Button size="sm" variant="ghost" onClick={() => onReverse('lc-charges', r.id, chargeLabel(r.charge_type).toLowerCase())}>Reverse</Button>}
            </span>) || null}
            emptyState={<EmptyState icon="receipt" title="No charges yet" description="Bank charges, insurance, C&F and duties for this LC appear here." />} />
        </div>
      </Card>
    </div>
  )
}

function Amendments({ lc, onAdd }: { lc: LetterOfCredit; onAdd: () => void }) {
  const { Card, Button, DataTable, EmptyState } = ds()
  const { can } = useSession()
  const toast = useToast()
  const status = useAmendmentStatus()
  const [error, setError] = useState<unknown>(null)
  const advance = async (a: { id: number; version: number; amendment_no: number }, to: 'issued' | 'accepted' | 'refused') => {
    setError(null)
    try {
      await status.mutateAsync({ id: a.id, version: a.version, input: { status: to, date: dhakaToday() } })
      toast({ tone: 'positive', title: `Amendment ${a.amendment_no} ${to}`, description: to === 'accepted' ? 'The LC is updated.' : undefined })
    } catch (e) {
      setError(e)
    }
  }
  const rows = (lc.amendments ?? []).map((a) => ({ ...a, requested: shortDate(a.requested_on), fee: a.bank_fee,
    what: (a.changes as Array<{ field_key: string; old_value?: string | null; new_value: string }>).map((c) => `${c.field_key.replace(/_/g, ' ')}: ${c.old_value ?? '—'} → ${c.new_value}`).join('; ') }))
  return (
    <Card title="Amendments" padding="none" actions={lcLive(lc.status) && can('lc.edit') ? <Button size="sm" variant="secondary" icon="plus" onClick={onAdd} data-testid="lc-add-amendment">Record amendment</Button> : undefined}>
      <ProblemBanner error={error} />
      <div style={{ overflowX: 'auto' }}>
        <DataTable caption="Amendments" rows={rows}
          columns={[{ key: 'amendment_no', label: 'No.' }, { key: 'requested', label: 'Requested' }, { key: 'what', label: 'Changes' }, { key: 'fee', label: 'Bank fee (৳)', type: 'amount' }, { key: 'status', label: 'Status' }]}
          rowActions={(r: { id: number; version: number; amendment_no: number; status: string }) => can('lc.edit') && ['requested', 'issued'].includes(r.status) ? <span style={{ display: 'flex', gap: 4 }}>
            {r.status === 'requested' && <Button size="sm" variant="ghost" onClick={() => void advance(r, 'issued')}>Issued</Button>}
            <Button size="sm" variant="secondary" onClick={() => void advance(r, 'accepted')} data-testid={`accept-amendment-${r.id}`}>Accepted</Button>
            <Button size="sm" variant="ghost" onClick={() => void advance(r, 'refused')}>Refused</Button>
          </span> : null}
          emptyState={<EmptyState icon="file-pen" title="No amendments" description="Changes to the expiry, shipment date or amount are recorded here." />} />
      </div>
    </Card>
  )
}

function Cost({ lc, onAllocate, onReverse }: { lc: LetterOfCredit; onAllocate: () => void; onReverse: (id: number) => void }) {
  const { Card, Button, Badge } = ds()
  const { can } = useSession()
  const q = useLcCostSummary(lc.id)
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="report" />
  const t = q.data.totals as Record<string, string | null>
  const allocations = ((q.data.meta ?? {}) as { allocations?: Array<{ id: number; purchase_bill_id: number; allocation_date: string; method: string; total_amount: string; status: string }> }).allocations ?? []
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="lf-grid">
        <SummaryTile label="Landed cost" value={formatTaka(t.landed_cost ?? '0.00', { symbol: true })} testId="cost-landed" />
        <SummaryTile label="Per unit" value={t.per_unit ? formatTaka(t.per_unit, { symbol: true }) : '—'} sub={t.quantity ? `${t.quantity} units` : undefined} testId="cost-per-unit" />
        <SummaryTile label="Waiting to allocate" value={formatTaka(t.unallocated ?? '0.00', { symbol: true })} testId="cost-unallocated" />
      </div>
      {(q.data.checks ?? []).map((c) => <p key={c.key} style={{ margin: 0 }} data-testid={`cost-check-${c.key}`} data-ok={c.ok ? 'true' : 'false'}>{c.ok ? '✓' : '!'} {c.message}</p>)}
      <Card title="What the goods cost" padding="none" actions={can('lc.create') && !['closed', 'cancelled'].includes(lc.status)
        ? <Button size="sm" variant="primary" onClick={onAllocate} data-testid="lc-allocate">Allocate landed cost</Button> : undefined}>
        <StatementTable report={q.data} testId="lc-cost-table" />
      </Card>
      <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13 }}>Duties and taxes are entered as assessed by customs; Pluto does not calculate them.</p>
      {allocations.length > 0 && (
        <Card title="Allocations" padding="none">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="lc-allocations">
            {allocations.map((a) => (
              <li key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
                <span>{shortDate(a.allocation_date)} · <Link to={`/purchases/bills/${a.purchase_bill_id}`}>bill</Link> · by {a.method} · {formatTaka(a.total_amount, { symbol: true })}</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Badge tone={a.status === 'posted' ? 'positive' : 'negative'}>{a.status}</Badge>
                  {a.status === 'posted' && can('lc.edit') && <Button size="sm" variant="ghost" onClick={() => onReverse(a.id)}>Reverse</Button>}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function ReverseDialog({ kind, id, what, onClose }: { kind: Reversible; id: number; what: string; onClose: () => void }) {
  const toast = useToast()
  const rev = useReverseLcItem()
  const idem = useIdempotencyKey()
  return (
    <ReasonDialog title={`Reverse ${what}?`} description="A reversing entry is posted on today's date; the original stays in the books." confirmLabel="Reverse"
      loading={rev.isPending} onClose={onClose} onConfirm={async (reason) => {
        await rev.mutateAsync({ kind, id, reason, idempotencyKey: idem.key })
        idem.reset()
        toast({ tone: 'positive', title: 'Reversed', description: `The reversal of ${what} is posted.` })
        onClose()
      }} />
  )
}

function PayChargeDialog({ charge, onClose }: { charge: LcCharge; onClose: () => void }) {
  const { Field, Select, Input, Button } = ds()
  const toast = useToast()
  const pay = usePayCharge()
  const idem = useIdempotencyKey()
  const accounts = useMoneyAccounts({ purpose: 'payments' })
  const [account, setAccount] = useState('')
  const [date, setDate] = useState(dhakaToday())
  const [error, setError] = useState<unknown>(null)
  const go = async () => {
    setError(null)
    try {
      await pay.mutateAsync({ id: charge.id, body: { paid_from_account_id: Number(account) || 0, date }, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `${chargeLabel(charge.charge_type)} paid`, description: formatTaka(charge.amount, { symbol: true }) })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ResponsiveDialog title={`Pay ${chargeLabel(charge.charge_type).toLowerCase()}`} onClose={onClose} testId="lc-pay-charge-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={pay.isPending} disabled={!account} onClick={() => void go()} data-testid="confirm-pay-charge">Pay {formatTaka(charge.amount, { symbol: true })}</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error} />
        <Field label="Paid from" htmlFor="pc-account" required>
          <Select id="pc-account" value={account} onChange={(e) => setAccount(e.target.value)} options={[{ value: '', label: 'Choose an account' }, ...(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} />
        </Field>
        <Field label="Date" htmlFor="pc-date"><Input id="pc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </ResponsiveDialog>
  )
}

export { PayChargeDialog }
