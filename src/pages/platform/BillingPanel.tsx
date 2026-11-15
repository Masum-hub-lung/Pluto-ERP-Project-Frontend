import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { CompanyBilling, PlatformCompany } from '../../api/contract.gen'
import { useRecordSubscriptionPayment, useSetBilling, useSubscriptionPayments } from '../../api/platformConsole'
import { useToast } from '../../app/toast'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'

/**
 * PEP-503 subscription tracking in the platform console (K17): each company's monthly price, the day it is paid up to,
 * the grace days before it is paused, recorded payments (bank, bKash, Nagad, cash, card) and their history. Status and
 * days left come from the API (CompanyBilling); the app never works dates or money out. A company without "paid until"
 * is not billed and is never paused for payment.
 */
const METHODS = [{ value: 'bank', label: 'Bank' }, { value: 'bkash', label: 'bKash' }, { value: 'nagad', label: 'Nagad' }, { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' }, { value: 'other', label: 'Other' }]
const day = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00`)) : '—')
const dhakaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())

export function billingLabel(b: CompanyBilling | undefined): { tone: 'positive' | 'warning' | 'negative' | 'neutral'; text: string } {
  if (!b) return { tone: 'neutral', text: '—' }
  const n = b.days_left ?? 0
  switch (b.status) {
    case 'paid': return { tone: 'positive', text: 'Paid' }
    case 'due_soon': return { tone: 'warning', text: n === 0 ? 'Due today' : `Due in ${n} day${n === 1 ? '' : 's'}` }
    case 'overdue': return { tone: 'negative', text: `Overdue ${-n} day${n === -1 ? '' : 's'}` }
    case 'suspended': return { tone: 'negative', text: 'Paused (unpaid)' }
    default: return { tone: 'neutral', text: 'Not billed' }
  }
}

/** The Billing cell of the company list: status, paid until, and the Billing button. */
export function BillingCell({ company, onOpen }: { company: PlatformCompany; onOpen: () => void }) {
  const { Badge, Button } = ds()
  const l = billingLabel(company.billing)
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', lineHeight: '18px' }}>
      <Badge tone={l.tone} dot>{l.text}</Badge>
      {company.billing?.paid_until && <span className="lf-mono" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>until {day(company.billing.paid_until)}</span>}
      <Button size="sm" variant="ghost" onClick={onOpen} data-testid={`billing-${company.id}`} aria-label={`Billing of ${company.legal_name}`}>Billing</Button>
    </span>
  )
}

export function BillingDialog({ company, onClose }: { company: PlatformCompany; onClose: () => void }) {
  const { Field, Input, Select, Button, DataTable, Segmented, EmptyState } = ds()
  const toast = useToast()
  const b = company.billing
  const payments = useSubscriptionPayments(company.id)
  const setBilling = useSetBilling()
  const record = useRecordSubscriptionPayment()
  const idem = useIdempotencyKey()
  const [tab, setTab] = useState<'pay' | 'terms' | 'history'>(b?.status === 'not_billed' ? 'terms' : 'pay')
  const [terms, setTerms] = useState({ price: b?.price ?? '', paid_until: b?.paid_until ?? '', grace_days: String(b?.grace_days ?? 7) })
  const [pay, setPay] = useState({ paid_on: dhakaToday(), amount: b?.price ?? '', months: '1', method: 'bkash', reference: '' })
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  const l = billingLabel(b)

  async function saveTerms() {
    setError(null)
    try {
      await setBilling.mutateAsync({ id: company.id, input: { price: terms.price.trim() || null, paid_until: terms.paid_until || null, grace_days: Number(terms.grace_days || '7') } })
      toast({ tone: 'positive', title: `Billing of ${company.legal_name} saved`, description: terms.paid_until ? `Paid until ${day(terms.paid_until)}.` : 'Not billed: it is never paused for payment.' })
      onClose()
    } catch (e) { setError(e) }
  }
  async function savePayment() {
    setError(null)
    try {
      const p = await record.mutateAsync({ id: company.id, idempotencyKey: idem.key, input: { paid_on: pay.paid_on, amount: pay.amount.trim(), months: Number(pay.months),
        method: pay.method as 'bank', reference: pay.reference.trim() || null } })
      idem.reset()
      toast({ tone: 'positive', title: `${formatTaka(p.amount, { symbol: true })} recorded`, description: `${company.legal_name} is paid until ${day(p.paid_until)}. Its Owners have been told.` })
      onClose()
    } catch (e) { setError(e) }
  }

  const cols: DataColumn[] = [
    { key: 'paid_on', label: 'Paid on', render: (v: string) => day(v) },
    { key: 'amount', label: 'Amount', align: 'right', render: (v: string) => <span className="lf-num">{formatTaka(v)}</span> },
    { key: 'months', label: 'Months', align: 'right', render: (v: number) => <span className="lf-num">{v}</span> },
    { key: 'paid_until', label: 'Paid until', render: (v: string) => day(v) },
    { key: 'method', label: 'Method', render: (v: string) => METHODS.find((m) => m.value === v)?.label ?? v },
    { key: 'reference', label: 'Reference', render: (v: string | null) => v ?? '—' },
  ]
  const footer = tab === 'history' ? <Button variant="ghost" onClick={onClose}>Close</Button>
    : <><Button variant="ghost" onClick={onClose}>Cancel</Button>
        {tab === 'pay'
          ? <Button variant="primary" loading={record.isPending} disabled={!/^\d+(\.\d{1,2})?$/.test(pay.amount.trim()) || !pay.paid_on} onClick={() => void savePayment()} data-testid="billing-pay-save">Record payment</Button>
          : <Button variant="primary" loading={setBilling.isPending} onClick={() => void saveTerms()} data-testid="billing-terms-save">Save billing</Button>}</>

  return (
    <ResponsiveDialog title={`Billing: ${company.legal_name}`} description={`${l.text}${b?.paid_until ? ` · paid until ${day(b.paid_until)}` : ''}${b?.price ? ` · ${formatTaka(b.price, { symbol: true })} a month` : ''}`}
      onClose={onClose} testId="billing-dialog" footer={footer}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Segmented value={tab} onChange={(v: string) => { setError(null); setTab(v as typeof tab) }}
          options={[{ value: 'pay', label: 'Record payment' }, { value: 'terms', label: 'Terms' }, { value: 'history', label: 'History' }]} />
        <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />
        {tab === 'pay' && <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }} data-testid="billing-pay">
          <Field label="Paid on" required htmlFor="bp-date" error={fe('paid_on')}><Input id="bp-date" type="date" value={pay.paid_on} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} /></Field>
          <Field label="Amount (৳)" required htmlFor="bp-amount" error={fe('amount')}>
            <Input id="bp-amount" inputMode="decimal" align="right" mono value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} invalid={!!fe('amount')} /></Field>
          <Field label="Months" required hint="Added to paid until" htmlFor="bp-months" error={fe('months')}>
            <Input id="bp-months" inputMode="numeric" align="right" mono value={pay.months} onChange={(e) => setPay({ ...pay, months: e.target.value })} /></Field>
          <Field label="Method" required htmlFor="bp-method"><Select id="bp-method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} options={METHODS} /></Field>
          <Field label="Reference" hint="Transaction or cheque no." htmlFor="bp-ref"><Input id="bp-ref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
        </div>}
        {tab === 'terms' && <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }} data-testid="billing-terms">
          <Field label="Monthly price (৳)" htmlFor="bt-price" error={fe('price')}>
            <Input id="bt-price" inputMode="decimal" align="right" mono value={terms.price} placeholder="e.g. 3000" onChange={(e) => setTerms({ ...terms, price: e.target.value })} invalid={!!fe('price')} /></Field>
          <Field label="Paid until" hint="Empty = not billed (never paused)" htmlFor="bt-until" error={fe('paid_until')}>
            <Input id="bt-until" type="date" value={terms.paid_until} onChange={(e) => setTerms({ ...terms, paid_until: e.target.value })} /></Field>
          <Field label="Grace days" hint="Paused this many days after the due date" htmlFor="bt-grace" error={fe('grace_days')}>
            <Input id="bt-grace" inputMode="numeric" align="right" mono value={terms.grace_days} onChange={(e) => setTerms({ ...terms, grace_days: e.target.value })} /></Field>
        </div>}
        {tab === 'history' && <div style={{ overflowX: 'auto' }} data-testid="billing-history">
          <ProblemBanner error={payments.error} onRetry={() => void payments.refetch()} />
          <DataTable caption="Payments" columns={cols} rows={(payments.data ?? []).map((p) => ({ ...p }))} loading={payments.isPending}
            emptyState={<EmptyState icon="receipt" title="No payments yet" description="Record the first payment on the Record payment tab." />} />
        </div>}
      </div>
    </ResponsiveDialog>
  )
}
