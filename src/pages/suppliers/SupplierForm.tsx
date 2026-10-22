import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { Ledger, PageMeta, Party } from '../../api/contract.gen'
import { useCreateParty, useParty, usePartyAction, usePaymentTerms, useUpdateParty } from '../../api/parties'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { countryName, defaultCurrency, SUPPLIER_COUNTRIES } from '../../lib/countries'
import { formatTaka, termLabel } from '../../lib/format'
import { applyProblemToForm } from '../../lib/forms'
import { emptySupplier, supplierFieldMap, supplierSchema, toSupplierInput, type SupplierFormParsed, type SupplierFormValues } from '../../lib/supplierSchema'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ConflictBanner } from '../../components/ConflictBanner'
import { DeleteDialog } from '../../components/DeleteDialog'
import { FormErrorSummary } from '../../components/FormErrorSummary'
import { PageSkeleton } from '../../components/PageSkeleton'
import { PartyGroupField } from '../../components/PartyGroupField'
import { LedgerPicker } from '../../components/pickers/LedgerPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden, NotFound } from '../../components/states'

/** Districts offered by the design (Parties.dc.html districtOptions). */
const DISTRICTS = ['Dhaka', 'Chattogram', 'Gazipur', 'Narayanganj', 'Cumilla', 'Sylhet', 'Rajshahi', 'Khulna', 'Bogura', 'Naogaon']
const TYPES = [{ value: '', label: 'Choose…' }, { value: 'manufacturer', label: 'Manufacturer' }, { value: 'distributor', label: 'Distributor' },
  { value: 'service_provider', label: 'Service provider' }, { value: 'individual', label: 'Individual' }]
const CURRENCIES = ['BDT', 'USD', 'CNY', 'INR', 'EUR', 'GBP', 'SGD', 'JPY']

/** C2 Add supplier / C3 Edit supplier (Supp-Add.dc.html, Supp-Edit.dc.html; backlog P2.2-FE-03). */
export function SupplierForm({ mode }: { mode: 'add' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const existing = useParty(mode === 'edit' ? id : 0)
  if (mode === 'add' && !can('parties.create')) return <Forbidden permission="parties.create" what="adding suppliers" />
  if (mode === 'edit' && !can('parties.edit')) return <Forbidden permission="parties.edit" what="editing suppliers" />
  if (mode === 'edit') {
    if (existing.error instanceof ApiError && existing.error.status === 404) return <NotFound what="this supplier" back="/suppliers" backLabel="Suppliers" />
    if (existing.error) return <ProblemBanner error={existing.error} onRetry={() => void existing.refetch()} />
    if (!existing.data) return <PageSkeleton template="form" />
    if (existing.data.party.party_type !== 'supplier') return <NotFound what="this supplier" back="/suppliers" backLabel="Suppliers" />
  }
  return <Form key={mode === 'edit' ? `${id}` : 'add'} mode={mode} party={existing.data?.party ?? null} />
}

function toForm(p: Party | null): SupplierFormValues {
  if (!p) return { ...emptySupplier }
  const cat = (['manufacturer', 'distributor', 'service_provider', 'individual'] as const).find((c) => c === p.category) ?? ''
  const bank = p.bank_accounts?.find((b) => b.is_default) ?? p.bank_accounts?.[0]
  return {
    name: p.name, category: cat, party_group_id: p.group ? String(p.group.id) : '', contact_person: p.contact_person ?? '',
    country_code: p.country_code || 'BD', default_currency_code: p.default_currency_code || 'BDT', mobile: p.mobile ?? '', email: p.email ?? '',
    alt_phone: p.alt_phone ?? '', address: p.address ?? '', district: p.district ?? '', area: p.area ?? '', port_of_loading: p.port_of_loading ?? '',
    payment_term_id: p.payment_term ? String(p.payment_term.id) : '', credit_limit: p.credit_limit ?? '',
    default_purchase_ledger_id: p.default_purchase_ledger_id ? String(p.default_purchase_ledger_id) : '', tax_registration_no: p.tax_registration_no ?? '',
    bank_name: bank?.bank_name ?? '', bank_account_name: bank?.account_name ?? '', bank_account_number: bank?.account_number ?? '', bank_branch: bank?.branch ?? '',
    notes: p.notes ?? '',
  }
}

/** The purchase ledgers the picker offers (purpose purchase_for_supplier, a short list), to show a saved choice by name. */
function usePurchaseLedgers(enabled: boolean) {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'ledgers', 'purchase_for_supplier'],
    queryFn: async () => (await api.request<{ data: Ledger[]; meta: PageMeta }>('GET', '/ledgers', { query: { purpose: 'purchase_for_supplier', per_page: 100 } })).data.data,
    staleTime: 5 * 60_000,
    enabled,
  })
}

function Form({ mode, party }: { mode: 'add' | 'edit'; party: Party | null }) {
  const { Card, Field, Input, Select, Button, Banner, Badge, Icon, PageHeader } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const terms = usePaymentTerms()
  const create = useCreateParty()
  const update = useUpdateParty(party?.id ?? 0)
  const action = usePartyAction(party?.id ?? 0)
  const idem = useIdempotencyKey()
  const [version, setVersion] = useState(party?.version ?? 0)
  const [conflict, setConflict] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const addAnother = useRef(false)
  const purchaseLedgers = usePurchaseLedgers(!!party?.default_purchase_ledger_id)
  useEffect(() => {
    if (party?.default_purchase_ledger_id && purchaseLedgers.data) setLedger(purchaseLedgers.data.find((l) => l.id === party.default_purchase_ledger_id) ?? null)
  }, [party?.default_purchase_ledger_id, purchaseLedgers.data])

  const defaults = useMemo(() => {
    const d = toForm(party)
    if (mode === 'add' && terms.data) d.payment_term_id = String(terms.data.find((t) => t.is_default)?.id ?? '')
    return d
  }, [party, mode, terms.data])
  const latestDefaults = useRef(defaults)
  latestDefaults.current = defaults
  const { register, handleSubmit, setError, reset, watch, setValue, formState: { errors, isDirty, isSubmitting, submitCount } } =
    useForm<SupplierFormValues, unknown, SupplierFormParsed>({ resolver: zodResolver(supplierSchema), defaultValues: defaults, mode: 'onSubmit' })
  useEffect(() => { reset(defaults, { keepDirtyValues: true, keepErrors: true, keepSubmitCount: true, keepTouched: true }) }, [defaults]) // eslint-disable-line react-hooks/exhaustive-deps
  const guard = useUnsavedChangesBlocker(isDirty, 'Your edits to this supplier have not been saved.')

  const country = watch('country_code')
  const local = country === 'BD'
  const errorCount = Object.keys(errors).length
  const err = (k: keyof SupplierFormValues) => errors[k]?.message as string | undefined
  const dirty = { shouldDirty: true, shouldValidate: submitCount > 0 }

  // A new country brings its usual trading currency, unless the user already chose one by hand.
  const autoCurrency = useRef(true)
  function changeCountry(next: string) {
    setValue('country_code', next, dirty)
    if (autoCurrency.current) setValue('default_currency_code', defaultCurrency(next), dirty)
  }

  async function onValid(values: SupplierFormParsed) {
    setFormError(null)
    setUnmatched([])
    setConflict(false)
    const input = toSupplierInput(values)
    try {
      if (mode === 'add') {
        const r = await create.mutateAsync({ input, idempotencyKey: idem.key })
        idem.reset()
        toast({ tone: 'positive', title: `${r.data.name} added as ${r.data.code}`, description: `Ledger ${r.data.ledger_code} created under Sundry creditors.` })
        for (const w of r.warnings ?? []) toast({ tone: 'warning', title: w.message })
        if (addAnother.current) { reset({ ...emptySupplier, payment_term_id: latestDefaults.current.payment_term_id }); setLedger(null); autoCurrency.current = true; return }
        reset(toForm(r.data))
        guard.allowNavigation()
        navigate(`/suppliers/${r.data.id}`)
      } else if (party) {
        const updated = await update.mutateAsync({ input, version })
        setVersion(updated.version)
        reset(toForm(updated))
        toast({ tone: 'positive', title: 'Changes saved', description: `${updated.name} · version ${updated.version}` })
        guard.allowNavigation()
        navigate(`/suppliers/${party.id}`)
      }
    } catch (e) {
      const placed = applyProblemToForm(e, setError, supplierFieldMap)
      if (placed) setUnmatched(placed.unmatched)
      else if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else setFormError(e)
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
        navigate('/suppliers')
      } else {
        toast({ tone: 'positive', title: a === 'deactivate' ? `${party?.name} is now inactive` : `${party?.name} is active again` })
        navigate(`/suppliers/${party?.id}`)
      }
    } catch (e) {
      setConfirmDelete(false)
      if (e instanceof ApiError && e.code === 'has_history') toast({ tone: 'warning', title: 'This supplier has transactions', description: 'Make it inactive instead.' })
      else setFormError(e)
    }
  }

  const cancel = () => navigate(mode === 'edit' && party ? `/suppliers/${party.id}` : '/suppliers')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void handleSubmit(onValid)() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 } as const
  const checklist = [
    { ok: !err('name') && !err('mobile'), title: local ? 'Name and mobile' : 'Name', body: local ? 'Both are required to issue documents.' : 'International suppliers need no Bangladeshi mobile.' },
    { info: true, title: 'Opening balance', body: 'Opening balances can be entered once accounting is live; locked after the first bill.' },
    { info: true, title: 'Purchase account', body: 'Optional. Used for non-stock lines on this supplier\'s bills.' },
    { ok: true, title: 'Ledger created for you', body: 'Posted under 2101 · Sundry creditors.' },
  ]

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate data-testid="supplier-form">
      <PageHeader eyebrow="Suppliers" title={mode === 'edit' ? `Edit ${party?.name}` : 'New supplier'}
        description={mode === 'edit' ? `${party?.code} · ${local ? [party?.area, party?.district].filter(Boolean).join(', ') || 'Bangladesh' : countryName(party?.country_code)}` : 'Fields marked * are required. Everything else can be added later.'} />
      <FormErrorSummary count={submitCount > 0 ? errorCount : 0} noun="supplier" messages={unmatched} />
      {conflict && <ConflictBanner onReload={() => void reloadLatest()} loading={reloading} />}
      <ProblemBanner error={formError} />
      {mode === 'edit' && party?.status === 'inactive' && <Banner tone="info" title="This supplier is inactive">It is hidden from new bills and purchase orders. Reactivate it below.</Banner>}
      {mode === 'edit' && party?.status !== 'inactive' && <Banner tone="info" title={`Editing ${party?.code}`}>Changes apply to new bills. Posted bills keep the details they were entered with.</Banner>}

      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
          <Card title="Basic details" subtitle="How this supplier appears on bills and in lists">
            <div style={grid}>
              <Field label="Supplier name" required error={err('name')} hint="As it appears on their invoices" htmlFor="f-name">
                <Input id="f-name" {...register('name')} invalid={!!err('name')} placeholder="e.g. Bengal Edible Oils Ltd." />
              </Field>
              <Field label="Supplier code" hint="Generated automatically">
                <Input mono readOnly value={party?.code ?? 'SUP-…'} aria-label="Supplier code" />
              </Field>
              <Field label="Type" htmlFor="f-category">
                <Select id="f-category" options={TYPES} {...register('category')} />
              </Field>
              <PartyGroupField type="supplier" id="f-group" value={watch('party_group_id')} error={err('party_group_id')}
                onChange={(v) => setValue('party_group_id', v, dirty)} />
            </div>
          </Card>

          <Card title="Contact" subtitle="Who to call about orders, deliveries and payments">
            <div style={grid}>
              <Field label="Contact person" error={err('contact_person')} htmlFor="f-person">
                <Input id="f-person" {...register('contact_person')} placeholder="Full name" />
              </Field>
              <Field label="Country" required error={err('country_code')} hint="Outside Bangladesh the mobile is optional" htmlFor="f-country">
                <Select id="f-country" value={country} onChange={(e) => changeCountry(e.target.value)}
                  options={[...new Set([...SUPPLIER_COUNTRIES, country])].map((c) => ({ value: c, label: countryName(c) }))} />
              </Field>
              <Field label="Mobile number" required={local} error={err('mobile')} hint={local ? '11 digits, starting 01' : 'With the country code, e.g. +86 20 3888 1234'} htmlFor="f-mobile">
                <Input id="f-mobile" {...(local ? { prefix: '+88' } : {})} mono {...register('mobile')} invalid={!!err('mobile')}
                  placeholder={local ? '01XXX-XXXXXX' : '+86 …'} inputMode="tel" />
              </Field>
              <Field label="Email" error={err('email')} htmlFor="f-email">
                <Input id="f-email" type="email" {...register('email')} invalid={!!err('email')} placeholder="name@company.com" />
              </Field>
              <Field label="Alternate number" error={err('alt_phone')} htmlFor="f-alt">
                <Input id="f-alt" mono {...register('alt_phone')} placeholder="Optional" />
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Address" error={err('address')} htmlFor="f-address">
                  <Input id="f-address" {...register('address')} placeholder={local ? 'House, road, area' : 'Street, city'} />
                </Field>
              </div>
              {local ? (<>
                <Field label="District" htmlFor="f-district">
                  <Select id="f-district" options={[{ value: '', label: 'Choose…' }, ...DISTRICTS]} {...register('district')} />
                </Field>
                <Field label="Area or thana" error={err('area')} htmlFor="f-area">
                  <Input id="f-area" {...register('area')} placeholder="e.g. Tejgaon" />
                </Field>
              </>) : (
                <Field label="Port of loading" error={err('port_of_loading')} hint="Used on LCs and import bills" htmlFor="f-port">
                  <Input id="f-port" {...register('port_of_loading')} placeholder="e.g. Guangzhou (Nansha)" />
                </Field>
              )}
            </div>
          </Card>

          <Card title="Accounting" subtitle="How this supplier is posted to your books">
            <div style={grid}>
              <Field label="Opening balance" term="What you already owed this supplier on the day you started using Pluto."
                hint="Opening balances can be entered once accounting is live">
                <Input prefix="৳" align="right" readOnly value={formatTaka(party?.opening_balance ?? '0.00')} aria-label="Opening balance" />
              </Field>
              <Field label="Payment terms" htmlFor="f-terms">
                <Select id="f-terms" options={[{ value: '', label: 'None' }, ...(terms.data ?? []).map((t) => ({ value: String(t.id), label: termLabel(t.name) }))]} {...register('payment_term_id')} />
              </Field>
              <Field label="Credit limit" error={err('credit_limit')} hint="The most they let you owe them" htmlFor="f-limit">
                <Input id="f-limit" prefix="৳" align="right" mono {...register('credit_limit')} invalid={!!err('credit_limit')} placeholder="0.00" inputMode="decimal" />
              </Field>
              <Field label="Trading currency" error={err('default_currency_code')} htmlFor="f-currency">
                <Select id="f-currency" value={watch('default_currency_code')} options={[...new Set([...CURRENCIES, watch('default_currency_code')])]}
                  onChange={(e) => { autoCurrency.current = false; setValue('default_currency_code', e.target.value, dirty) }} />
              </Field>
              <Field label="Default purchase account" error={err('default_purchase_ledger_id')} hint="For non-stock lines on this supplier's bills" htmlFor="f-ledger">
                <LedgerPicker id="f-ledger" purpose="purchase_for_supplier" value={ledger} invalid={!!err('default_purchase_ledger_id')} aria-label="Default purchase account"
                  onChange={(l) => { setLedger(l); setValue('default_purchase_ledger_id', l ? String(l.id) : '', dirty) }} />
              </Field>
              <Field label="Control ledger" hint="Where this balance rolls up">
                <Input readOnly value={party?.ledger_code ? `${party.ledger_code} · Sundry creditors` : '2101 · Sundry creditors'} aria-label="Control ledger" />
              </Field>
              <Field label="Tax registration number" error={err('tax_registration_no')} hint="Optional (BIN/VAT registration)" htmlFor="f-tax">
                <Input id="f-tax" mono {...register('tax_registration_no')} placeholder="Leave blank if not registered" />
              </Field>
            </div>
          </Card>

          <Card title="Payment details" subtitle="Where you send their payments">
            <div style={grid}>
              <Field label="Bank" error={err('bank_name')} htmlFor="f-bank">
                <Input id="f-bank" {...register('bank_name')} placeholder="e.g. Dutch-Bangla Bank" />
              </Field>
              <Field label="Account name" error={err('bank_account_name')} htmlFor="f-acname">
                <Input id="f-acname" {...register('bank_account_name')} />
              </Field>
              <Field label="Account number" error={err('bank_account_number')} htmlFor="f-acno">
                <Input id="f-acno" mono {...register('bank_account_number')} />
              </Field>
              <Field label="Branch" error={err('bank_branch')} htmlFor="f-branch">
                <Input id="f-branch" {...register('bank_branch')} />
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
                <span style={{ font: '600 15px/20px var(--font-sans)' }}>{party.status === 'inactive' ? 'Reactivate supplier' : 'Make supplier inactive'}</span>
                <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--ink-muted)' }}>Hides them from new bills and purchase orders. Their ledger and past documents stay. You can reactivate them any time.</span>
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
              <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{party.balance_side === 'cr' ? 'You owe them' : 'Advance paid'} · ledger {party.ledger_code}</span>
            </section>
          )}
        </aside>
      </div>

      <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, margin: '0 -24px -48px', padding: '12px 24px', background: 'var(--surface)', borderTop: '1px solid var(--line)', boxShadow: '0 -4px 12px rgba(19,32,47,.05)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        {mode === 'edit' && isDirty && <Badge tone="accent" dot>Unsaved changes</Badge>}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={cancel}>Cancel</Button>
        {mode === 'add' && <Button variant="secondary" type="submit" disabled={isSubmitting} onClick={() => { addAnother.current = true }}>Save and add another</Button>}
        <Button variant="primary" icon="check" kbd="Ctrl S" type="submit" loading={isSubmitting} disabled={isSubmitting} onClick={() => { addAnother.current = false }} data-testid="save-supplier">
          {mode === 'edit' ? 'Save changes' : 'Save supplier'}
        </Button>
      </div>

      {guard.dialog}
      {confirmDelete && party && (
        <DeleteDialog name={party.name} what="supplier" description="Only suppliers without any transactions can be deleted. This cannot be undone."
          loading={action.isPending} onConfirm={() => void runAction('delete')} onClose={() => setConfirmDelete(false)} />
      )}
    </form>
  )
}
