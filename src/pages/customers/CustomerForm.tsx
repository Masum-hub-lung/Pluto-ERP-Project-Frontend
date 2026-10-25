import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { Party } from '../../api/contract.gen'
import { useCreateCustomer, useCustomer, useCustomerAction, usePaymentTerms, useUpdateCustomer } from '../../api/parties'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { customerSchema, emptyCustomer, serverFieldMap, toPartyInput, type CustomerFormParsed, type CustomerFormValues } from '../../lib/customerSchema'
import { openingInput, splitOpening } from '../../lib/opening'
import { formatTaka, termLabel } from '../../lib/format'
import { applyProblemToForm } from '../../lib/forms'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ConflictBanner } from '../../components/ConflictBanner'
import { DeleteDialog } from '../../components/DeleteDialog'
import { FormErrorSummary } from '../../components/FormErrorSummary'
import { PageSkeleton } from '../../components/PageSkeleton'
import { PartyGroupField } from '../../components/PartyGroupField'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden, NotFound } from '../../components/states'

/** Districts offered by the design (Parties.dc.html districtOptions). */
const DISTRICTS = ['Dhaka', 'Chattogram', 'Gazipur', 'Narayanganj', 'Cumilla', 'Sylhet', 'Rajshahi', 'Khulna', 'Bogura', 'Naogaon']
const TYPES = [{ value: '', label: 'Choose…' }, { value: 'business', label: 'Business' }, { value: 'individual', label: 'Individual' }, { value: 'walk_in', label: 'Walk-in counter' }]

/** B2 Add customer / B3 Edit customer (Cust-Add.dc.html, Cust-Edit.dc.html). */
export function CustomerForm({ mode }: { mode: 'add' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const existing = useCustomer(mode === 'edit' ? id : 0)
  if (mode === 'add' && !can('parties.create')) return <Forbidden permission="parties.create" what="adding customers" />
  if (mode === 'edit' && !can('parties.edit')) return <Forbidden permission="parties.edit" what="editing customers" />
  if (mode === 'edit') {
    if (existing.error instanceof ApiError && existing.error.status === 404) return <NotFound what="this customer" />
    if (existing.error) return <ProblemBanner error={existing.error} onRetry={() => void existing.refetch()} />
    if (!existing.data) return <PageSkeleton template="form" />
    if (existing.data.party.party_type !== 'customer') return <NotFound what="this customer" />
  }
  return <Form key={mode === 'edit' ? `${id}` : 'add'} mode={mode} party={existing.data?.party ?? null} />
}

function toForm(p: Party | null): CustomerFormValues {
  if (!p) return { ...emptyCustomer }
  const cat = p.category === 'business' || p.category === 'individual' || p.category === 'walk_in' ? p.category : ''
  return {
    name: p.name, category: cat, party_group_id: p.group ? String(p.group.id) : '', contact_person: p.contact_person ?? '',
    mobile: p.mobile ?? '', email: p.email ?? '', alt_phone: p.alt_phone ?? '', address: p.address ?? '', district: p.district ?? '',
    area: p.area ?? '', payment_term_id: p.payment_term ? String(p.payment_term.id) : '', credit_limit: p.credit_limit ?? '',
    price_tier: p.price_tier === 'wholesale' ? 'wholesale' : 'standard', tax_registration_no: p.tax_registration_no ?? '', notes: p.notes ?? '',
    ...splitOpening(p.opening_balance, 'customer'),
  }
}

function Form({ mode, party }: { mode: 'add' | 'edit'; party: Party | null }) {
  const L = ds()
  const { Card, Field, Input, Select, Button, Banner, Badge, Icon, PageHeader } = L
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const terms = usePaymentTerms()
  const create = useCreateCustomer()
  const update = useUpdateCustomer(party?.id ?? 0)
  const action = useCustomerAction(party?.id ?? 0)
  const idem = useIdempotencyKey()
  const [version, setVersion] = useState(party?.version ?? 0)
  const [conflict, setConflict] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const addAnother = useRef(false)

  const defaults = useMemo(() => {
    const d = toForm(party)
    if (mode === 'add' && terms.data) d.payment_term_id = String(terms.data.find((t) => t.is_default)?.id ?? '')
    return d
  }, [party, mode, terms.data])
  // The latest defaults, for resets that happen after an await (the terms may have arrived in the meantime).
  const latestDefaults = useRef(defaults)
  latestDefaults.current = defaults
  const { register, handleSubmit, setError, reset, watch, setValue, formState: { errors, isDirty, isSubmitting, submitCount } } =
    useForm<CustomerFormValues, unknown, CustomerFormParsed>({ resolver: zodResolver(customerSchema), defaultValues: defaults, mode: 'onSubmit' })
  // New server data (record refetched, payment terms arrived): update the untouched fields, never what the user typed.
  useEffect(() => { reset(defaults, { keepDirtyValues: true, keepErrors: true, keepSubmitCount: true, keepTouched: true }) }, [defaults]) // eslint-disable-line react-hooks/exhaustive-deps
  const guard = useUnsavedChangesBlocker(isDirty, 'Your edits to this customer have not been saved.')

  const errorCount = Object.keys(errors).length
  const err = (k: keyof CustomerFormValues) => errors[k]?.message as string | undefined

  async function onValid(values: CustomerFormParsed) {
    setFormError(null)
    setUnmatched([])
    setConflict(false)
    const input = { ...toPartyInput(values), ...(party?.opening_locked ? {} : openingInput(values, !!party)) }
    try {
      if (mode === 'add') {
        const r = await create.mutateAsync({ input, idempotencyKey: idem.key })
        idem.reset()
        toast({ tone: 'positive', title: `${r.data.name} added as ${r.data.code}`, description: `Ledger ${r.data.ledger_code} created under Sundry debtors.` })
        for (const w of r.warnings ?? []) toast({ tone: 'warning', title: w.message })
        if (addAnother.current) { reset({ ...emptyCustomer, payment_term_id: latestDefaults.current.payment_term_id }); return }
        reset(toForm(r.data))
        guard.allowNavigation()
        navigate(`/customers/${r.data.id}`)
      } else if (party) {
        const updated = await update.mutateAsync({ input, version })
        setVersion(updated.version)
        reset(toForm(updated))
        toast({ tone: 'positive', title: 'Changes saved', description: `${updated.name} · version ${updated.version}` })
        guard.allowNavigation()
        navigate(`/customers/${party.id}`)
      }
    } catch (e) {
      const placed = applyProblemToForm(e, setError, serverFieldMap)
      if (placed) {
        setUnmatched(placed.unmatched)
      } else if (e instanceof ApiError && e.code === 'version_conflict') {
        setConflict(true)
      } else {
        setFormError(e)
      }
    }
  }

  async function reloadLatest() {
    if (!party) return
    setReloading(true)
    try {
      const fresh = await api.request<{ data: Party }>('GET', `/parties/${party.id}`)
      setVersion(fresh.data.data.version)
      setConflict(false)
      toast({ tone: 'info', title: 'Loaded the latest version', description: 'Your edits are kept; save again to apply them.' })
    } catch (e) {
      setFormError(e)
    } finally {
      setReloading(false)
    }
  }

  async function runAction(a: 'deactivate' | 'reactivate' | 'delete') {
    try {
      await action.mutateAsync(a)
      guard.allowNavigation()
      if (a === 'delete') {
        toast({ tone: 'positive', title: `${party?.name} deleted` })
        navigate('/customers')
      } else {
        toast({ tone: 'positive', title: a === 'deactivate' ? `${party?.name} is now inactive` : `${party?.name} is active again` })
        navigate(`/customers/${party?.id}`)
      }
    } catch (e) {
      setConfirmDelete(false)
      if (e instanceof ApiError && e.code === 'has_history') toast({ tone: 'warning', title: 'This customer has transactions', description: 'Make it inactive instead.' })
      else setFormError(e)
    }
  }

  // Leaving with unsaved edits asks first (useUnsavedChangesBlocker shows "Discard unsaved changes?").
  const cancel = () => navigate(mode === 'edit' && party ? `/customers/${party.id}` : '/customers')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void handleSubmit(onValid)() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 } as const
  const checklist = [
    { ok: !err('name') && !err('mobile'), title: 'Name and mobile', body: 'Both are required to issue documents.' },
    { info: true, title: 'Opening balance', body: 'Booked on the first day of the financial year; locked after the first invoice or receipt.' },
    { info: true, title: 'Tax registration', body: 'Optional. Leave blank if tax does not apply to this customer.' },
    { ok: true, title: 'Ledger created for you', body: 'Posted under 1201 · Sundry debtors.' },
  ]

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate data-testid="customer-form">
      <PageHeader eyebrow="Customers" title={mode === 'edit' ? `Edit ${party?.name}` : 'New customer'}
        description={mode === 'edit' ? `${party?.code}${party?.area || party?.district ? ` · ${[party.area, party.district].filter(Boolean).join(', ')}` : ''}` : 'Fields marked * are required. Everything else can be added later.'} />
      <FormErrorSummary count={submitCount > 0 ? errorCount : 0} noun="customer" messages={unmatched} />
      {conflict && <ConflictBanner onReload={() => void reloadLatest()} loading={reloading} />}
      <ProblemBanner error={formError} />
      {mode === 'edit' && party?.status === 'inactive' && <Banner tone="info" title="This customer is inactive">It is hidden from new invoices. Reactivate it below.</Banner>}
      {mode === 'edit' && party?.status !== 'inactive' && <Banner tone="info" title={`Editing ${party?.code}`}>Changes apply to new invoices. Posted invoices keep the details they were issued with.</Banner>}

      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
          <Card title="Basic details" subtitle="How this customer appears on invoices and in lists">
            <div style={grid}>
              <Field label="Customer name" required error={err('name')} hint="As it appears on documents" htmlFor="f-name">
                <Input id="f-name" {...register('name')} invalid={!!err('name')} placeholder="e.g. Karim Distributors" />
              </Field>
              <Field label="Customer code" hint="Generated automatically">
                <Input mono readOnly value={party?.code ?? 'CUS-…'} aria-label="Customer code" />
              </Field>
              <Field label="Type" htmlFor="f-category">
                <Select id="f-category" options={TYPES} {...register('category')} />
              </Field>
              <PartyGroupField type="customer" id="f-group" value={watch('party_group_id')} error={err('party_group_id')}
                onChange={(v) => setValue('party_group_id', v, { shouldDirty: true })} />
            </div>
          </Card>

          <Card title="Contact" subtitle="Who to call about orders and payments">
            <div style={grid}>
              <Field label="Contact person" error={err('contact_person')} htmlFor="f-person">
                <Input id="f-person" {...register('contact_person')} placeholder="Full name" />
              </Field>
              <Field label="Mobile number" required error={err('mobile')} hint="11 digits, starting 01" htmlFor="f-mobile">
                <Input id="f-mobile" prefix="+88" mono {...register('mobile')} invalid={!!err('mobile')} placeholder="01XXX-XXXXXX" inputMode="tel" />
              </Field>
              <Field label="Email" error={err('email')} htmlFor="f-email">
                <Input id="f-email" type="email" {...register('email')} invalid={!!err('email')} placeholder="name@company.com" />
              </Field>
              <Field label="Alternate number" error={err('alt_phone')} htmlFor="f-alt">
                <Input id="f-alt" prefix="+88" mono {...register('alt_phone')} placeholder="Optional" />
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Address" error={err('address')} htmlFor="f-address">
                  <Input id="f-address" {...register('address')} placeholder="House, road, area" />
                </Field>
              </div>
              <Field label="District" htmlFor="f-district">
                <Select id="f-district" options={[{ value: '', label: 'Choose…' }, ...DISTRICTS]} {...register('district')} />
              </Field>
              <Field label="Area or thana" error={err('area')} htmlFor="f-area">
                <Input id="f-area" {...register('area')} placeholder="e.g. Mirpur" />
              </Field>
            </div>
          </Card>

          <Card title="Accounting" subtitle="How this customer is posted to your books">
            <div style={grid}>
              <Field label="Opening balance" term="What this customer already owed you on the day you started using Pluto." error={err('opening_balance')} htmlFor="f-opening"
                hint={party?.opening_locked ? 'Locked: this customer already has entries (BR-028)' : 'Booked on the first day of the financial year'}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input id="f-opening" prefix="৳" align="right" inputMode="decimal" {...register('opening_balance')} readOnly={!!party?.opening_locked} invalid={!!errors.opening_balance} placeholder="0.00" />
                  <div style={{ width: 150, flex: 'none' }}>
                    <Select aria-label="Opening side" {...register('opening_side')} disabled={!!party?.opening_locked}
                      options={[{ value: 'dr', label: 'Dr · they owe you' }, { value: 'cr', label: 'Cr · advance' }]} />
                  </div>
                </div>
              </Field>
              <Field label="Payment terms" htmlFor="f-terms">
                <Select id="f-terms" options={[{ value: '', label: 'None' }, ...(terms.data ?? []).map((t) => ({ value: String(t.id), label: termLabel(t.name) }))]} {...register('payment_term_id')} />
              </Field>
              <Field label="Credit limit" error={err('credit_limit')} hint="Warn before invoicing past this amount" htmlFor="f-limit">
                <Input id="f-limit" prefix="৳" align="right" mono {...register('credit_limit')} invalid={!!err('credit_limit')} placeholder="0.00" inputMode="decimal" />
              </Field>
              <Field label="Control ledger" hint="Where this balance rolls up">
                <Input readOnly value={party?.ledger_code ? `${party.ledger_code} · Sundry debtors` : '1201 · Sundry debtors'} aria-label="Control ledger" />
              </Field>
              <Field label="Tax registration number" error={err('tax_registration_no')} hint="Optional. Tax rules are set in Settings › Tax" htmlFor="f-tax">
                <Input id="f-tax" mono {...register('tax_registration_no')} placeholder="Leave blank if not registered" />
              </Field>
            </div>
          </Card>

          <Card title="Notes" subtitle="Visible to your team only">
            <textarea aria-label="Notes" {...register('notes')}
              style={{ width: '100%', minHeight: 84, boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', font: '14px/20px var(--font-sans)', color: 'var(--ink)', background: 'var(--surface)', resize: 'vertical' }} />
          </Card>

          {mode === 'edit' && party && (
            <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 560 }}>
                <span style={{ font: '600 15px/20px var(--font-sans)' }}>{party.status === 'inactive' ? 'Reactivate customer' : 'Make customer inactive'}</span>
                <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--ink-muted)' }}>Hides them from new invoices. Their ledger and past documents stay. You can reactivate them any time.</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {party.status === 'inactive'
                  ? <Button variant="secondary" icon="check" onClick={() => void runAction('reactivate')} loading={action.isPending}>Reactivate</Button>
                  : <Button variant="secondary" icon="x" onClick={() => void runAction('deactivate')} loading={action.isPending}>Make inactive</Button>}
                {can('parties.delete') && !party.opening_locked && <Button variant="ghost" icon="trash-2" onClick={() => setConfirmDelete(true)}>Delete</Button>}
              </div>
            </section>
          )}
        </div>

        <aside className="lf-c4 lf-form-aside" style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 16 }}>
          <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span className="lf-label">Before you save</span>
            {checklist.map((c) => (
              <div key={c.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', flex: 'none', display: 'grid', placeItems: 'center',
                  background: c.info ? 'var(--info-soft)' : c.ok ? 'var(--positive-soft)' : 'var(--negative-soft)', color: c.info ? 'var(--info)' : c.ok ? 'var(--positive)' : 'var(--negative)' }}>
                  <Icon name={c.info ? 'info' : c.ok ? 'check' : 'x'} size={14} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600 }}>{c.title}</span>
                  <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--ink-muted)' }}>{c.body}</span>
                </span>
              </div>
            ))}
          </section>
          {mode === 'edit' && party && (
            <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="lf-label">Current balance</span>
              <span className="lf-num" style={{ font: '500 22px/28px var(--font-serif)' }}>{formatTaka(party.balance, { symbol: true })} {party.balance_side === 'cr' ? 'Cr' : 'Dr'}</span>
              <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>From posted entries on ledger {party.ledger_code}</span>
            </section>
          )}
        </aside>
      </div>

      <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, margin: '0 -24px -48px', padding: '12px 24px', background: 'var(--surface)', borderTop: '1px solid var(--line)', boxShadow: '0 -4px 12px rgba(19,32,47,.05)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        {mode === 'edit' && isDirty && <Badge tone="accent" dot>Unsaved changes</Badge>}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={cancel}>Cancel</Button>
        {mode === 'add' && <Button variant="secondary" type="submit" disabled={isSubmitting} onClick={() => { addAnother.current = true }}>Save and add another</Button>}
        <Button variant="primary" icon="check" kbd="Ctrl S" type="submit" loading={isSubmitting} disabled={isSubmitting} onClick={() => { addAnother.current = false }} data-testid="save-customer">
          {mode === 'edit' ? 'Save changes' : 'Save customer'}
        </Button>
      </div>

      {guard.dialog}
      {confirmDelete && party && (
        <DeleteDialog name={party.name} what="customer" description="Only customers without any transactions can be deleted. This cannot be undone."
          loading={action.isPending} onConfirm={() => void runAction('delete')} onClose={() => setConfirmDelete(false)} />
      )}
    </form>
  )
}
