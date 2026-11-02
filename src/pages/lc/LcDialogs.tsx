import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { LandedCostAllocation, LcChargeInput, LcShipment, LcTransition, LetterOfCredit } from '../../api/contract.gen'
import {
  CHARGE_TYPES, chargeLabel, SHIPMENT_STATUS, useAddCharge, useAddLcDocument, useAddShipment, useCloseLc, useLandedCost, useLcs, useLcTransition, useRecordAmendment,
  useRecordLcPayment, useUpdateShipment,
} from '../../api/lc'
import { useTaxRules } from '../../api/inventory'
import { useBankFacilities } from '../../api/lcFinance'
import { useMoneyAccounts } from '../../api/money'
import { dhakaToday } from '../../api/platform'
import { useBills } from '../../api/purchases'
import { useToast } from '../../app/toast'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { PartyPicker } from '../../components/pickers/PartyPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'

/**
 * LC dialogs (backlog P16.2-FE): LC-DrawerCharge, LC-DlgPay, LC-DlgClose, landed-cost allocation (preview → allocate),
 * amendment, shipment lot, document and status changes. Every figure — taka amounts, FX difference, allocation
 * shares — comes back from the API; field errors from 422 are shown under their fields.
 */
const DEC = /^\d{1,16}(\.\d{1,6})?$/

type Errors = Record<string, string | undefined>
function fieldErrors(e: unknown): Errors {
  if (!(e instanceof ApiError) || e.status !== 422) return {}
  return Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0]]))
}

function AccountSelect({ id, label, value, onChange, error, purpose = 'payments' }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; purpose?: 'payments' | 'receipts' }) {
  const { Field, Select } = ds()
  const accounts = useMoneyAccounts({ purpose })
  return (
    <Field label={label} htmlFor={id} required error={error}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={!!error}
        options={[{ value: '', label: 'Choose an account' }, ...(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} />
    </Field>
  )
}

/** LC-DrawerCharge: a bank charge, insurance, C&F fee, duty or the margin deposit; posted at once (06 §12.3). */
export function ChargeDialog({ lc, onClose }: { lc?: LetterOfCredit; onClose: () => void }) {
  const { Field, Input, Select, Segmented, Switch, Button, Banner } = ds()
  const toast = useToast()
  const add = useAddCharge()
  const idem = useIdempotencyKey()
  const lcs = useLcs({ group: 'active', per_page: 100 }, !lc)
  const taxRules = useTaxRules()
  const [lcId, setLcId] = useState(lc ? String(lc.id) : '')
  const [type, setType] = useState<LcChargeInput['charge_type']>('opening_commission')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(dhakaToday())
  const [status, setStatus] = useState<'paid' | 'unpaid'>('paid')
  const [account, setAccount] = useState('')
  const [payee, setPayee] = useState<{ id: number; name: string } | null>(null)
  const [paidTo, setPaidTo] = useState('')
  const [reference, setReference] = useState('')
  const [landed, setLanded] = useState(true)
  const [taxRule, setTaxRule] = useState('')
  const [error, setError] = useState<unknown>(null)
  const errs = fieldErrors(error)
  const margin = type === 'margin_deposit'
  const recoverable = (taxRules.data ?? []).filter((r) => (r as { is_recoverable?: boolean }).is_recoverable)

  const save = async () => {
    setError(null)
    try {
      const c = await add.mutateAsync({ idempotencyKey: idem.key, input: {
        letter_of_credit_id: Number(lcId), charge_type: type, charge_date: date, amount: amount.trim(), status,
        paid_from_account_id: status === 'paid' && account ? Number(account) : null, payee_party_id: status === 'unpaid' && payee ? payee.id : null,
        paid_to: paidTo.trim() || null, reference: reference.trim() || null,
        ...(margin ? {} : { include_in_landed_cost: taxRule ? false : landed }), tax_rule_id: type === 'customs_duty_taxes' && taxRule ? Number(taxRule) : null,
      } })
      idem.reset()
      toast({ tone: 'positive', title: `${chargeLabel(c.charge_type)} of ${formatTaka(c.amount, { symbol: true })} recorded`,
        description: c.is_refundable ? 'Held as margin until it is applied to a payment or released.' : c.include_in_landed_cost ? 'Held in goods in transit until it is allocated to the goods.' : 'Posted as an expense.' })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ResponsiveDialog title="Add charge or import expense" onClose={onClose} testId="lc-charge-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={add.isPending} onClick={() => void save()} data-testid="save-charge">Add charge</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={Object.keys(errs).length ? null : error} />
        {!lc && (
          <Field label="LC" htmlFor="ch-lc" required error={errs.letter_of_credit_id}>
            <Select id="ch-lc" value={lcId} onChange={(e) => setLcId(e.target.value)} invalid={!!errs.letter_of_credit_id}
              options={[{ value: '', label: 'Choose an LC' }, ...(lcs.data?.data ?? []).map((l) => ({ value: String(l.id), label: `${l.lc_number} · ${l.party.name}` }))]} />
          </Field>
        )}
        <Field label="Type" htmlFor="ch-type" required error={errs.charge_type}>
          <Select id="ch-type" value={type} onChange={(e) => { const t = e.target.value as LcChargeInput['charge_type']; setType(t); setLanded(CHARGE_TYPES.find((c) => c.value === t)?.landed ?? true) }}
            options={CHARGE_TYPES.map((c) => ({ value: c.value, label: c.label }))} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Field label="Amount (৳)" htmlFor="ch-amount" required error={errs.amount}>
            <Input id="ch-amount" inputMode="decimal" align="right" mono value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!errs.amount} />
          </Field>
          <Field label="Date" htmlFor="ch-date" required error={errs.charge_date}><Input id="ch-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {type === 'customs_duty_taxes' && <Banner tone="info">Enter duties and taxes as assessed by customs; Pluto does not calculate them (BR-047).</Banner>}
        {type === 'customs_duty_taxes' && recoverable.length > 0 && (
          <Field label="Recoverable tax" htmlFor="ch-tax" hint="Choose it when this amount is input VAT you can claim back; it is then kept out of the landed cost">
            <Select id="ch-tax" value={taxRule} onChange={(e) => setTaxRule(e.target.value)}
              options={[{ value: '', label: 'No — part of the landed cost' }, ...recoverable.map((r) => ({ value: String(r.id), label: r.name }))]} />
          </Field>
        )}
        <Field label="Payment"><Segmented value={status} onChange={(v) => setStatus(v as 'paid' | 'unpaid')} options={[{ value: 'paid', label: 'Paid' }, { value: 'unpaid', label: 'Not paid yet' }]} /></Field>
        {status === 'paid'
          ? <AccountSelect id="ch-account" label="Paid from" value={account} onChange={setAccount} error={errs.paid_from_account_id} />
          : <Field label="Payable to" error={errs.payee_party_id} hint="The agent or supplier the charge is owed to">
              <PartyPicker type="supplier" value={payee as never} onChange={(p) => setPayee(p ? { id: p.id, name: p.name } : null)} aria-label="Payable to" />
            </Field>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Field label="Paid to (name)" htmlFor="ch-paidto"><Input id="ch-paidto" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} placeholder="Optional" /></Field>
          <Field label="Reference" htmlFor="ch-ref"><Input id="ch-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></Field>
        </div>
        {!margin && !taxRule && (
          <Switch checked={landed} onChange={(v: boolean) => setLanded(v)} label="Add to the landed cost of the goods" />
        )}
        {margin && <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13 }}>The margin is refundable: it is never part of the landed cost (BR-044).</p>}
      </div>
    </ResponsiveDialog>
  )
}

/** LC-DlgPay: the bank pays the supplier at its rate; the taka amount and any exchange difference come back (BR-042, BR-043). */
export function PayDialog({ lc, onClose }: { lc: LetterOfCredit; onClose: () => void }) {
  const { Field, Input, Segmented, Button } = ds()
  const toast = useToast()
  const pay = useRecordLcPayment(lc.id)
  const idem = useIdempotencyKey()
  const usance = lc.tenor === 'usance'
  const accepted = (lc.payments ?? []).some((p) => p.payment_kind === 'usance_acceptance' && p.status === 'posted')
  const [kind, setKind] = useState<'sight_payment' | 'usance_acceptance' | 'usance_settlement'>(usance ? (accepted ? 'usance_settlement' : 'usance_acceptance') : 'sight_payment')
  const [amount, setAmount] = useState(lc.outstanding_foreign)
  const [rate, setRate] = useState('')
  const [date, setDate] = useState(dhakaToday())
  const [account, setAccount] = useState(lc.issuing_bank ? String(lc.issuing_bank.id) : '')
  const [margin, setMargin] = useState('')
  const [reference, setReference] = useState('')
  const [financing, setFinancing] = useState<'own' | 'bank'>('own')
  const [loanKind, setLoanKind] = useState<'pad' | 'ltr'>('ltr')
  const [loanRate, setLoanRate] = useState('')
  const [tenor, setTenor] = useState('')
  const facilities = useBankFacilities()
  const facility = (facilities.data ?? []).find((f) => String(f.money_account_id) === account)
  const financed = financing === 'bank' && kind !== 'usance_acceptance'
  const [error, setError] = useState<unknown>(null)
  const errs = fieldErrors(error)
  const held = String((lc.money_position as Record<string, unknown> | null)?.margin_held ?? '0.00')

  const save = async () => {
    setError(null)
    if (!DEC.test(rate.trim())) { setError(new ApiError({ title: 'Check the rate', status: 422, code: 'validation_failed', errors: { bank_rate: ['Enter the rate the bank applied'] } })); return }
    try {
      const p = await pay.mutateAsync({ idempotencyKey: idem.key, input: {
        payment_kind: kind, payment_date: date, amount_foreign: amount.trim(), bank_rate: rate.trim(), money_account_id: Number(account) || 0,
        margin_applied: kind !== 'usance_acceptance' && margin.trim() ? margin.trim() : undefined, bank_reference: reference.trim() || null,
        ...(financed ? { financed_by: loanKind, loan: { loan_kind: loanKind, ...(loanRate.trim() ? { interest_rate_pct: loanRate.trim() } : {}), ...(tenor.trim() ? { tenor_days: Number(tenor) } : {}) } } : {}),
      } })
      idem.reset()
      if (p.lc_loan_id) toast({ tone: 'info', title: `${loanKind.toUpperCase()} loan opened`, description: 'See it under LC Management › Loans.' })
      toast({ tone: 'positive', title: `${lc.currency_code} ${p.amount_foreign} recorded at ${p.bank_rate}`,
        description: `${formatTaka(p.amount_bdt, { symbol: true })}${p.fx_difference !== '0.00' ? ` · exchange difference ${formatTaka(p.fx_difference, { symbol: true })}` : ''}` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ResponsiveDialog title={`Record payment — ${lc.lc_number}`} onClose={onClose} testId="lc-pay-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={pay.isPending} onClick={() => void save()} data-testid="save-lc-payment">Record payment</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={Object.keys(errs).length ? null : error} />
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Outstanding {lc.currency_code} {lc.outstanding_foreign} of {lc.amount} (tolerance {lc.tolerance_pct} %). The taka amount is the amount × the bank's rate, worked out when you record it.</p>
        {usance && <Field label="What happened">
          <Segmented value={kind} onChange={(v) => setKind(v as typeof kind)} options={[{ value: 'usance_acceptance', label: 'Bank accepted' }, { value: 'usance_settlement', label: 'Paid at maturity' }]} />
        </Field>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Field label={`Amount (${lc.currency_code})`} htmlFor="pay-amount" required error={errs.amount_foreign}>
            <Input id="pay-amount" inputMode="decimal" align="right" mono value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!errs.amount_foreign} />
          </Field>
          <Field label="Rate applied by bank" htmlFor="pay-rate" required error={errs.bank_rate} hint={`Planning rate ${lc.planning_rate}`}>
            <Input id="pay-rate" inputMode="decimal" align="right" mono value={rate} onChange={(e) => setRate(e.target.value)} invalid={!!errs.bank_rate} />
          </Field>
          <Field label="Paid on" htmlFor="pay-date" required error={errs.payment_date}><Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {kind !== 'usance_acceptance' && <Field label="Paid with">
          <Segmented value={financing} onChange={(v) => setFinancing(v as typeof financing)}
            options={[{ value: 'own', label: 'Own funds' }, { value: 'bank', label: 'Bank finance (PAD/LTR)' }]} />
        </Field>}
        <AccountSelect id="pay-account" label={financed ? 'Financing bank' : 'Debited from'} value={account} onChange={setAccount} error={errs.money_account_id} />
        {financed && (
          <div style={{ display: 'grid', gap: 12 }} data-testid="pay-loan-terms">
            <p style={{ margin: 0, color: 'var(--ink-muted)' }}>The bank pays the supplier and lends you the amount after margin. Blank terms take the bank's defaults
              {facility ? ` (${facility.interest_rate_pct} %, ${facility.loan_tenor_days} days, actual/${facility.day_count})` : ' (set them under LC Management › Banks and limits)'}.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <Field label="Loan type"><Segmented value={loanKind} onChange={(v) => setLoanKind(v as typeof loanKind)} options={[{ value: 'pad', label: 'PAD' }, { value: 'ltr', label: 'LTR' }]} /></Field>
              <Field label="Interest rate (% a year)" htmlFor="pay-loan-rate" error={errs['loan.interest_rate_pct']}>
                <Input id="pay-loan-rate" inputMode="decimal" align="right" mono value={loanRate} onChange={(e) => setLoanRate(e.target.value)} placeholder={facility?.interest_rate_pct ?? ''} />
              </Field>
              <Field label="Tenor (days)" htmlFor="pay-loan-tenor" error={errs['loan.tenor_days']}>
                <Input id="pay-loan-tenor" inputMode="numeric" align="right" mono value={tenor} onChange={(e) => setTenor(e.target.value.replace(/\D/g, ''))} placeholder={facility ? String(facility.loan_tenor_days) : ''} />
              </Field>
            </div>
          </div>
        )}
        {kind !== 'usance_acceptance' && (
          <Field label="Margin applied (৳)" htmlFor="pay-margin" error={errs.margin_applied} hint={`Margin held for this LC: ${formatTaka(held, { symbol: true })}`}>
            <Input id="pay-margin" inputMode="decimal" align="right" mono value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="0.00" invalid={!!errs.margin_applied} />
          </Field>
        )}
        <Field label="Bank reference" htmlFor="pay-ref"><Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></Field>
      </div>
    </ResponsiveDialog>
  )
}

/** LC-DlgClose: the checks come back with a 422 when something is open; an override reason closes anyway (BR-046). */
export function CloseDialog({ lc, onClose }: { lc: LetterOfCredit; onClose: () => void }) {
  const { Field, Input, Button, Banner } = ds()
  const toast = useToast()
  const close = useCloseLc(lc.id)
  const idem = useIdempotencyKey()
  const [reason, setReason] = useState('')
  const [account, setAccount] = useState(lc.issuing_bank ? String(lc.issuing_bank.id) : '')
  const [error, setError] = useState<unknown>(null)
  const checks = error instanceof ApiError && Array.isArray(error.problem.checks) ? error.problem.checks as Array<{ key: string; ok: boolean; message: string }> : null
  const errs = fieldErrors(error)
  const go = async () => {
    setError(null)
    try {
      const r = await close.mutateAsync({ idempotencyKey: idem.key, body: { override_reason: reason.trim() || null, release_margin_to_account_id: account ? Number(account) : null } })
      idem.reset()
      toast({ tone: 'positive', title: `${r.lc_number} closed`, description: 'Any margin left was released to the account.' })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ResponsiveDialog title={`Close ${lc.lc_number}?`} onClose={onClose} testId="lc-close-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={close.isPending} onClick={() => void go()} data-testid="confirm-close-lc">Close LC</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0 }}>Closing checks the supplier is paid, charges are paid, documents are in and every charge is in the goods. Margin still held goes back to the account below.</p>
        {checks ? (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }} data-testid="close-checks">
            {checks.map((c) => <li key={c.key} data-ok={c.ok ? 'true' : 'false'}>{c.ok ? '✓' : '✕'} {c.message}</li>)}
          </ul>
        ) : <ProblemBanner error={Object.keys(errs).length ? null : error} />}
        {checks && <Banner tone="warning">{(error as ApiError).problem.detail}</Banner>}
        <AccountSelect id="close-account" label="Release margin to" value={account} onChange={setAccount} error={errs.release_margin_to_account_id} purpose="receipts" />
        <Field label="Override reason" htmlFor="close-reason" hint="Only when a check fails; kept in the audit log">
          <Input id="close-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </ResponsiveDialog>
  )
}

interface AllocationLine { product_name: string; allocated_amount: string; amount_to_inventory: string; amount_to_cogs: string; per_unit?: string; qty_received: string; qty_on_hand: string }

/** Allocate the charges held in goods in transit to an import bill: preview first, then post (BR-045). */
export function LandedCostDialog({ lc, billId, onClose }: { lc: LetterOfCredit; billId?: number; onClose: () => void }) {
  const { Field, Input, Select, Segmented, Button, DataTable } = ds()
  const toast = useToast()
  const { preview, allocate } = useLandedCost(lc.id)
  const idem = useIdempotencyKey()
  const bills = useBills({ letter_of_credit_id: lc.id, status: 'posted', per_page: 50 })
  const [bill, setBill] = useState(billId ? String(billId) : '')
  const [date, setDate] = useState(dhakaToday())
  const [method, setMethod] = useState<'value' | 'quantity'>('value')
  const [result, setResult] = useState<LandedCostAllocation | null>(null)
  const [error, setError] = useState<unknown>(null)
  const input = { purchase_bill_id: Number(bill), allocation_date: date, method }
  const run = async () => {
    setError(null)
    try { setResult(await preview.mutateAsync(input)) } catch (e) { setError(e); setResult(null) }
  }
  const post = async () => {
    setError(null)
    try {
      const a = await allocate.mutateAsync({ input, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `${formatTaka(a.total_amount, { symbol: true })} allocated to the goods`, description: 'Stock cost and cost of goods sold are updated.' })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  const lines = (result?.lines ?? []) as unknown as AllocationLine[]
  return (
    <ResponsiveDialog title={`Allocate landed cost — ${lc.lc_number}`} onClose={onClose} testId="landed-cost-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        {result ? <Button variant="primary" loading={allocate.isPending} onClick={() => void post()} data-testid="post-landed-cost">Allocate</Button>
          : <Button variant="primary" loading={preview.isPending} disabled={!bill} onClick={() => void run()} data-testid="preview-landed-cost">Preview</Button>}</>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Field label="Import bill" htmlFor="lca-bill" required>
            <Select id="lca-bill" value={bill} onChange={(e) => { setBill(e.target.value); setResult(null) }}
              options={[{ value: '', label: 'Choose a posted bill' }, ...(bills.data?.data ?? []).map((b) => ({ value: String(b.id), label: `${b.number} · ${b.supplier_bill_no}` }))]} />
          </Field>
          <Field label="Date" htmlFor="lca-date"><Input id="lca-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setResult(null) }} /></Field>
        </div>
        <Field label="Share by"><Segmented value={method} onChange={(v) => { setMethod(v as 'value' | 'quantity'); setResult(null) }} options={[{ value: 'value', label: 'Value' }, { value: 'quantity', label: 'Quantity' }]} /></Field>
        {result && (
          <div data-testid="landed-cost-preview" style={{ display: 'grid', gap: 8 }}>
            <strong>{formatTaka(result.total_amount, { symbol: true })} to allocate</strong>
            <div style={{ overflowX: 'auto' }}>
              <DataTable caption="Allocation" rows={lines.map((l, i) => ({ id: i, ...l, inv: l.amount_to_inventory, cogs: l.amount_to_cogs, total: l.allocated_amount }))}
                columns={[{ key: 'product_name', label: 'Item' }, { key: 'total', label: 'Share (৳)', type: 'amount' }, { key: 'inv', label: 'To stock (৳)', type: 'amount' },
                  { key: 'cogs', label: 'To cost of sales (৳)', type: 'amount' }, { key: 'per_unit', label: 'Per unit (৳)', align: 'right', mono: true }]} />
            </div>
            {(result.warnings ?? []).map((w, i) => <p key={i} style={{ margin: 0, color: 'var(--ink-muted)' }}>{w.message}</p>)}
          </div>
        )}
      </div>
    </ResponsiveDialog>
  )
}

/** M4/M5 record an amendment: only the fields that change; applied to the LC when accepted (BR-041). */
export function AmendmentDialog({ lc, onClose }: { lc: LetterOfCredit; onClose: () => void }) {
  const { Field, Input, Segmented, Button } = ds()
  const toast = useToast()
  const rec = useRecordAmendment(lc.id)
  const idem = useIdempotencyKey()
  const [expiry, setExpiry] = useState('')
  const [shipment, setShipment] = useState('')
  const [amount, setAmount] = useState('')
  const [fee, setFee] = useState('')
  const [other, setOther] = useState('')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState<'requested' | 'issued' | 'accepted'>('requested')
  const [error, setError] = useState<unknown>(null)
  const errs = fieldErrors(error)
  const changes = [
    ...(expiry ? [{ field_key: 'expiry_date' as const, new_value: expiry }] : []),
    ...(shipment ? [{ field_key: 'latest_shipment_date' as const, new_value: shipment }] : []),
    ...(amount.trim() ? [{ field_key: 'amount' as const, new_value: amount.trim() }] : []),
  ]
  const changed = changes.length > 0 || other.trim() !== ''
  const save = async () => {
    setError(null)
    try {
      const a = await rec.mutateAsync({ idempotencyKey: idem.key, input: { requested_on: dhakaToday(), status, changes: changes as never, other_change: other.trim() || null,
        reason: reason.trim() || null, bank_fee: fee.trim() || undefined } })
      idem.reset()
      toast({ tone: 'positive', title: `Amendment ${a.amendment_no} recorded`, description: a.status === 'accepted' ? 'The LC is updated.' : 'The LC changes when the amendment is accepted.' })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ResponsiveDialog title={`Record amendment — ${lc.lc_number}`} onClose={onClose} testId="lc-amend-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!changed} loading={rec.isPending} onClick={() => void save()} data-testid="save-amendment">Record amendment</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={Object.keys(errs).length ? null : error} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Field label="New expiry date" htmlFor="am-expiry" hint={`Now ${lc.expiry_date ?? '—'}`} error={errs['changes.0.new_value']}><Input id="am-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
          <Field label="New latest shipment" htmlFor="am-ship" hint={`Now ${lc.latest_shipment_date ?? '—'}`}><Input id="am-ship" type="date" value={shipment} onChange={(e) => setShipment(e.target.value)} /></Field>
          <Field label={`New amount (${lc.currency_code})`} htmlFor="am-amount" hint={`Now ${lc.amount}`}><Input id="am-amount" inputMode="decimal" align="right" mono value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Bank fee (৳)" htmlFor="am-fee" error={errs.bank_fee}><Input id="am-fee" inputMode="decimal" align="right" mono value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" /></Field>
        </div>
        <Field label="Other change" htmlFor="am-other"><Input id="am-other" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Reason" htmlFor="am-reason"><Input id="am-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Status"><Segmented value={status} onChange={(v) => setStatus(v as typeof status)} options={[{ value: 'requested', label: 'Requested' }, { value: 'issued', label: 'Issued' }, { value: 'accepted', label: 'Accepted' }]} /></Field>
      </div>
    </ResponsiveDialog>
  )
}

/** Add or update a shipment lot. */
export function ShipmentDialog({ lc, lot, onClose }: { lc: LetterOfCredit; lot?: LcShipment; onClose: () => void }) {
  const { Field, Input, Select, Button } = ds()
  const toast = useToast()
  const add = useAddShipment(lc.id)
  const upd = useUpdateShipment()
  const [status, setStatus] = useState(lot?.status ?? 'not_shipped')
  const [bl, setBl] = useState(lot?.bl_number ?? '')
  const [vessel, setVessel] = useState(lot?.vessel ?? '')
  const [etd, setEtd] = useState(lot?.etd ?? '')
  const [eta, setEta] = useState(lot?.eta ?? '')
  const [arrived, setArrived] = useState(lot?.arrived_on ?? '')
  const [qty, setQty] = useState(lot?.quantity ?? '')
  const [error, setError] = useState<unknown>(null)
  const errs = fieldErrors(error)
  const save = async () => {
    setError(null)
    const input = { status: status as never, bl_number: bl.trim() || null, vessel: vessel.trim() || null, etd: etd || null, eta: eta || null, arrived_on: arrived || null,
      quantity: qty.trim() || null, ...(status === 'at_sea' && !lot?.etd ? { shipped_on: etd || dhakaToday() } : {}) }
    try {
      const s = lot ? await upd.mutateAsync({ id: lot.id, input, version: lot.version }) : await add.mutateAsync(input)
      toast({ tone: 'positive', title: `Lot ${s.lot_no} ${lot ? 'updated' : 'added'}`, description: SHIPMENT_STATUS[s.status] ?? s.status })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ResponsiveDialog title={lot ? `Lot ${lot.lot_no}` : 'Add shipment lot'} onClose={onClose} testId="lc-lot-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={add.isPending || upd.isPending} onClick={() => void save()} data-testid="save-lot">Save lot</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={Object.keys(errs).length ? null : error} />
        <Field label="Status" htmlFor="lot-status" error={errs.status}>
          <Select id="lot-status" value={status} onChange={(e) => setStatus(e.target.value)} options={Object.entries(SHIPMENT_STATUS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Field label="B/L number" htmlFor="lot-bl" error={errs.bl_number}><Input id="lot-bl" value={bl} onChange={(e) => setBl(e.target.value)} /></Field>
          <Field label="Vessel" htmlFor="lot-vessel"><Input id="lot-vessel" value={vessel} onChange={(e) => setVessel(e.target.value)} /></Field>
          <Field label="Departs (ETD)" htmlFor="lot-etd"><Input id="lot-etd" type="date" value={etd} onChange={(e) => setEtd(e.target.value)} /></Field>
          <Field label="Arrives (ETA)" htmlFor="lot-eta"><Input id="lot-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></Field>
          <Field label="Arrived on" htmlFor="lot-arrived" error={errs.arrived_on}><Input id="lot-arrived" type="date" value={arrived} onChange={(e) => setArrived(e.target.value)} /></Field>
          <Field label="Quantity" htmlFor="lot-qty" error={errs.quantity}><Input id="lot-qty" inputMode="decimal" align="right" mono value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        </div>
      </div>
    </ResponsiveDialog>
  )
}

/** Add a required document to the LC's checklist. */
export function DocumentDialog({ lc, onClose }: { lc: LetterOfCredit; onClose: () => void }) {
  const { Field, Input, Button } = ds()
  const toast = useToast()
  const add = useAddLcDocument(lc.id)
  const [name, setName] = useState('')
  const [by, setBy] = useState('Supplier')
  const [copies, setCopies] = useState('1')
  const [error, setError] = useState<unknown>(null)
  const errs = fieldErrors(error)
  const save = async () => {
    setError(null)
    try {
      const d = await add.mutateAsync({ name: name.trim(), provided_by: by.trim(), copies: Number(copies) || 1 })
      toast({ tone: 'positive', title: `${d.name} added to the checklist` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ResponsiveDialog title="Add document" onClose={onClose} testId="lc-doc-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={add.isPending} onClick={() => void save()} data-testid="save-doc">Add document</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={Object.keys(errs).length ? null : error} />
        <Field label="Document" htmlFor="doc-name" required error={errs.name}><Input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errs.name} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Field label="Provided by" htmlFor="doc-by" required error={errs.provided_by}><Input id="doc-by" value={by} onChange={(e) => setBy(e.target.value)} /></Field>
          <Field label="Copies" htmlFor="doc-copies" error={errs.copies}><Input id="doc-copies" inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
      </div>
    </ResponsiveDialog>
  )
}

/** Status changes; "Mark opened" asks for the bank's reference and the opening date (BR-039), cancel/expire/refuse for a reason. */
export function TransitionDialog({ lc, action, label, onClose }: { lc: LetterOfCredit; action: LcTransition['action']; label: string; onClose: () => void }) {
  const { Field, Input, Button } = ds()
  const toast = useToast()
  const t = useLcTransition(lc.id)
  const [ref, setRef] = useState(lc.bank_reference ?? '')
  const [date, setDate] = useState(dhakaToday())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const errs = fieldErrors(error)
  const opened = action === 'mark_opened'
  const needsReason = ['cancel', 'expire', 'mark_refused', 'reopen'].includes(action)
  const go = async () => {
    setError(null)
    try {
      const r = await t.mutateAsync({ version: lc.version, body: { action, ...(opened ? { bank_reference: ref.trim() || null, date } : {}), ...(needsReason ? { reason: reason.trim() || null } : {}),
        ...(action === 'documents_presented' || action === 'payment_due' ? { date } : {}) } })
      toast({ tone: 'positive', title: `${r.lc_number}: ${label.toLowerCase()}`, description: `Status is now ${r.status.replace(/_/g, ' ')}.` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  const incomplete = error instanceof ApiError && error.code === 'lc_submit_incomplete'
  return (
    <ResponsiveDialog title={`${label} — ${lc.lc_number}`} onClose={onClose} testId="lc-transition-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={t.isPending} onClick={() => void go()} data-testid="confirm-transition">{label}</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error} />
        {incomplete && <ul style={{ margin: 0 }} data-testid="submit-missing">{Object.values((error as ApiError).fieldErrors).map((m, i) => <li key={i}>{m[0]}</li>)}</ul>}
        {action === 'submit' && <p style={{ margin: 0 }}>The LC goes to the bank; the supplier, amount, issuing bank and expiry date must be filled in.</p>}
        {opened && <>
          <Field label="Bank reference" htmlFor="tr-ref" required error={errs.bank_reference}><Input id="tr-ref" value={ref} onChange={(e) => setRef(e.target.value)} invalid={!!errs.bank_reference} /></Field>
          <Field label="Opening date" htmlFor="tr-date" required error={errs.date}><Input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </>}
        {(action === 'documents_presented' || action === 'payment_due') && <Field label="Date" htmlFor="tr-date2"><Input id="tr-date2" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        {needsReason && <Field label="Reason" htmlFor="tr-reason" error={errs.reason}><Input id="tr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kept in the audit log" /></Field>}
      </div>
    </ResponsiveDialog>
  )
}
