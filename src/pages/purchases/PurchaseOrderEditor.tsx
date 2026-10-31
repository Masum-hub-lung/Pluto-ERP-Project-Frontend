import { useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Party, PurchaseBill, PurchaseOrder } from '../../api/contract.gen'
import { useTaxRules, useWarehouses } from '../../api/inventory'
import { useParty, usePaymentTerms } from '../../api/parties'
import { dhakaToday } from '../../api/platform'
import { calculateBill } from '../../api/purchases'
import { openPdf, purchaseOrders } from '../../api/trade'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { applyProblemToForm } from '../../lib/forms'
import { formatTaka } from '../../lib/format'
import { LINE_FIELDS, orderCalcInput, orderFieldMap, orderSchema, orderToForm, toOrderInput, type OrderFormValues } from '../../lib/tradeSchema'
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
import { shortDate } from './BillList'

/**
 * F8 Purchase order (Pur-PO.dc.html; backlog P10.2-FE-01; BR-056): the bill form without posting, priced by POST
 * /purchase-bills/calculate in the supplier's currency (a foreign order needs the planning rate). A draft or sent order
 * can be edited and sent. "Create bill" makes a draft bill for what is still to come and opens it in F3; posting that
 * bill moves the order to partly received / received. An order can be closed (stop waiting) or, before anything arrived,
 * cancelled. Past "sent" the order is read-only, with each line's received and remaining quantity and its bills.
 */
interface OrderLine { id: number; product_name: string; product_code: string; unit: string; quantity: string; unit_cost: string; line_total: string; received_quantity: string; remaining_quantity: string }
interface OrderBill { id: number; number: string; supplier_bill_no: string; status: string; bill_date: string }

export function PurchaseOrderEditor({ mode }: { mode: 'new' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const o = purchaseOrders.useOne(mode === 'edit' ? id : 0)
  const party = useParty(o.data?.party.id ?? 0)
  if (mode === 'new' && !can('purchases.create')) return <Forbidden permission="purchases.create" what="creating purchase orders" />
  if (mode === 'edit') {
    if (o.error instanceof ApiError && o.error.status === 404) return <NotFound what="this purchase order" back="/purchases/orders" backLabel="Purchase orders" />
    if (o.error) return <ProblemBanner error={o.error} onRetry={() => void o.refetch()} />
    if (!o.data || (!party.data && !party.error)) return <PageSkeleton template="form" />
  }
  return <Editor key={mode === 'edit' ? `${id}-${o.data?.status}` : 'new'} mode={mode} order={o.data ?? null} party={party.data?.party ?? null} />
}

function Editor({ mode, order, party }: { mode: 'new' | 'edit'; order: PurchaseOrder | null; party: Party | null }) {
  const { Card, Field, Input, Select, PageHeader, Badge, Button, DataTable } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const taxRules = useTaxRules()
  const warehouses = useWarehouses()
  const terms = usePaymentTerms()
  const [current, setCurrent] = useState(order)
  const [version, setVersion] = useState(order?.version ?? 0)
  const create = purchaseOrders.useCreate()
  const update = purchaseOrders.useUpdate(current?.id ?? 0)
  const del = purchaseOrders.useDelete(current?.id ?? 0)
  const send = purchaseOrders.useAction<{ to: string[]; message?: string }>(current?.id ?? 0, 'send', false)
  const status = purchaseOrders.useAction<{ status: string; reason?: string }>(current?.id ?? 0, 'status', false)
  const convert = purchaseOrders.useAction<Record<string, never>, PurchaseBill>(current?.id ?? 0, 'convert')
  const saveIdem = useIdempotencyKey()
  const convertIdem = useIdempotencyKey()
  const [conflict, setConflict] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [dialog, setDialog] = useState<null | 'send' | 'closed' | 'cancelled' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const editable = !current || current.status === 'draft' || current.status === 'sent'

  const today = dhakaToday()
  const defaults = useMemo(() => orderToForm(order, party, today), [order, party, today])
  const { control, register, watch, setValue, setError, handleSubmit, reset, formState: { errors, isDirty, submitCount } } =
    useForm<OrderFormValues>({ resolver: zodResolver(orderSchema) as never, defaultValues: defaults, mode: 'onSubmit' })
  const guard = useUnsavedChangesBlocker(editable && isDirty, 'Your edits to this order have not been saved.')
  const values = watch()
  if (mode === 'new' && !values.warehouse_id && warehouses.data) {
    const w = warehouses.data.find((x) => x.status === 'active')
    if (w) setValue('warehouse_id', String(w.id))
  }
  const currency = values.party?.default_currency_code ?? current?.currency_code ?? 'BDT'
  const indexes = completeIndexes(values.lines)
  const calcInput = editable && values.party && values.date && values.warehouse_id && indexes.length && (currency === 'BDT' || values.exchange_rate)
    ? JSON.stringify(orderCalcInput(values)) : null
  const calc = useCalculate(calcInput, (s: string, signal: AbortSignal) => calculateBill(JSON.parse(s), signal))
  const whOptions = [{ value: '', label: 'Choose…' }, ...(warehouses.data ?? []).filter((w) => w.status !== 'inactive').map((w) => ({ value: String(w.id), label: w.name }))]
  const termOptions = [{ value: '', label: "Supplier's terms" }, ...(terms.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))]
  const area = { width: '100%', minHeight: 72, boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)',
    font: '14px/20px var(--font-sans)', color: 'var(--ink)', background: 'var(--surface)', resize: 'vertical' } as const

  function placeErrors(e: unknown) {
    if (e instanceof ApiError && e.code === 'version_conflict') { setConflict(true); return }
    if (e instanceof ApiError && e.status === 422) {
      const remapped = new ApiError({ ...e.problem, errors: remapLineErrors(e.fieldErrors, indexes) }, e.headers)
      const placed = applyProblemToForm(remapped, setError as never, orderFieldMap as never, LINE_FIELDS as never)
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
        ? await update.mutateAsync({ input: toOrderInput(v), version })
        : await create.mutateAsync({ input: toOrderInput(v), idempotencyKey: saveIdem.key })
      if (!current) saveIdem.reset()
      setCurrent(saved); setVersion(saved.version)
      reset(orderToForm(saved, v.party, today))
      toast({ tone: 'positive', title: `Purchase order ${saved.number} saved`, description: `Total ${formatTaka(saved.total, { symbol: true })}` })
      if (mode === 'new') { guard.allowNavigation(); navigate(`/purchases/orders/${saved.id}`, { replace: true }) }
    } catch (e) {
      placeErrors(e)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  })

  const after = (o: PurchaseOrder, title: string) => { setCurrent(o); setVersion(o.version); setDialog(null); toast({ tone: 'positive', title }) }

  async function doConvert() {
    try {
      const bill = await convert.mutateAsync({ idempotencyKey: convertIdem.key })
      convertIdem.reset()
      toast({ tone: 'positive', title: `Draft bill ${bill.number} created`, description: "Type the supplier's bill number, check the quantities and post it." })
      guard.allowNavigation()
      navigate(`/purchases/bills/${bill.id}/edit`)
    } catch (e) {
      setFormError(e)
    }
  }

  async function doDelete() {
    try {
      await del.mutateAsync()
      toast({ tone: 'positive', title: 'Draft deleted', description: `${current?.number} is voided and will not be reused.` })
      guard.allowNavigation()
      navigate('/purchases/orders')
    } catch (e) {
      setDialog(null)
      setFormError(e)
    }
  }

  const pdf = () => current && openPdf(() => purchaseOrders.pdf(current.id), `${current.number}.pdf`)
    .catch(() => toast({ tone: 'negative', title: 'Could not open the PDF', description: 'Try again in a moment.' }))
  const open = current && ['draft', 'sent', 'partly_received'].includes(current.status)

  const actions = current && (
    <ActionBar>
      <DocStatusBadge status={current.status} />
      <Button variant="secondary" size="sm" icon="file-text" onClick={() => void pdf()}>Preview PDF</Button>
      {editable && can('purchases.edit') && <Button variant="secondary" size="sm" icon="send" onClick={() => setDialog('send')} data-testid="send-order">Send to supplier</Button>}
      {open && can('purchases.create') && (
        <Button variant="primary" size="sm" icon="receipt-text" loading={convert.isPending} onClick={() => void doConvert()} data-testid="convert-order">Create bill</Button>)}
      {current.status !== 'draft' && open && can('purchases.edit') && <Button variant="ghost" size="sm" onClick={() => setDialog('closed')} data-testid="close-order">Close order</Button>}
      {editable && can('purchases.edit') && <Button variant="ghost" size="sm" onClick={() => setDialog('cancelled')} data-testid="cancel-order">Cancel order</Button>}
      {current.status === 'draft' && can('purchases.delete') && <Button variant="ghost" size="sm" icon="trash-2" onClick={() => setDialog('delete')}>Delete draft</Button>}
    </ActionBar>
  )

  const dialogs = <>
    {guard.dialog}
    {dialog === 'send' && current && (
      <SendDialog title={`Send ${current.number}?`} party={current.party.name} loading={send.isPending} onClose={() => setDialog(null)}
        onSend={async (to, message) => after(await send.mutateAsync({ body: { to, message: message || undefined } }), `${current.number} sent`)} />
    )}
    {(dialog === 'closed' || dialog === 'cancelled') && current && (
      <ReasonDialog title={dialog === 'closed' ? `Close ${current.number}?` : `Cancel ${current.number}?`} confirmLabel={dialog === 'closed' ? 'Close order' : 'Cancel order'}
        required={false} loading={status.isPending} onClose={() => setDialog(null)}
        description={dialog === 'closed' ? 'You stop waiting for what has not arrived. Bills already made stay as they are.' : 'Nothing has arrived against it. It cannot be reopened.'}
        onConfirm={async (reason) => after(await status.mutateAsync({ body: { status: dialog, reason: reason || undefined } }), `${current.number} ${dialog}`)} />
    )}
    {dialog === 'delete' && current && (
      <DeleteDialog name={current.number} what="draft" description="The order number is voided and never reused. This cannot be undone."
        loading={del.isPending} onConfirm={() => void doDelete()} onClose={() => setDialog(null)} />
    )}
  </>

  if (!editable && current) {
    const lines = current.lines as unknown as OrderLine[]
    const bills = (current.bills ?? []) as unknown as OrderBill[]
    return (
      <>
        <PageHeader eyebrow="Purchases · Purchase order" title={current.number}
          description={`${current.party.name} · ${shortDate(current.order_date)}${current.expected_date ? ` · expected ${shortDate(current.expected_date)}` : ''}`} />
        {actions}
        <ProblemBanner error={formError} />
        <Card title="Items" padding="none">
          <div style={{ overflowX: 'auto' }}>
            <DataTable caption="Order lines" rows={lines.map((l) => ({ id: l.id, item: `${l.product_name} · ${l.product_code}`, ordered: `${l.quantity} ${l.unit}`,
              received: l.received_quantity, remaining: l.remaining_quantity, cost: l.unit_cost, total: l.line_total }))}
              columns={[{ key: 'item', label: 'Item' }, { key: 'ordered', label: 'Ordered', align: 'right' }, { key: 'received', label: 'Received', align: 'right' },
                { key: 'remaining', label: 'Still to come', align: 'right' }, { key: 'cost', label: `Cost (${current.currency_code})`, align: 'right' },
                { key: 'total', label: `Amount (${current.currency_code})`, type: 'amount' }]} />
          </div>
        </Card>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, fontWeight: 600 }}>Total {formatTaka(current.total, { symbol: true })}</div>
        {bills.length > 0 && (
          <Card title="Bills made from this order" padding="none">
            <DataTable caption="Bills" rows={bills.map((b) => ({ id: b.id, number: b.number, supplier: b.supplier_bill_no, date: shortDate(b.bill_date), status: b.status }))}
              columns={[{ key: 'number', label: 'Bill', mono: true }, { key: 'supplier', label: "Supplier's no." }, { key: 'date', label: 'Date' },
                { key: 'status', label: 'Status', render: (v: string) => <DocStatusBadge status={v} /> }]}
              onRowClick={(r: { id: number }) => navigate(`/purchases/bills/${r.id}`)} />
          </Card>
        )}
        {dialogs}
      </>
    )
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save() }} noValidate data-testid="order-form">
      <PageHeader eyebrow="Purchases" title={current ? `Purchase order ${current.number}` : 'New purchase order'}
        description={current ? `${current.party.name} · nothing posts until goods are billed` : 'What you are ordering from a supplier. Nothing posts; create the bill when the goods arrive.'} />
      {actions}
      <FormErrorSummary count={submitCount > 0 ? Object.keys(errors).length : 0} noun="order" messages={unmatched} />
      {conflict && <ConflictBanner onReload={() => window.location.reload()} />}
      <ProblemBanner error={formError} />

      <Card title="Order details">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, alignItems: 'start' }}>
          <PartyPanel type="supplier" party={values.party} calc={calc.result} error={errors.party?.message} invalid={!!errors.party}
            onChange={(p) => setValue('party', p, { shouldDirty: true, shouldValidate: submitCount > 0 })} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
            <Field label="Order date" error={errors.date?.message} htmlFor="po-date"><Input id="po-date" type="date" {...register('date')} invalid={!!errors.date} /></Field>
            <Field label="Expected by" hint="Optional" error={errors.expected_date?.message} htmlFor="po-exp"><Input id="po-exp" type="date" {...register('expected_date')} invalid={!!errors.expected_date} /></Field>
            <Field label="Order number" hint="Given when first saved"><Input mono readOnly value={current?.number ?? 'PO-…'} aria-label="Order number" /></Field>
            <Field label="Deliver to" error={errors.warehouse_id?.message} htmlFor="po-wh"><Select key={whOptions.length} id="po-wh" options={whOptions} {...register('warehouse_id')} /></Field>
            <Field label="Payment terms" htmlFor="po-terms"><Select key={termOptions.length} id="po-terms" options={termOptions} {...register('payment_term_id')} /></Field>
            {currency !== 'BDT' && (
              <Field label={`${currency} to BDT rate`} hint="Planning rate" error={errors.exchange_rate?.message} htmlFor="po-rate">
                <Input id="po-rate" mono inputMode="decimal" {...register('exchange_rate')} invalid={!!errors.exchange_rate} />
              </Field>
            )}
          </div>
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Items">
        <LineGrid control={control} register={register} watch={watch} setValue={setValue} errors={errors} side="purchase"
          results={mapResults(calc.result?.lines, indexes)} taxRules={taxRules.data ?? []} defaultPrice={(p) => p.last_purchase_cost ?? '0.00'} />
      </Card>
      <div className="lf-grid" style={{ alignItems: 'start', marginTop: 16 }}>
        <div className="lf-c8" style={{ minWidth: 0 }}>
          <Card title="Notes">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <Field label="Notes for the supplier" hint="Printed on the order" error={errors.notes?.message} htmlFor="po-notes"><textarea id="po-notes" style={area} {...register('notes')} /></Field>
              <Field label="Internal note" error={errors.internal_note?.message} htmlFor="po-internal"><textarea id="po-internal" style={area} {...register('internal_note')} /></Field>
            </div>
          </Card>
        </div>
        <aside className="lf-c4 lf-form-aside"><TotalsPanel {...calc} /></aside>
      </div>
      <DocumentFooter onCancel={() => navigate('/purchases/orders')} busy={busy} saveLabel={current ? 'Save changes' : 'Save order'}
        onSaveDraft={() => void save()} status={isDirty ? <Badge tone="accent" dot>Unsaved changes</Badge> : undefined} />
      {dialogs}
    </form>
  )
}
