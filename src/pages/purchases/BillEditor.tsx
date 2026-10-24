import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { Party, PurchaseBill } from '../../api/contract.gen'
import { useTaxRules, useWarehouses } from '../../api/inventory'
import { useParty } from '../../api/parties'
import { dhakaToday } from '../../api/platform'
import { calculateBill, useBill, useCreateBill, useDeleteBill, usePostBill, useUpdateBill } from '../../api/purchases'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { billFieldMap, billSchema, billToForm, toBillInput, type BillFormValues } from '../../lib/billSchema'
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
 * F3 Create / edit purchase bill (Pur-Create.dc.html; backlog P4.5-FE-02/03). Drafts only: a posted or cancelled bill
 * opens F4 instead. Every figure comes from POST /purchase-bills/calculate (300 ms after the last change). "Save and
 * post" saves, then asks in the PostDialog; a new bill is first saved and reopened at its edit route with ?post=1.
 * Import fields (currency, LC, lot) stay hidden until P16.
 */
export function BillEditor({ mode }: { mode: 'new' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const bill = useBill(mode === 'edit' ? id : 0)
  const party = useParty(bill.data?.party.id ?? 0)
  if (mode === 'new' && !can('purchases.create')) return <Forbidden permission="purchases.create" what="entering purchase bills" />
  if (mode === 'edit' && !can('purchases.edit')) return <Forbidden permission="purchases.edit" what="editing purchase bills" />
  if (mode === 'edit') {
    if (bill.error instanceof ApiError && bill.error.status === 404) return <NotFound what="this bill" back="/purchases/bills" backLabel="Purchase bills" />
    if (bill.error) return <ProblemBanner error={bill.error} onRetry={() => void bill.refetch()} />
    if (!bill.data) return <PageSkeleton template="form" />
    if (bill.data.status !== 'draft') return <Navigate to={`/purchases/bills/${id}`} replace />
    if (!party.data && !party.error) return <PageSkeleton template="form" />
  }
  return <Editor key={mode === 'edit' ? id : 'new'} mode={mode} bill={bill.data ?? null} party={party.data?.party ?? null} />
}

function Editor({ mode, bill, party }: { mode: 'new' | 'edit'; bill: PurchaseBill | null; party: Party | null }) {
  const { Card, Field, Input, PageHeader, Badge, Button } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const taxRules = useTaxRules()
  const warehouses = useWarehouses()
  const create = useCreateBill()
  const update = useUpdateBill(bill?.id ?? 0)
  const del = useDeleteBill(bill?.id ?? 0)
  const post = usePostBill(bill?.id ?? 0)
  const saveIdem = useIdempotencyKey()
  const postIdem = useIdempotencyKey()
  const [version, setVersion] = useState(bill?.version ?? 0)
  const [current, setCurrent] = useState(bill)
  const [conflict, setConflict] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null)
  const [posting, setPosting] = useState(mode === 'edit' && params.get('post') === '1')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false) // set synchronously: a double click fires before the disabled button renders

  const today = dhakaToday()
  const defaults = useMemo(() => billToForm(bill, party, today), [bill, party, today])
  const { control, register, watch, setValue, setError, handleSubmit, reset, formState: { errors, isDirty, submitCount } } =
    useForm<BillFormValues>({ resolver: zodResolver(billSchema) as never, defaultValues: defaults, mode: 'onSubmit' })
  const guard = useUnsavedChangesBlocker(isDirty, 'Your edits to this bill have not been saved.')
  useEffect(() => { if (params.has('post')) setParams((p) => { p.delete('post'); return p }, { replace: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The first active warehouse is the default "Receive into" for a new bill (the contract has no purchase default).
  useEffect(() => {
    if (mode === 'new' && !watch('warehouse_id') && warehouses.data) {
      const w = warehouses.data.find((x) => x.status === 'active')
      if (w) setValue('warehouse_id', String(w.id))
    }
  }, [warehouses.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const values = watch()
  const indexes = completeIndexes(values.lines)
  // Calculate needs the same required fields as saving; the supplier's bill number is not used in any figure, so a
  // placeholder stands in until it is typed.
  const calcInput = values.party && values.warehouse_id && values.date && indexes.length
    ? JSON.stringify({ ...toBillInput(values), supplier_bill_no: values.supplier_bill_no.trim() || '-' }) : null
  const calc = useCalculate(calcInput, (s: string, signal: AbortSignal) => calculateBill(JSON.parse(s), signal))
  const lineWarnings: Record<number, string[]> = {}
  for (const w of calc.result?.warnings ?? []) {
    const row = w.line_no ? indexes[w.line_no - 1] : undefined
    if (row !== undefined) (lineWarnings[row] ??= []).push(w.message)
  }

  const msgs: Record<string, string | undefined> = { date: errors.date?.message, due_date: errors.due_date?.message, warehouse_id: errors.warehouse_id?.message }
  const errorCount = Object.keys(errors).length

  function placeErrors(e: unknown) {
    if (e instanceof ApiError && e.code === 'duplicate_supplier_bill') {
      setDuplicateOf(typeof e.problem.existing_number === 'string' ? e.problem.existing_number : null)
      setError('supplier_bill_no', { type: 'server', message: e.fieldErrors.supplier_bill_no?.[0] ?? e.message }, { shouldFocus: true })
      return
    }
    if (e instanceof ApiError && e.code === 'version_conflict') { setConflict(true); return }
    if (e instanceof ApiError && e.status === 422) {
      const remapped = new ApiError({ ...e.problem, errors: remapLineErrors(e.fieldErrors, indexes) }, e.headers)
      const placed = applyProblemToForm(remapped, setError as never, billFieldMap as never, ['lines.*.product', 'lines.*.quantity', 'lines.*.price', 'lines.*.discount_pct', 'lines.*.tax_rule_id', 'lines.*.description'] as never)
      if (placed) { setUnmatched(placed.unmatched); return }
    }
    setFormError(e)
  }

  /** Save the draft (POST once per action, or PUT with If-Match); returns the saved bill or null. */
  async function save(v: BillFormValues): Promise<PurchaseBill | null> {
    setFormError(null); setUnmatched([]); setConflict(false); setDuplicateOf(null)
    try {
      if (mode === 'new') {
        const b = await create.mutateAsync({ input: toBillInput(v), idempotencyKey: saveIdem.key })
        saveIdem.reset()
        return b
      }
      const b = await update.mutateAsync({ input: toBillInput(v), version })
      setVersion(b.version); setCurrent(b)
      reset(billToForm(b, v.party, today))
      return b
    } catch (e) {
      placeErrors(e)
      return null
    }
  }

  const run = (then: (b: PurchaseBill) => void) => handleSubmit(async (v) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const b = await save(v)
      if (b) then(b)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  })

  const saveDraft = run((b) => {
    toast({ tone: 'positive', title: `Draft ${b.number} saved`, description: `Total ${b.total} · not posted yet` })
    if (mode === 'new') { guard.allowNavigation(); navigate(`/purchases/bills/${b.id}/edit`, { replace: true }) }
  })
  const saveAndPost = run((b) => {
    if (mode === 'new') { guard.allowNavigation(); navigate(`/purchases/bills/${b.id}/edit?post=1`, { replace: true }) } else setPosting(true)
  })

  async function doPost(confirmBackdated: boolean) {
    const b = await post.mutateAsync({ body: { confirm_backdated: confirmBackdated || undefined }, idempotencyKey: postIdem.key })
    postIdem.reset()
    toast({ tone: 'positive', title: `${b.number} posted`, description: 'Stock and the supplier balance are updated.' })
    guard.allowNavigation()
    navigate('/purchases/bills')
  }

  async function doDelete() {
    try {
      await del.mutateAsync()
      toast({ tone: 'positive', title: 'Draft deleted', description: `${current?.number} is voided and will not be reused.` })
      guard.allowNavigation()
      navigate('/purchases/bills')
    } catch (e) {
      setConfirmDelete(false)
      setFormError(e)
    }
  }

  async function reloadLatest() {
    if (!current) return
    setReloading(true)
    try {
      const fresh = await api.request<{ data: PurchaseBill }>('GET', `/purchase-bills/${current.id}`)
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

  const cancel = () => navigate(mode === 'edit' && current ? `/purchases/bills/${current.id}` : '/purchases/bills')
  const area = { width: '100%', minHeight: 72, boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)',
    font: '14px/20px var(--font-sans)', color: 'var(--ink)', background: 'var(--surface)', resize: 'vertical' } as const

  return (
    <form onSubmit={(e) => { e.preventDefault(); void saveDraft() }} noValidate data-testid="bill-form">
      <PageHeader eyebrow="Purchases" title={mode === 'edit' ? `Edit ${current?.number}` : 'New purchase bill'}
        description={mode === 'edit' ? `Draft · ${current?.party.name}` : "Enter the supplier's bill as you received it. Items go into stock when you post it."} />
      <FormErrorSummary count={submitCount > 0 ? errorCount : 0} noun="bill" messages={unmatched} />
      {conflict && <ConflictBanner onReload={() => void reloadLatest()} loading={reloading} />}
      <ProblemBanner error={formError} />

      <Card title="Bill details">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, alignItems: 'start' }}>
          <PartyPanel type="supplier" party={values.party} calc={calc.result} error={errors.party?.message} invalid={!!errors.party}
            onChange={(p) => setValue('party', p, { shouldDirty: true, shouldValidate: submitCount > 0 })} />
          <DocumentHeader register={register} errors={msgs} warehouses={warehouses.data ?? []} dateLabel="Bill date" warehouseLabel="Receive into">
            <Field label="Bill number" hint="Given when the draft is first saved">
              <Input mono readOnly value={current?.number ?? 'BILL-…'} aria-label="Bill number" />
            </Field>
            <Field label="Supplier's bill number" required error={errors.supplier_bill_no?.message} htmlFor="f-supplier-bill">
              <Input id="f-supplier-bill" mono {...register('supplier_bill_no')} invalid={!!errors.supplier_bill_no} placeholder="As printed on their bill" />
            </Field>
          </DocumentHeader>
        </div>
        {duplicateOf && (
          <p style={{ margin: '8px 0 0', fontSize: 13 }} data-testid="duplicate-link">
            Open <Link to={`/purchases/bills?q=${encodeURIComponent(duplicateOf)}`}>{duplicateOf}</Link> to see the bill already entered.
          </p>
        )}
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Items">
        <LineGrid control={control} register={register} watch={watch} setValue={setValue} errors={errors} side="purchase"
          results={mapResults(calc.result?.lines, indexes)} warnings={lineWarnings} taxRules={taxRules.data ?? []}
          defaultPrice={(p) => p.last_purchase_cost ?? '0.00'} />
      </Card>
      <div className="lf-grid" style={{ alignItems: 'start', marginTop: 16 }}>
        <div className="lf-c8" style={{ minWidth: 0 }}>
          <Card title="Notes">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <Field label="Notes" error={errors.notes?.message} htmlFor="f-notes"><textarea id="f-notes" style={area} {...register('notes')} /></Field>
              <Field label="Internal note" hint="Visible to your team only" error={errors.internal_note?.message} htmlFor="f-internal"><textarea id="f-internal" style={area} {...register('internal_note')} /></Field>
            </div>
          </Card>
        </div>
        <aside className="lf-c4 lf-form-aside"><TotalsPanel {...calc} /></aside>
      </div>
      {mode === 'edit' && current && can('purchases.delete') && (
        <div style={{ marginTop: 16 }}>
          <Button variant="ghost" icon="trash-2" onClick={() => setConfirmDelete(true)} data-testid="delete-draft">Delete draft</Button>
        </div>
      )}

      <DocumentFooter onCancel={cancel} onSaveDraft={() => void saveDraft()} busy={busy}
        status={isDirty ? <Badge tone="accent" dot>Unsaved changes</Badge> : undefined}
        primary={can('purchases.create') ? { label: 'Save and post', onClick: () => void saveAndPost(), testId: 'save-post' } : undefined} />

      {guard.dialog}
      {posting && current && (
        <PostDialog title={`Post ${current.number}?`} number={current.number} calc={calc.result} total={current.total} loading={post.isPending}
          onPost={doPost} onClose={() => setPosting(false)} />
      )}
      {confirmDelete && current && (
        <DeleteDialog name={current.number} what="draft" description="The bill number is voided and never reused. This cannot be undone."
          loading={del.isPending} onConfirm={() => void doDelete()} onClose={() => setConfirmDelete(false)} />
      )}
    </form>
  )
}
