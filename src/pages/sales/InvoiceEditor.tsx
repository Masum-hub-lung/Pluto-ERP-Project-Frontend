import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { Party, SalesInvoice } from '../../api/contract.gen'
import { useTaxRules, useWarehouses } from '../../api/inventory'
import { useParty, usePaymentTerms } from '../../api/parties'
import { dhakaToday } from '../../api/platform'
import { calculateInvoice, useCreateInvoice, useDeleteInvoice, useInvoice, usePostInvoice, useUpdateInvoice } from '../../api/sales'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { deliveryChanged, invoiceFieldMap, invoiceSchema, invoiceToForm, tierPrice, toDeliveryUpdate, toInvoiceInput, type InvoiceFormValues } from '../../lib/invoiceSchema'
import { applyProblemToForm } from '../../lib/forms'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ConflictBanner } from '../../components/ConflictBanner'
import { DeleteDialog } from '../../components/DeleteDialog'
import { DocumentFooter } from '../../components/document/DocumentFooter'
import { DocumentHeader } from '../../components/document/DocumentHeader'
import { LineGrid } from '../../components/document/LineGrid'
import { completeIndexes, mapResults, remapLineErrors } from '../../components/document/lines'
import { PartyPanel } from '../../components/document/PartyPanel'
import { PostDialog } from '../../components/document/PostDialog'
import { TotalsPanel } from '../../components/document/TotalsPanel'
import { useCalculate } from '../../components/document/useCalculate'
import { FormErrorSummary } from '../../components/FormErrorSummary'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden, NotFound } from '../../components/states'

/**
 * E3 Create / E6 Edit draft sales invoice (Sal-Create.dc.html, Sal-Edit.dc.html; backlog P5.2-FE-03/04). Drafts only:
 * a posted or cancelled invoice opens E5 instead. Every figure, warning and stock check comes from POST
 * /sales-invoices/calculate (300 ms after the last change); credit-limit and overdue warnings show but never block
 * (BR-015), stock shortfall shows under its line. A chosen item takes the customer's tier price. "Save and post" saves,
 * then asks in the PostDialog (a new invoice is saved first and reopened at its edit route with ?post=1); "Preview"
 * saves and opens E4. Delivery details are saved after the invoice with PATCH …/delivery.
 */
export function InvoiceEditor({ mode }: { mode: 'new' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const invoice = useInvoice(mode === 'edit' ? id : 0)
  const party = useParty(invoice.data?.party.id ?? 0)
  if (mode === 'new' && !can('sales.create')) return <Forbidden permission="sales.create" what="creating sales invoices" />
  if (mode === 'edit' && !can('sales.edit')) return <Forbidden permission="sales.edit" what="editing sales invoices" />
  if (mode === 'edit') {
    if (invoice.error instanceof ApiError && invoice.error.status === 404) return <NotFound what="this invoice" back="/sales/invoices" backLabel="Sales invoices" />
    if (invoice.error) return <ProblemBanner error={invoice.error} onRetry={() => void invoice.refetch()} />
    if (!invoice.data) return <PageSkeleton template="form" />
    if (invoice.data.status !== 'draft') return <Navigate to={`/sales/invoices/${id}`} replace />
    if (!party.data && !party.error) return <PageSkeleton template="form" />
  }
  return <Editor key={mode === 'edit' ? id : 'new'} mode={mode} invoice={invoice.data ?? null} party={party.data?.party ?? null} />
}

function Editor({ mode, invoice, party }: { mode: 'new' | 'edit'; invoice: SalesInvoice | null; party: Party | null }) {
  const { Card, Field, Input, Select, PageHeader, Badge, Button, Banner } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const taxRules = useTaxRules()
  const warehouses = useWarehouses()
  const terms = usePaymentTerms()
  const create = useCreateInvoice()
  const update = useUpdateInvoice(invoice?.id ?? 0)
  const qc = useQueryClient()
  const del = useDeleteInvoice(invoice?.id ?? 0)
  const post = usePostInvoice(invoice?.id ?? 0)
  const saveIdem = useIdempotencyKey()
  const postIdem = useIdempotencyKey()
  const [version, setVersion] = useState(invoice?.version ?? 0)
  const [current, setCurrent] = useState(invoice)
  const [conflict, setConflict] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [posting, setPosting] = useState(mode === 'edit' && params.get('post') === '1')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showDelivery, setShowDelivery] = useState(!!invoice?.delivery)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false) // set synchronously: a double click fires before the disabled button renders

  const today = dhakaToday()
  const defaults = useMemo(() => invoiceToForm(invoice, party, today), [invoice, party, today])
  const { control, register, watch, setValue, setError, handleSubmit, reset, formState: { errors, isDirty, submitCount } } =
    useForm<InvoiceFormValues>({ resolver: zodResolver(invoiceSchema) as never, defaultValues: defaults, mode: 'onSubmit' })
  const guard = useUnsavedChangesBlocker(isDirty, 'Your edits to this invoice have not been saved.')
  useEffect(() => { if (params.has('post')) setParams((p) => { p.delete('post'); return p }, { replace: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The first active warehouse is the default "Dispatch from" for a new invoice.
  useEffect(() => {
    if (mode === 'new' && !watch('warehouse_id') && warehouses.data) {
      const w = warehouses.data.find((x) => x.status === 'active')
      if (w) setValue('warehouse_id', String(w.id))
    }
  }, [warehouses.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const values = watch()
  const indexes = completeIndexes(values.lines)
  const calcInput = values.party && values.warehouse_id && values.date && indexes.length ? JSON.stringify(toInvoiceInput(values)) : null
  const calc = useCalculate(calcInput, (s: string, signal: AbortSignal) => calculateInvoice(JSON.parse(s), signal))
  const lineWarnings: Record<number, string[]> = {}
  for (const w of calc.result?.warnings ?? []) {
    const row = w.line_no ? indexes[w.line_no - 1] : undefined
    if (row !== undefined) (lineWarnings[row] ??= []).push(w.message)
  }
  const partyWarnings = (calc.result?.warnings ?? []).filter((w) => !w.line_no)

  const msgs: Record<string, string | undefined> = { date: errors.date?.message, due_date: errors.due_date?.message, warehouse_id: errors.warehouse_id?.message }
  const errorCount = Object.keys(errors).length
  const termOptions = [{ value: '', label: "Customer's terms" }, ...(terms.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))]

  function chooseParty(p: Party | null) {
    setValue('party', p, { shouldDirty: true, shouldValidate: submitCount > 0 })
    if (p?.payment_term && !values.payment_term_id) setValue('payment_term_id', String(p.payment_term.id), { shouldDirty: true })
  }

  function placeErrors(e: unknown) {
    if (e instanceof ApiError && e.code === 'version_conflict') { setConflict(true); return }
    if (e instanceof ApiError && e.status === 422) {
      const remapped = new ApiError({ ...e.problem, errors: remapLineErrors(e.fieldErrors, indexes) }, e.headers)
      const placed = applyProblemToForm(remapped, setError as never, invoiceFieldMap as never, ['lines.*.product', 'lines.*.quantity', 'lines.*.price', 'lines.*.discount_pct', 'lines.*.tax_rule_id', 'lines.*.description'] as never)
      if (placed) { setUnmatched(placed.unmatched); return }
    }
    setFormError(e)
  }

  /** Save the draft (POST once per action, or PUT with If-Match), then the delivery details if they changed. */
  async function save(v: InvoiceFormValues): Promise<SalesInvoice | null> {
    setFormError(null); setUnmatched([]); setConflict(false)
    let saved: SalesInvoice
    try {
      if (mode === 'new' && !current) {
        saved = await create.mutateAsync({ input: toInvoiceInput(v), idempotencyKey: saveIdem.key })
        saveIdem.reset()
      } else {
        saved = await update.mutateAsync({ input: toInvoiceInput(v), version })
      }
    } catch (e) {
      placeErrors(e)
      return null
    }
    setCurrent(saved); setVersion(saved.version)
    if (deliveryChanged(v, saved.delivery)) {
      try {
        saved = await api.request<{ data: SalesInvoice }>('PATCH', `/sales-invoices/${saved.id}/delivery`, { body: toDeliveryUpdate(v), ifMatch: `W/"${saved.version}"` })
          .then((r) => r.data.data)
        setCurrent(saved); setVersion(saved.version)
        void qc.invalidateQueries({ queryKey: ['company', api.getCompany(), 'sales-invoices'] })
      } catch (e) {
        placeErrors(e) // the invoice itself is saved; only the delivery details need fixing
        return null
      }
    }
    reset(invoiceToForm(saved, v.party, today))
    return saved
  }

  const run = (then: (inv: SalesInvoice) => void) => handleSubmit(async (v) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const inv = await save(v)
      if (inv) then(inv)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  })

  const saveDraft = run((inv) => {
    toast({ tone: 'positive', title: `Draft ${inv.number} saved`, description: `Total ${inv.total} · not posted yet` })
    if (mode === 'new') { guard.allowNavigation(); navigate(`/sales/invoices/${inv.id}/edit`, { replace: true }) }
  })
  const saveAndPost = run((inv) => {
    if (mode === 'new') { guard.allowNavigation(); navigate(`/sales/invoices/${inv.id}/edit?post=1`, { replace: true }) } else setPosting(true)
  })
  const preview = run((inv) => { guard.allowNavigation(); navigate(`/sales/invoices/${inv.id}/preview`) })

  async function doPost(confirmBackdated: boolean) {
    const inv = await post.mutateAsync({ body: { confirm_backdated: confirmBackdated || undefined }, idempotencyKey: postIdem.key })
    postIdem.reset()
    toast({ tone: 'positive', title: `${inv.number} posted`, description: 'Stock and the customer balance are updated.' })
    guard.allowNavigation()
    navigate('/sales/invoices')
  }

  async function doDelete() {
    try {
      await del.mutateAsync()
      toast({ tone: 'positive', title: 'Draft deleted', description: `${current?.number} is voided and will not be reused.` })
      guard.allowNavigation()
      navigate('/sales/invoices')
    } catch (e) {
      setConfirmDelete(false)
      setFormError(e)
    }
  }

  async function reloadLatest() {
    if (!current) return
    setReloading(true)
    try {
      const fresh = await api.request<{ data: SalesInvoice }>('GET', `/sales-invoices/${current.id}`)
      setVersion(fresh.data.data.version)
      setConflict(false)
      toast({ tone: 'info', title: 'Loaded the latest version', description: 'Your edits are kept; save again to apply them.' })
    } catch (e) {
      setFormError(e)
    } finally {
      setReloading(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveDraft() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const cancel = () => navigate(mode === 'edit' && current ? `/sales/invoices/${current.id}` : '/sales/invoices')
  const area = { width: '100%', minHeight: 72, boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)',
    font: '14px/20px var(--font-sans)', color: 'var(--ink)', background: 'var(--surface)', resize: 'vertical' } as const

  return (
    <form onSubmit={(e) => { e.preventDefault(); void saveDraft() }} noValidate data-testid="invoice-form">
      <PageHeader eyebrow="Sales" title={mode === 'edit' ? `Edit ${current?.number}` : 'New sales invoice'}
        description={mode === 'edit' ? `Draft · ${current?.party.name}` : 'Pick a customer and add items. Stock goes out and the customer owes you when you post it.'} />
      {mode === 'edit' && <div style={{ marginBottom: 12 }}><Banner tone="info" title="Draft, not yet posted">Posting takes the stock out and charges the customer; after that the invoice can only be cancelled.</Banner></div>}
      {partyWarnings.length > 0 && (
        <div style={{ marginBottom: 12 }} data-testid="invoice-warnings">
          <Banner tone="warning" title="Check before posting">
            <ul style={{ margin: 0, paddingLeft: 18 }}>{partyWarnings.map((w) => <li key={w.code}>{w.message}</li>)}</ul>
            <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>You can still save and post this invoice.</span>
          </Banner>
        </div>
      )}
      <FormErrorSummary count={submitCount > 0 ? errorCount : 0} noun="invoice" messages={unmatched} />
      {conflict && <ConflictBanner onReload={() => void reloadLatest()} loading={reloading} />}
      <ProblemBanner error={formError} />

      <Card title="Invoice details">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, alignItems: 'start' }}>
          <PartyPanel type="customer" party={values.party} calc={calc.result} error={errors.party?.message} invalid={!!errors.party} onChange={chooseParty} />
          <DocumentHeader register={register} errors={msgs} warehouses={warehouses.data ?? []} dateLabel="Invoice date" warehouseLabel="Dispatch from">
            <Field label="Invoice number" hint="Given when the draft is first saved">
              <Input mono readOnly value={current?.number ?? 'INV-…'} aria-label="Invoice number" />
            </Field>
            <Field label="Customer PO" error={errors.customer_po_ref?.message} htmlFor="f-po">
              <Input id="f-po" mono {...register('customer_po_ref')} invalid={!!errors.customer_po_ref} placeholder="Optional" />
            </Field>
            <Field label="Payment terms" htmlFor="f-terms">
              <Select key={termOptions.length} id="f-terms" options={termOptions} {...register('payment_term_id')} />
            </Field>
          </DocumentHeader>
        </div>
        <div style={{ marginTop: 12 }}>
          <Button variant="ghost" size="sm" icon="truck" onClick={() => setShowDelivery((s) => !s)} data-testid="toggle-delivery">
            {showDelivery ? 'Hide delivery details' : 'Delivery details (challan, vehicle)'}
          </Button>
          {showDelivery && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16, marginTop: 8 }} data-testid="delivery-fields">
              <Field label="Challan number" error={errors.challan_no?.message} htmlFor="f-challan"><Input id="f-challan" mono {...register('challan_no')} invalid={!!errors.challan_no} /></Field>
              <Field label="Vehicle" error={errors.vehicle_no?.message} htmlFor="f-vehicle"><Input id="f-vehicle" {...register('vehicle_no')} invalid={!!errors.vehicle_no} /></Field>
              <Field label="Delivered at" error={errors.delivered_at?.message} htmlFor="f-delivered"><Input id="f-delivered" type="datetime-local" {...register('delivered_at')} /></Field>
            </div>
          )}
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Items">
        <LineGrid control={control} register={register} watch={watch} setValue={setValue} errors={errors} side="sale"
          results={mapResults(calc.result?.lines, indexes)} warnings={lineWarnings} taxRules={taxRules.data ?? []}
          defaultPrice={(p) => tierPrice(p, values.party)} />
      </Card>
      <div className="lf-grid" style={{ alignItems: 'start', marginTop: 16 }}>
        <div className="lf-c8" style={{ minWidth: 0 }}>
          <Card title="Notes">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <Field label="Notes for the customer" hint="Printed on the invoice" error={errors.notes?.message} htmlFor="f-notes"><textarea id="f-notes" style={area} {...register('notes')} /></Field>
              <Field label="Internal note" hint="Visible to your team only" error={errors.internal_note?.message} htmlFor="f-internal"><textarea id="f-internal" style={area} {...register('internal_note')} /></Field>
            </div>
          </Card>
        </div>
        <aside className="lf-c4 lf-form-aside"><TotalsPanel {...calc} /></aside>
      </div>
      {mode === 'edit' && current && can('sales.delete') && (
        <div style={{ marginTop: 16 }}>
          <Button variant="ghost" icon="trash-2" onClick={() => setConfirmDelete(true)} data-testid="delete-draft">Delete draft</Button>
        </div>
      )}

      <DocumentFooter onCancel={cancel} onSaveDraft={() => void saveDraft()} onPreview={() => void preview()} busy={busy}
        status={isDirty ? <Badge tone="accent" dot>Unsaved changes</Badge> : undefined}
        primary={can('sales.create') ? { label: mode === 'edit' ? 'Post invoice' : 'Save and post', onClick: () => void saveAndPost(), testId: 'save-post' } : undefined} />

      {guard.dialog}
      {posting && current && (
        <PostDialog title={`Post ${current.number}?`} number={current.number} calc={calc.result} total={current.total} loading={post.isPending}
          onPost={doPost} onClose={() => setPosting(false)} />
      )}
      {confirmDelete && current && (
        <DeleteDialog name={current.number} what="draft" description="This draft never reached the books. Its invoice number is voided and never reused. This cannot be undone."
          loading={del.isPending} onConfirm={() => void doDelete()} onClose={() => setConfirmDelete(false)} />
      )}
    </form>
  )
}
