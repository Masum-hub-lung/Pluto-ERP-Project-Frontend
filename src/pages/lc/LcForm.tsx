import { useMemo, useRef, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { LetterOfCredit, Party } from '../../api/contract.gen'
import { useWarehouses } from '../../api/inventory'
import { useCreateLc, useDeleteLc, useLc, useLcTemplates, useUpdateLc } from '../../api/lc'
import { useMoneyAccounts } from '../../api/money'
import { useParty } from '../../api/parties'
import { purchaseOrders } from '../../api/trade'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { applyProblemToForm } from '../../lib/forms'
import { itemErrors, itemNames, sentIndexes, type LcItemRow } from '../../lib/lcItems'
import { editBody, LC_SECTIONS, lcFieldMap, lcSchema, lcToForm, missingForSubmit, toLcInput, type LcFormValues } from '../../lib/lcSchema'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ConflictBanner } from '../../components/ConflictBanner'
import { DeleteDialog } from '../../components/DeleteDialog'
import { FormErrorSummary } from '../../components/FormErrorSummary'
import { PageSkeleton } from '../../components/PageSkeleton'
import { PartyPicker } from '../../components/pickers/PartyPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden, NotFound } from '../../components/states'
import { LcItemsEditor } from './LcItemsEditor'

/**
 * M3 Create LC (LC-Create*.dc.html; backlog P16.2-FE): six sections in any order, save a draft or submit to the bank.
 * Only a draft or an LC awaiting the bank is edited here; an opened LC changes through amendments (BR-041).
 * Items (PEP-487): entered here (the default) or taken from an existing purchase order. Entered items are kept by the
 * server on a purchase order it creates, so a bill from the LC fills itself; their total comes back as `lines_total`.
 */
export function LcForm({ mode }: { mode: 'new' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const lc = useLc(mode === 'edit' ? id : 0)
  const party = useParty(lc.data?.party.id ?? 0)
  if (!can(mode === 'new' ? 'lc.create' : 'lc.edit')) return <Forbidden permission={mode === 'new' ? 'lc.create' : 'lc.edit'} what={mode === 'new' ? 'raising LCs' : 'editing LCs'} />
  if (mode === 'edit') {
    if (lc.error instanceof ApiError && lc.error.status === 404) return <NotFound what="this LC" back="/lc/list" backLabel="Letters of credit" />
    if (lc.error) return <ProblemBanner error={lc.error} onRetry={() => void lc.refetch()} />
    if (!lc.data || (!party.data && !party.error)) return <PageSkeleton template="form" />
    if (!['draft', 'awaiting_bank'].includes(lc.data.status)) return <Navigate to={`/lc/${id}`} replace />
  }
  return <Editor key={mode === 'edit' ? id : 'new'} lc={lc.data ?? null} party={party.data?.party ?? null} />
}

const INCOTERMS = ['FOB', 'CFR', 'CIF', 'CFR Chattogram', 'CIF Chattogram', 'EXW', 'FCA', 'CPT', 'CIP', 'DAP']
const CURRENCIES = ['USD', 'EUR', 'CNY', 'GBP', 'JPY', 'INR']

function Editor({ lc, party }: { lc: LetterOfCredit | null; party: Party | null }) {
  const { Card, Field, Input, Select, Segmented, Switch, Button, Banner, PageHeader, IconButton } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const creating = !lc
  const create = useCreateLc()
  const update = useUpdateLc(lc?.id ?? 0)
  const del = useDeleteLc(lc?.id ?? 0)
  const idem = useIdempotencyKey()
  const banks = useMoneyAccounts({ purpose: 'payments' })
  const templates = useLcTemplates()
  const warehouses = useWarehouses()
  const autoGoods = useRef('')
  const [version, setVersion] = useState(lc?.version ?? 0)
  const [conflict, setConflict] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const defaults = useMemo(() => lcToForm(lc, party), [lc, party])
  const { control, register, watch, setValue, setError, handleSubmit, reset, formState: { errors, isDirty, dirtyFields, submitCount } } =
    useForm<LcFormValues>({ resolver: zodResolver(lcSchema) as never, defaultValues: defaults })
  const docs = useFieldArray({ control, name: 'documents' })
  const guard = useUnsavedChangesBlocker(isDirty, 'Your edits to this LC have not been saved.')
  const v = watch()
  const pos = purchaseOrders.useList({ party_id: v.party?.id, per_page: 50 }, !!v.party)
  const err = (k: keyof LcFormValues) => (errors[k] as { message?: string } | undefined)?.message
  const sectionHasError = (fields: readonly string[]) => fields.some((f) => f in errors)
  const errorCount = Object.keys(errors).length
  const bankOptions = (banks.data ?? []).filter((a) => a.account_type === 'bank' || a.account_type === 'cash_credit')

  async function save(values: LcFormValues): Promise<LetterOfCredit | null> {
    setFormError(null); setUnmatched([]); setConflict(false); setMissing([])
    try {
      if (creating) {
        const r = await create.mutateAsync({ input: toLcInput(values, true), idempotencyKey: idem.key })
        idem.reset()
        return r
      }
      const r = await update.mutateAsync({ input: editBody(toLcInput(values, false), dirtyFields as never), version })
      setVersion(r.version)
      reset(values)
      return r
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else if (e instanceof ApiError && e.status === 422) {
        // lines.N.* (N counts the items sent) go under their rows; the rest to their fields or the summary.
        const rows = itemErrors(e.fieldErrors, sentIndexes(values.lines))
        for (const [path, message] of Object.entries(rows)) setError(`lines.${path}` as never, { type: 'server', message })
        const placed = applyProblemToForm(e, setError as never, lcFieldMap as never)
        if (placed) setUnmatched(placed.unmatched.filter((m) => !Object.values(rows).includes(m))); else setFormError(e)
      } else setFormError(e)
      return null
    }
  }

  const run = (then: (r: LetterOfCredit) => Promise<void> | void) => handleSubmit(async (values) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      const r = await save(values)
      if (r) await then(r)
    } finally {
      busyRef.current = false; setBusy(false)
    }
  })

  const saveDraft = run((r) => {
    toast({ tone: 'positive', title: `${r.lc_number} saved`, description: r.status === 'draft' ? 'Draft · not sent to the bank yet' : 'Saved' })
    guard.allowNavigation()
    navigate(`/lc/${r.id}`)
  })

  const submit = run(async (r) => {
    if (r.status !== 'draft') { guard.allowNavigation(); navigate(`/lc/${r.id}`); return }
    try {
      const s = await api.request<{ data: LetterOfCredit }>('POST', `/letters-of-credit/${r.id}/transition`, { body: { action: 'submit' }, ifMatch: `W/"${r.version}"` })
      toast({ tone: 'positive', title: `${s.data.data.lc_number} submitted to the bank`, description: 'Mark it opened when the bank confirms.' })
      guard.allowNavigation()
      navigate(`/lc/${r.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'lc_submit_incomplete') {
        setMissing(Object.values(e.fieldErrors).map((m) => m[0]!))
        if (creating) { guard.allowNavigation(); navigate(`/lc/${r.id}/edit`, { replace: true }) }
        toast({ tone: 'warning', title: `${r.lc_number} saved as a draft`, description: 'Go back to the marked sections. You can still save a draft.' })
      } else setFormError(e)
    }
  })

  async function doDelete() {
    try {
      await del.mutateAsync()
      toast({ tone: 'positive', title: 'Draft deleted', description: `${lc?.lc_number} is voided and will not be reused.` })
      guard.allowNavigation()
      navigate('/lc/list')
    } catch (e) {
      setConfirmDelete(false); setFormError(e)
    }
  }

  const go = (key: string) => document.getElementById(`lc-sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 } as const
  const reviewMissing = missingForSubmit(v)
  const lineErrors = Object.fromEntries(((Array.isArray(errors.lines) ? errors.lines : []) as Array<Record<string, { message?: string }> | undefined>)
    .flatMap((row, i) => Object.entries(row ?? {}).flatMap(([f, x]) => (x?.message ? [[`${i}.${f}`, x.message] as const] : []))))
  const setLines = (rows: LcItemRow[]) => {
    setValue('lines', rows, { shouldDirty: true, shouldValidate: submitCount > 0 })
    // The bank wording of the goods starts as the item names, until the user writes their own.
    const names = itemNames(rows)
    const current = v.goods_description.trim()
    if (names && (current === '' || current === autoGoods.current)) {
      setValue('goods_description', names, { shouldDirty: true, shouldValidate: submitCount > 0 })
      autoGoods.current = names
    }
  }
  const activeWarehouses = (warehouses.data ?? []).filter((w) => w.status === 'active' || String(w.id) === v.warehouse_id)

  return (
    <form onSubmit={(e) => { e.preventDefault(); void saveDraft() }} noValidate data-testid="lc-form">
      <PageHeader eyebrow="LC Management" title={creating ? 'New letter of credit' : `Edit ${lc.lc_number}`}
        description={creating ? 'Fill the sections in any order. A draft needs only the supplier, goods and amount; submitting needs the issuing bank and expiry too.'
          : `${lc.status === 'draft' ? 'Draft' : 'Awaiting bank'} · ${lc.party.name}`} />
      <Banner tone="info">The planning rate is only for planning; payments are booked at the rate the bank applies.</Banner>
      <div style={{ height: 12 }} />
      <FormErrorSummary count={submitCount > 0 ? errorCount : 0} noun="LC" messages={unmatched} />
      {missing.length > 0 && <Banner tone="warning" title="Not ready for the bank">Go back to the marked sections. You can still save a draft. Missing: {missing.join('; ')}</Banner>}
      {conflict && <ConflictBanner onReload={() => window.location.reload()} />}
      <ProblemBanner error={formError} />

      <nav aria-label="Sections" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }} data-testid="lc-sections">
        {LC_SECTIONS.map((s, i) => (
          <Button key={s.key} size="sm" variant="ghost" onClick={() => go(s.key)}>{sectionHasError(s.fields) ? '! ' : ''}{i + 1}. {s.label}</Button>
        ))}
      </nav>

      <div style={{ display: 'grid', gap: 16 }}>
        <section id="lc-sec-supplier"><Card title="1. Supplier and purchase">
          <div style={grid}>
            <Field label="International supplier" required error={err('party')}>
              <PartyPicker type="supplier" value={v.party} onChange={(p) => setValue('party', p, { shouldDirty: true, shouldValidate: submitCount > 0 })} aria-label="Supplier" />
            </Field>
            <Field label="Items">
              <Segmented value={v.link} onChange={(x) => setValue('link', x as 'items' | 'po', { shouldDirty: true })} options={[{ value: 'items', label: 'Enter the items' }, { value: 'po', label: 'Existing purchase order' }]} />
            </Field>
            {v.link === 'po'
              ? <Field label="Purchase order" htmlFor="lc-po" error={err('purchase_order_id')}>
                  <Select id="lc-po" {...register('purchase_order_id')} options={[{ value: '', label: v.party ? 'Choose a purchase order' : 'Choose the supplier first' },
                    ...(pos.data?.data ?? []).map((p) => ({ value: String(p.id), label: p.number }))]} />
                </Field>
              : <Field label="Arrival warehouse" htmlFor="lc-warehouse" error={err('warehouse_id')} hint="Where the goods will be received">
                  <Select id="lc-warehouse" {...register('warehouse_id')} invalid={!!errors.warehouse_id}
                    options={[{ value: '', label: 'Head office warehouse' }, ...activeWarehouses.map((w) => ({ value: String(w.id), label: w.name }))]} />
                </Field>}
            {v.link === 'items' && <Field label="Intended import" htmlFor="lc-intended"><Input id="lc-intended" {...register('intended_import')} placeholder="e.g. Q3 palm oil" /></Field>}
            <Field label="Goods description" htmlFor="lc-goods" required error={err('goods_description')}>
              <Input id="lc-goods" {...register('goods_description')} invalid={!!errors.goods_description} />
            </Field>
            <Field label="Quantity" htmlFor="lc-qty" error={err('quantity')}><Input id="lc-qty" inputMode="decimal" {...register('quantity')} /></Field>
            <Field label="Unit" htmlFor="lc-unit"><Input id="lc-unit" {...register('quantity_unit')} placeholder="kg, MT, pcs" /></Field>
            <Field label="Import authorization reference" htmlFor="lc-iar"><Input id="lc-iar" {...register('import_authorization_ref')} placeholder="IRC / LCA number" /></Field>
          </div>
          {v.link === 'items' && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }} data-testid="lc-items-section">
              <h3 style={{ margin: '0 0 4px', font: '600 17px/24px var(--font-serif)' }}>Items on this LC</h3>
              <p style={{ margin: '0 0 12px', color: 'var(--ink-muted)', fontSize: 13 }}>
                What the LC covers, at the unit cost in {v.currency_code}. A purchase bill made from this LC fills itself with these items.
              </p>
              <LcItemsEditor rows={v.lines} onChange={setLines} errors={lineErrors} currency={v.currency_code} />
              {err('lines') && <div role="alert" style={{ color: 'var(--negative)', fontSize: 13, marginTop: 8 }}>{err('lines')}</div>}
              <p style={{ margin: '12px 0 0', color: 'var(--ink-muted)', fontSize: 13 }} data-testid="lc-items-total">
                {!creating && lc.lines_total && !dirtyFields.lines
                  ? <>Items total: <span className="lf-mono">{lc.currency_code} {lc.lines_total}</span></>
                  : 'The items total is worked out when you save.'}
              </p>
            </div>
          )}
        </Card></section>

        <section id="lc-sec-terms"><Card title="2. Terms and amount">
          <div style={grid}>
            <Field label="LC type" htmlFor="lc-type">
              <Select id="lc-type" {...register('lc_type')} options={[{ value: 'irrevocable', label: 'Irrevocable' }, { value: 'irrevocable_transferable', label: 'Irrevocable transferable' }, { value: 'standby', label: 'Standby' }]} />
            </Field>
            <Field label="Payment tenor">
              <Segmented value={v.tenor} onChange={(x) => setValue('tenor', x as 'sight' | 'usance', { shouldDirty: true })} options={[{ value: 'sight', label: 'At sight' }, { value: 'usance', label: 'Usance' }]} />
            </Field>
            {v.tenor === 'usance' && <Field label="Usance days" htmlFor="lc-usance" required error={err('usance_days')}><Input id="lc-usance" inputMode="numeric" {...register('usance_days')} invalid={!!errors.usance_days} /></Field>}
            <Field label="Incoterm" htmlFor="lc-incoterm" required error={err('incoterm')}><Select id="lc-incoterm" {...register('incoterm')} options={INCOTERMS} /></Field>
            <Field label="Currency" htmlFor="lc-currency" required error={err('currency_code')}><Select id="lc-currency" {...register('currency_code')} options={CURRENCIES} /></Field>
            <Field label={`LC amount (${v.currency_code})`} htmlFor="lc-amount" required error={err('amount')}>
              <Input id="lc-amount" inputMode="decimal" align="right" mono {...register('amount')} invalid={!!errors.amount} />
            </Field>
            <Field label="Tolerance %" htmlFor="lc-tol" error={err('tolerance_pct')}><Input id="lc-tol" inputMode="decimal" align="right" {...register('tolerance_pct')} placeholder="0" /></Field>
            <Field label="Planning exchange rate" htmlFor="lc-rate" required error={err('planning_rate')} hint={`৳ per ${v.currency_code}`}>
              <Input id="lc-rate" inputMode="decimal" align="right" mono {...register('planning_rate')} invalid={!!errors.planning_rate} />
            </Field>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 16 }}>
            <Switch label="Partial shipments" checked={v.partial_shipments} onChange={(c: boolean) => setValue('partial_shipments', c, { shouldDirty: true })} />
            <Switch label="Transhipment" checked={v.transhipment} onChange={(c: boolean) => setValue('transhipment', c, { shouldDirty: true })} />
            <Switch label="Confirmation" checked={v.confirmation_required} onChange={(c: boolean) => setValue('confirmation_required', c, { shouldDirty: true })} />
          </div>
        </Card></section>

        <section id="lc-sec-banks"><Card title="3. Banks and dates">
          <div style={grid}>
            <Field label="Issuing bank" htmlFor="lc-bank" error={err('issuing_bank_account_id')} hint="Needed to submit">
              <Select id="lc-bank" {...register('issuing_bank_account_id')} options={[{ value: '', label: 'Choose our bank account' }, ...bankOptions.map((a) => ({ value: String(a.id), label: a.name }))]} />
            </Field>
            <Field label="Advising bank" htmlFor="lc-adv"><Input id="lc-adv" {...register('advising_bank')} placeholder="Optional" /></Field>
            <Field label="Margin deposit %" htmlFor="lc-margin" error={err('margin_pct')}><Input id="lc-margin" inputMode="decimal" align="right" {...register('margin_pct')} placeholder="0" /></Field>
            <Field label="Margin from account" htmlFor="lc-margin-acc" error={err('margin_account_id')}>
              <Select id="lc-margin-acc" {...register('margin_account_id')} options={[{ value: '', label: 'Same as the issuing bank' }, ...(banks.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} />
            </Field>
            <Field label="Application date" htmlFor="lc-app" error={err('application_date')}><Input id="lc-app" type="date" {...register('application_date')} /></Field>
            <Field label="Latest shipment date" htmlFor="lc-lsd" error={err('latest_shipment_date')}><Input id="lc-lsd" type="date" {...register('latest_shipment_date')} /></Field>
            <Field label="Expiry date" htmlFor="lc-expiry" error={err('expiry_date')} hint="Needed to submit"><Input id="lc-expiry" type="date" {...register('expiry_date')} invalid={!!errors.expiry_date} /></Field>
            <Field label="Presentation period (days)" htmlFor="lc-pres" error={err('presentation_days')}><Input id="lc-pres" inputMode="numeric" {...register('presentation_days')} placeholder="21" /></Field>
          </div>
        </Card></section>

        <section id="lc-sec-documents"><Card title="4. Documents" subtitle={creating ? 'Copy a checklist template, or list the documents yourself' : 'Documents are kept on the LC; add or update them on its Documents tab'}>
          {creating ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label="Template" htmlFor="lc-template">
                <Select id="lc-template" {...register('document_template_id')} options={[{ value: '', label: 'No template — the list below' }, ...(templates.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))]} />
              </Field>
              {!v.document_template_id && <>
                {docs.fields.map((f, i) => (
                  <div key={f.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr) 80px 44px', gap: 8, alignItems: 'end' }}>
                    <Field label={i === 0 ? 'Document' : undefined}><Input aria-label={`Document ${i + 1}`} {...register(`documents.${i}.name`)} /></Field>
                    <Field label={i === 0 ? 'Provided by' : undefined}><Input aria-label={`Provided by ${i + 1}`} {...register(`documents.${i}.provided_by`)} /></Field>
                    <Field label={i === 0 ? 'Copies' : undefined}><Input aria-label={`Copies ${i + 1}`} inputMode="numeric" {...register(`documents.${i}.copies`)} /></Field>
                    <IconButton icon="trash-2" label={`Remove document ${i + 1}`} onClick={() => docs.remove(i)} />
                  </div>
                ))}
                <div><Button size="sm" variant="secondary" icon="plus" onClick={() => docs.append({ name: '', provided_by: 'Supplier', copies: '1' })}>Add document</Button></div>
              </>}
            </div>
          ) : <p style={{ margin: 0, color: 'var(--ink-muted)' }}>{lc.documents?.length ?? 0} documents on the checklist.</p>}
        </Card></section>

        <section id="lc-sec-shipment"><Card title="5. Shipment (optional)">
          {creating ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <Switch label="Record shipment information" checked={v.record_shipments} onChange={(c: boolean) => setValue('record_shipments', c, { shouldDirty: true })} />
              {v.record_shipments && <div style={grid}>
                <Field label="Port of loading" htmlFor="lc-pol"><Input id="lc-pol" {...register('port_of_loading')} /></Field>
                <Field label="Port of discharge" htmlFor="lc-pod"><Input id="lc-pod" {...register('port_of_discharge')} placeholder="Chattogram" /></Field>
                <Field label="Expected arrival" htmlFor="lc-eta"><Input id="lc-eta" type="date" {...register('eta')} /></Field>
                <Field label="Mode" htmlFor="lc-mode"><Select id="lc-mode" {...register('mode')} options={[{ value: 'sea', label: 'Sea' }, { value: 'air', label: 'Air' }, { value: 'road', label: 'Road' }]} /></Field>
              </div>}
            </div>
          ) : <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Shipment lots are kept on the LC's Shipment tab.</p>}
        </Card></section>

        <section id="lc-sec-review"><Card title="6. Review">
          {reviewMissing.length === 0
            ? <p style={{ margin: 0 }} data-testid="lc-review-ready">Ready to submit to the bank.</p>
            : <div data-testid="lc-review-missing"><p style={{ margin: '0 0 6px' }}>Still needed to submit:</p><ul style={{ margin: 0 }}>{reviewMissing.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        </Card></section>
      </div>

      <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', padding: '12px 0', background: 'var(--canvas, var(--surface))', marginTop: 16 }}>
        {!creating && lc.status === 'draft' && can('lc.delete') && <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete draft</Button>}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={() => navigate(creating ? '/lc/list' : `/lc/${lc.id}`)}>Cancel</Button>
        <Button variant="secondary" loading={busy} onClick={() => void saveDraft()} data-shortcut="save" data-testid="lc-save-draft">Save draft</Button>
        {(creating || lc.status === 'draft') && <Button variant="primary" loading={busy} onClick={() => void submit()} data-shortcut="primary" data-testid="lc-submit">Submit to bank</Button>}
      </div>
      {confirmDelete && lc && <DeleteDialog name={lc.lc_number} what="draft LC" loading={del.isPending} onConfirm={() => void doDelete()} onClose={() => setConfirmDelete(false)} />}
      {guard.dialog}
    </form>
  )
}
