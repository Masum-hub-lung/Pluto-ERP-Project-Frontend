import { useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Party, Quotation, SalesInvoice } from '../../api/contract.gen'
import { useTaxRules, useWarehouses } from '../../api/inventory'
import { useParty, usePaymentTerms } from '../../api/parties'
import { dhakaToday } from '../../api/platform'
import { calculateInvoice } from '../../api/sales'
import { openPdf, quotations } from '../../api/trade'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { applyProblemToForm } from '../../lib/forms'
import { formatTaka } from '../../lib/format'
import { LINE_FIELDS, quoteCalcInput, quoteFieldMap, quoteSchema, quotationToForm, toQuotationInput, type QuoteFormValues } from '../../lib/tradeSchema'
import { tierPrice } from '../../lib/invoiceSchema'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ConflictBanner } from '../../components/ConflictBanner'
import { DeleteDialog } from '../../components/DeleteDialog'
import { DocumentFooter } from '../../components/document/DocumentFooter'
import { LineGrid } from '../../components/document/LineGrid'
import { completeIndexes, mapResults, remapLineErrors } from '../../components/document/lines'
import { PartyPanel } from '../../components/document/PartyPanel'
import { TotalsPanel } from '../../components/document/TotalsPanel'
import { useCalculate } from '../../components/document/useCalculate'
import { FormErrorSummary } from '../../components/FormErrorSummary'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden, NotFound } from '../../components/states'
import { ActionBar, DocStatusBadge, ReasonDialog, SendDialog } from '../../components/trade/TradeParts'
import { shortDate } from '../purchases/BillList'

/**
 * E10 Sales quotation (Sal-Quote.dc.html; backlog P10.1-FE-01; BR-056): the invoice form without posting. Lines are
 * priced by POST /sales-invoices/calculate like an invoice (DEC-09); the customer may be a prospect. A draft or sent
 * quotation can be edited and sent; it is then marked accepted, declined or expired, and an accepted one converts once
 * into a draft invoice, which opens in E6. Anything past "sent" is shown read-only with its actions.
 */
export function QuotationEditor({ mode }: { mode: 'new' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const q = quotations.useOne(mode === 'edit' ? id : 0)
  const party = useParty(q.data?.party.id ?? 0)
  if (mode === 'new' && !can('sales.create')) return <Forbidden permission="sales.create" what="creating quotations" />
  if (mode === 'edit') {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this quotation" back="/sales/quotations" backLabel="Quotations" />
    if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
    if (!q.data || (!party.data && !party.error)) return <PageSkeleton template="form" />
  }
  return <Editor key={mode === 'edit' ? `${id}-${q.data?.status}` : 'new'} mode={mode} quote={q.data ?? null} party={party.data?.party ?? null} />
}

function Editor({ mode, quote, party }: { mode: 'new' | 'edit'; quote: Quotation | null; party: Party | null }) {
  const { Card, Field, Input, Select, PageHeader, Badge, Button, Banner, DataTable } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const taxRules = useTaxRules()
  const warehouses = useWarehouses()
  const terms = usePaymentTerms()
  const [current, setCurrent] = useState(quote)
  const [version, setVersion] = useState(quote?.version ?? 0)
  const create = quotations.useCreate()
  const update = quotations.useUpdate(current?.id ?? 0)
  const del = quotations.useDelete(current?.id ?? 0)
  const send = quotations.useAction<{ to: string[]; message?: string }>(current?.id ?? 0, 'send', false)
  const status = quotations.useAction<{ status: string; reason?: string }>(current?.id ?? 0, 'status', false)
  const convert = quotations.useAction<Record<string, never>, SalesInvoice>(current?.id ?? 0, 'convert')
  const saveIdem = useIdempotencyKey()
  const convertIdem = useIdempotencyKey()
  const [conflict, setConflict] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [dialog, setDialog] = useState<null | 'send' | 'accepted' | 'declined' | 'expired' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const editable = !current || current.status === 'draft' || current.status === 'sent'

  const today = dhakaToday()
  const validUntil = useMemo(() => { const d = new Date(`${today}T00:00:00`); d.setDate(d.getDate() + 15); return d.toISOString().slice(0, 10) }, [today])
  const defaults = useMemo(() => quotationToForm(quote, party, today, validUntil), [quote, party, today, validUntil])
  const { control, register, watch, setValue, setError, handleSubmit, reset, formState: { errors, isDirty, submitCount } } =
    useForm<QuoteFormValues>({ resolver: zodResolver(quoteSchema) as never, defaultValues: defaults, mode: 'onSubmit' })
  const guard = useUnsavedChangesBlocker(editable && isDirty, 'Your edits to this quotation have not been saved.')

  const values = watch()
  const fallbackWh = String(warehouses.data?.find((w) => w.status === 'active')?.id ?? '')
  const indexes = completeIndexes(values.lines)
  const calcInput = editable && values.party && values.date && fallbackWh && indexes.length ? JSON.stringify(quoteCalcInput(values, fallbackWh)) : null
  const calc = useCalculate(calcInput, (s: string, signal: AbortSignal) => calculateInvoice(JSON.parse(s), signal))
  const whOptions = [{ value: '', label: 'Not set' }, ...(warehouses.data ?? []).filter((w) => w.status !== 'inactive').map((w) => ({ value: String(w.id), label: w.name }))]
  const termOptions = [{ value: '', label: "Customer's terms" }, ...(terms.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))]
  const area = { width: '100%', minHeight: 72, boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)',
    font: '14px/20px var(--font-sans)', color: 'var(--ink)', background: 'var(--surface)', resize: 'vertical' } as const

  function placeErrors(e: unknown) {
    if (e instanceof ApiError && e.code === 'version_conflict') { setConflict(true); return }
    if (e instanceof ApiError && e.status === 422) {
      const remapped = new ApiError({ ...e.problem, errors: remapLineErrors(e.fieldErrors, indexes) }, e.headers)
      const placed = applyProblemToForm(remapped, setError as never, quoteFieldMap as never, LINE_FIELDS as never)
      if (placed) { setUnmatched(placed.unmatched); return }
    }
    setFormError(e)
  }

  const save = handleSubmit(async (v) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setFormError(null); setUnmatched([]); setConflict(false)
    try {
      const saved = current
        ? await update.mutateAsync({ input: toQuotationInput(v), version })
        : await create.mutateAsync({ input: toQuotationInput(v), idempotencyKey: saveIdem.key })
      if (!current) saveIdem.reset()
      setCurrent(saved); setVersion(saved.version)
      reset(quotationToForm(saved, v.party, today, validUntil))
      toast({ tone: 'positive', title: `Quotation ${saved.number} saved`, description: `Total ${formatTaka(saved.total, { symbol: true })}` })
      if (mode === 'new') { guard.allowNavigation(); navigate(`/sales/quotations/${saved.id}`, { replace: true }) }
    } catch (e) {
      placeErrors(e)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  })

  const after = (q: Quotation, title: string) => { setCurrent(q); setVersion(q.version); setDialog(null); toast({ tone: 'positive', title }) }

  async function doConvert() {
    try {
      const inv = await convert.mutateAsync({ idempotencyKey: convertIdem.key })
      convertIdem.reset()
      toast({ tone: 'positive', title: `Draft invoice ${inv.number} created`, description: `From ${current?.number}. Check it and post it.` })
      guard.allowNavigation()
      navigate(`/sales/invoices/${inv.id}/edit`)
    } catch (e) {
      setFormError(e)
    }
  }

  async function doDelete() {
    try {
      await del.mutateAsync()
      toast({ tone: 'positive', title: 'Draft deleted', description: `${current?.number} is voided and will not be reused.` })
      guard.allowNavigation()
      navigate('/sales/quotations')
    } catch (e) {
      setDialog(null)
      setFormError(e)
    }
  }

  const pdf = () => current && openPdf(() => quotations.pdf(current.id), `${current.number}.pdf`)
    .catch(() => toast({ tone: 'negative', title: 'Could not open the PDF', description: 'Try again in a moment.' }))

  const actions = current && (
    <ActionBar>
      <DocStatusBadge status={current.status} />
      <Button variant="secondary" size="sm" icon="file-text" onClick={() => void pdf()}>Preview PDF</Button>
      {editable && can('sales.edit') && <Button variant="secondary" size="sm" icon="send" onClick={() => setDialog('send')} data-testid="send-quote">Send quotation</Button>}
      {editable && can('sales.edit') && <Button variant="secondary" size="sm" icon="check" onClick={() => setDialog('accepted')} data-testid="mark-accepted">Mark accepted</Button>}
      {editable && can('sales.edit') && <Button variant="ghost" size="sm" onClick={() => setDialog('declined')}>Declined</Button>}
      {editable && can('sales.edit') && <Button variant="ghost" size="sm" onClick={() => setDialog('expired')}>Expired</Button>}
      {current.status === 'accepted' && can('sales.create') && (
        <Button variant="primary" size="sm" icon="receipt-text" loading={convert.isPending} onClick={() => void doConvert()} data-testid="convert-quote">Convert to invoice</Button>)}
      {current.status === 'converted' && current.converted_invoice_id && (
        <Button variant="secondary" size="sm" onClick={() => navigate(`/sales/invoices/${current.converted_invoice_id}`)}>Open {current.converted_invoice_number}</Button>)}
      {current.status === 'draft' && can('sales.delete') && <Button variant="ghost" size="sm" icon="trash-2" onClick={() => setDialog('delete')} data-testid="delete-quote">Delete draft</Button>}
    </ActionBar>
  )

  const dialogs = <>
    {guard.dialog}
    {dialog === 'send' && current && (
      <SendDialog title={`Send ${current.number}?`} party={current.party.name} loading={send.isPending} onClose={() => setDialog(null)}
        onSend={async (to, message) => after(await send.mutateAsync({ body: { to, message: message || undefined } }), `${current.number} sent`)} />
    )}
    {(dialog === 'accepted' || dialog === 'declined' || dialog === 'expired') && current && (
      <ReasonDialog title={`Mark ${current.number} ${dialog}?`} confirmLabel={`Mark ${dialog}`} required={false} loading={status.isPending} onClose={() => setDialog(null)}
        description={dialog === 'accepted' ? 'An accepted quotation can be converted to an invoice.' : 'The quotation can no longer be changed or converted.'}
        onConfirm={async (reason) => after(await status.mutateAsync({ body: { status: dialog, reason: reason || undefined } }), `${current.number} marked ${dialog}`)} />
    )}
    {dialog === 'delete' && current && (
      <DeleteDialog name={current.number} what="draft" description="The quotation number is voided and never reused. This cannot be undone."
        loading={del.isPending} onConfirm={() => void doDelete()} onClose={() => setDialog(null)} />
    )}
  </>

  if (!editable && current) {
    const rows = (current.lines ?? []).map((l) => ({ id: l.id, item: `${l.product_name} · ${l.product_code}`, qty: `${l.quantity} ${l.unit}`, price: l.unit_price,
      disc: l.discount_pct && !/^0+(\.0+)?$/.test(l.discount_pct) ? `${l.discount_pct} %` : '', total: l.line_total }))
    return (
      <>
        <PageHeader eyebrow="Sales · Quotation" title={current.number} description={`${current.party.name} · ${shortDate(current.quotation_date)} · valid until ${shortDate(current.valid_until)}`} />
        {actions}
        <ProblemBanner error={formError} />
        <Card title="Items" padding="none">
          <div style={{ overflowX: 'auto' }}>
            <DataTable caption="Quotation lines" rows={rows} columns={[{ key: 'item', label: 'Item' }, { key: 'qty', label: 'Quantity', align: 'right' },
              { key: 'price', label: 'Price (৳)', type: 'amount' }, { key: 'disc', label: 'Discount', align: 'right' }, { key: 'total', label: 'Amount (৳)', type: 'amount' }]} />
          </div>
        </Card>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, fontWeight: 600 }} data-testid="quote-total">Total {formatTaka(current.total, { symbol: true })}</div>
        {current.notes && <p style={{ color: 'var(--ink-muted)' }}>Terms of offer: {current.notes}</p>}
        {dialogs}
      </>
    )
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save() }} noValidate data-testid="quote-form">
      <PageHeader eyebrow="Sales" title={current ? `Quotation ${current.number}` : 'New quotation'}
        description={current ? `${current.party.name} · nothing posts until it becomes an invoice` : 'An offer to a customer or prospect. Nothing posts; convert it to an invoice once accepted.'} />
      {actions}
      {!current && <div style={{ marginBottom: 12 }}><Banner tone="info" title="Quotations never post">Prices and stock are only checked; the books change when the invoice made from it is posted.</Banner></div>}
      <FormErrorSummary count={submitCount > 0 ? Object.keys(errors).length : 0} noun="quotation" messages={unmatched} />
      {conflict && <ConflictBanner onReload={() => window.location.reload()} />}
      <ProblemBanner error={formError} />

      <Card title="Quotation details">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, alignItems: 'start' }}>
          <PartyPanel type="customer" prospects party={values.party} calc={calc.result} error={errors.party?.message} invalid={!!errors.party}
            onChange={(p) => setValue('party', p, { shouldDirty: true, shouldValidate: submitCount > 0 })} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
            <Field label="Quotation date" error={errors.date?.message} htmlFor="q-date"><Input id="q-date" type="date" {...register('date')} invalid={!!errors.date} /></Field>
            <Field label="Valid until" error={errors.valid_until?.message} htmlFor="q-valid"><Input id="q-valid" type="date" {...register('valid_until')} invalid={!!errors.valid_until} /></Field>
            <Field label="Quotation number" hint="Given when first saved"><Input mono readOnly value={current?.number ?? 'QT-…'} aria-label="Quotation number" /></Field>
            <Field label="Deliver from" hint="Optional" htmlFor="q-wh"><Select key={whOptions.length} id="q-wh" options={whOptions} {...register('warehouse_id')} /></Field>
            <Field label="Proposed terms" htmlFor="q-terms"><Select key={termOptions.length} id="q-terms" options={termOptions} {...register('payment_term_id')} /></Field>
          </div>
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Items">
        <LineGrid control={control} register={register} watch={watch} setValue={setValue} errors={errors} side="sale"
          results={mapResults(calc.result?.lines, indexes)} taxRules={taxRules.data ?? []} defaultPrice={(p) => tierPrice(p, values.party)} />
      </Card>
      <div className="lf-grid" style={{ alignItems: 'start', marginTop: 16 }}>
        <div className="lf-c8" style={{ minWidth: 0 }}>
          <Card title="Terms">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <Field label="Terms of offer" hint="Printed on the quotation" error={errors.notes?.message} htmlFor="q-notes"><textarea id="q-notes" style={area} {...register('notes')} /></Field>
              <Field label="Internal note" hint="Visible to your team only" error={errors.internal_note?.message} htmlFor="q-internal"><textarea id="q-internal" style={area} {...register('internal_note')} /></Field>
            </div>
          </Card>
        </div>
        <aside className="lf-c4 lf-form-aside"><TotalsPanel {...calc} empty="Add a customer and at least one line to see the totals." /></aside>
      </div>
      <DocumentFooter onCancel={() => navigate('/sales/quotations')} busy={busy} saveLabel={current ? 'Save changes' : 'Save quotation'}
        onSaveDraft={() => void save()} status={isDirty ? <Badge tone="accent" dot>Unsaved changes</Badge> : undefined} />
      {dialogs}
    </form>
  )
}
