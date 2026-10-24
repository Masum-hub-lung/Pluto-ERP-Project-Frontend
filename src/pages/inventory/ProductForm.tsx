import { useEffect, useMemo, useRef, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import type { Ledger, PageMeta, Product } from '../../api/contract.gen'
import { useCategories, useCreateProduct, useCreateUnit, useDeleteProduct, useProduct, useStockGroups, useTaxRules, useUnits, useUpdateProduct, useWarehouses } from '../../api/inventory'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { applyProblemToForm, type SetFieldError } from '../../lib/forms'
import { emptyProduct, productSchema, toProductForm, toProductInput, type ProductFormParsed, type ProductFormValues } from '../../lib/productSchema'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ActivityTimeline } from '../../components/ActivityTimeline'
import { ConflictBanner } from '../../components/ConflictBanner'
import { DeleteDialog } from '../../components/DeleteDialog'
import { FormErrorSummary } from '../../components/FormErrorSummary'
import { PageSkeleton } from '../../components/PageSkeleton'
import { LedgerPicker } from '../../components/pickers/LedgerPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { Forbidden, NotFound } from '../../components/states'

/**
 * D2 Add product or service / D3 Edit product (Inv-Add.dc.html, Inv-Service.dc.html, Inv-Edit.dc.html; backlog
 * P3.2-FE-06/07). One form for both kinds: a service hides the stock sections and shows its expense account (CF-09).
 * Quantities never change here (BR-003): on-hand is read only. D4 details arrive in P11, so saving returns to D1.
 */
const FIELDS = ['item_type', 'name', 'code', 'category_id', 'stock_group_id', 'unit_id', 'barcode', 'selling_price', 'wholesale_price', 'last_purchase_cost',
  'tax_rule_id', 'income_ledger_id', 'expense_ledger_id', 'is_active', 'warehouses.*.reorder_level', 'warehouses.*.reorder_qty'] as const
const ADD_UNIT = '__add__'

export function ProductForm({ mode }: { mode: 'add' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const existing = useProduct(mode === 'edit' ? id : 0)
  const units = useUnits()
  const warehouses = useWarehouses()
  if (mode === 'add' && !can('inventory.create')) return <Forbidden permission="inventory.create" what="adding products" />
  if (mode === 'edit' && !can('inventory.edit')) return <Forbidden permission="inventory.edit" what="editing products" />
  if (mode === 'edit' && existing.error instanceof ApiError && existing.error.status === 404) return <NotFound what="this product" back="/inventory/products" backLabel="Products" />
  const error = existing.error ?? units.error ?? warehouses.error
  if (error) return <ProblemBanner error={error} onRetry={() => { void existing.refetch(); void units.refetch(); void warehouses.refetch() }} />
  if ((mode === 'edit' && !existing.data) || !units.data || !warehouses.data) return <PageSkeleton template="form" />
  return <Form key={mode === 'edit' ? `${id}` : 'add'} mode={mode} product={existing.data?.product ?? null} />
}

/** Ledgers a picker purpose offers (a short list), to show saved choices by name and to preselect 4101. */
function usePurposeLedgers(purpose: 'income_for_product') {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'ledgers', purpose],
    queryFn: async () => (await api.request<{ data: Ledger[]; meta: PageMeta }>('GET', '/ledgers', { query: { purpose, per_page: 100 } })).data.data,
    staleTime: 5 * 60_000,
  })
}

function Form({ mode, product }: { mode: 'add' | 'edit'; product: Product | null }) {
  const { Card, Field, Input, Select, Button, Banner, Badge, Segmented, PageHeader } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const units = useUnits()
  const allWarehouses = useWarehouses()
  const categories = useCategories()
  const groups = useStockGroups()
  const taxRules = useTaxRules()
  const incomeLedgers = usePurposeLedgers('income_for_product')
  const create = useCreateProduct()
  const update = useUpdateProduct(product?.id ?? 0)
  const remove = useDeleteProduct(product?.id ?? 0)
  const idem = useIdempotencyKey()
  const [version, setVersion] = useState(product?.version ?? 0)
  const [conflict, setConflict] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [income, setIncome] = useState<Ledger | null>(null)
  const [expense, setExpense] = useState<Ledger | null>(null)
  const [addingUnit, setAddingUnit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [usedNotice, setUsedNotice] = useState<string | null>(null)
  const addAnother = useRef(false)

  // Every active warehouse gets a row (D2 per-warehouse grid); on edit, inactive ones that still hold it are listed too.
  const whRows = useMemo(() => {
    const held = new Set((product?.warehouses ?? []).map((l) => l.warehouse_id))
    return (allWarehouses.data ?? []).filter((w) => w.status !== 'inactive' || held.has(w.id)).map((w) => ({ id: w.id, name: w.name }))
  }, [allWarehouses.data, product])
  const defaults = useMemo<ProductFormValues>(() => {
    if (product) return toProductForm(product, String(units.data?.find((u) => u.name === product.unit)?.id ?? ''), whRows)
    return { ...emptyProduct, warehouses: whRows.map((w) => ({ warehouse_id: w.id, name: w.name, reorder_level: '', reorder_qty: '' })) }
  }, [product, units.data, whRows])
  const { register, control, handleSubmit, setError, reset, watch, setValue, formState: { errors, isDirty, isSubmitting, submitCount } } =
    useForm<ProductFormValues, unknown, ProductFormParsed>({ resolver: zodResolver(productSchema), defaultValues: defaults, mode: 'onSubmit' })
  const { fields } = useFieldArray({ control, name: 'warehouses' })
  const guard = useUnsavedChangesBlocker(isDirty, 'Your changes to this item have not been saved.')

  // Saved ledgers shown by name; a new product's income account starts as 4101 (the sales_default mapping).
  useEffect(() => {
    const list = incomeLedgers.data
    if (!list) return
    const want = product ? product.income_ledger_id : list.find((l) => l.code === '4101')?.id
    const l = list.find((x) => x.id === want) ?? null
    setIncome(l)
    if (!product && l) setValue('income_ledger_id', String(l.id))
  }, [incomeLedgers.data, product, setValue])

  const kind = watch('item_type')
  const service = kind === 'service'
  const errorCount = Object.keys(errors).length
  const err = (k: string) => (k.split('.').reduce<unknown>((o, s) => (o as Record<string, unknown> | undefined)?.[s], errors) as { message?: string } | undefined)?.message
  const dirty = { shouldDirty: true, shouldValidate: submitCount > 0 }
  const category = categories.data?.find((c) => String(c.id) === watch('category_id'))
  const parentPrefix = category?.parent_id ? categories.data?.find((c) => c.id === category.parent_id)?.code_prefix : null
  const codeHint = `${category?.code_prefix || parentPrefix || 'PRD'}-…`

  async function onValid(values: ProductFormParsed) {
    setFormError(null)
    setUnmatched([])
    setConflict(false)
    const input = toProductInput(values, mode)
    try {
      if (mode === 'add') {
        const p = await create.mutateAsync({ input, idempotencyKey: idem.key })
        idem.reset()
        toast({ tone: 'positive', title: `${p.name} added as ${p.code}`, description: p.item_type === 'service' ? 'Service: no stock is tracked.' : 'Stock fills in as purchase bills post.' })
        if (addAnother.current) {
          reset({ ...defaults, item_type: values.item_type, income_ledger_id: values.income_ledger_id })
          return
        }
        guard.allowNavigation()
        navigate('/inventory/products')
      } else if (product) {
        const p = await update.mutateAsync({ input, version })
        setVersion(p.version)
        reset(values)
        toast({ tone: 'positive', title: 'Changes saved', description: `${p.name} · version ${p.version}` })
        guard.allowNavigation()
        navigate('/inventory/products')
      }
    } catch (e) {
      // `warehouses.*.reorder_level` matches the API's `warehouses.1.reorder_level`, which is also the RHF field name.
      const placed = applyProblemToForm<string>(e, setError as SetFieldError<string>, {}, FIELDS)
      if (placed) setUnmatched(placed.unmatched)
      else if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else setFormError(e)
    }
  }

  async function reloadLatest() {
    if (!product) return
    setReloading(true)
    try {
      const fresh = await api.request<{ data: Product }>('GET', `/products/${product.id}`)
      setVersion(fresh.data.data.version)
      setConflict(false)
      toast({ tone: 'info', title: 'Loaded the latest version', description: 'Your edits are kept; save again to apply them.' })
    } catch (e) {
      setFormError(e)
    } finally {
      setReloading(false)
    }
  }

  async function setActive(active: boolean) {
    if (!product) return
    try {
      const p = await update.mutateAsync({ input: { is_active: active }, version })
      setVersion(p.version)
      setValue('is_active', p.is_active)
      setUsedNotice(null)
      toast({ tone: 'positive', title: active ? `${p.name} is active again` : `${p.name} is now inactive`, description: active ? undefined : 'It is hidden from new documents; its history stays.' })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else setFormError(e)
    }
  }

  async function runDelete() {
    try {
      await remove.mutateAsync()
      guard.allowNavigation()
      toast({ tone: 'positive', title: `${product?.name} deleted` })
      navigate('/inventory/products')
    } catch (e) {
      setConfirmDelete(false)
      // TC-INV-006: a used item cannot be deleted; offer to make it inactive instead.
      if (e instanceof ApiError && e.code === 'has_history') setUsedNotice(e.problem.detail ?? 'This item is used on documents.')
      else setFormError(e)
    }
  }

  const cancel = () => navigate('/inventory/products')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void handleSubmit(onValid)() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 } as const
  const options = (rows: { id: number; name: string; parent_id?: number | null }[] | undefined, none: string) =>
    [{ value: '', label: none }, ...(rows ?? []).map((r) => ({ value: String(r.id), label: r.parent_id ? `— ${r.name}` : r.name }))]
  const active = watch('is_active')

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate data-testid="product-form">
      <PageHeader eyebrow="Inventory" title={mode === 'edit' ? `Edit ${product?.name}` : service ? 'New service' : 'New product'}
        description={mode === 'edit' ? `${product?.code} · ${product?.item_type === 'service' ? 'Service' : 'Stock item'}` : 'Fields marked * are required. Stock quantities change only through stock documents.'} />
      <FormErrorSummary count={submitCount > 0 ? errorCount : 0} noun="item" messages={unmatched} />
      {conflict && <ConflictBanner onReload={() => void reloadLatest()} loading={reloading} />}
      <ProblemBanner error={formError} />
      {usedNotice && (
        <Banner tone="warning" title="This item cannot be deleted"
          action={active ? <Button size="sm" variant="secondary" onClick={() => void setActive(false)} data-testid="deactivate-instead">Make inactive instead</Button> : undefined}>
          {usedNotice}
        </Banner>
      )}
      {mode === 'edit' && !active && <Banner tone="info" title="This item is inactive">It is hidden from new invoices, bills and stock documents. Reactivate it below.</Banner>}

      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
          <Card title="Kind" subtitle={mode === 'edit' ? 'Fixed once the item is used on documents' : 'A service has no stock (delivery, labour, rent)'}>
            <Segmented key={kind} value={kind} onChange={(v) => setValue('item_type', v as 'product' | 'service', dirty)}
              options={[{ value: 'product', label: 'Physical product', icon: 'package' }, { value: 'service', label: 'Service', icon: 'wrench' }]} />
          </Card>

          <Card title="Basic details" subtitle="How this item appears on invoices and in lists">
            <div style={grid}>
              <Field label="Item name" required error={err('name')} hint={service ? undefined : 'Include the pack size, e.g. 5L jar'} htmlFor="p-name">
                <Input id="p-name" {...register('name')} invalid={!!err('name')} placeholder={service ? 'e.g. Delivery charge' : 'e.g. Soybean oil 5L jar'} />
              </Field>
              <Field label="Item code" error={err('code')} hint={mode === 'add' ? 'Leave empty to number it from the category prefix' : undefined} htmlFor="p-code">
                <Input id="p-code" mono {...register('code')} invalid={!!err('code')} placeholder={codeHint} />
              </Field>
              <Field label="Category" error={err('category_id')} htmlFor="p-category">
                <Select id="p-category" options={options(categories.data, 'None')} {...register('category_id')} />
              </Field>
              <Field label="Unit" required error={err('unit_id')} htmlFor="p-unit">
                <Select id="p-unit" value={watch('unit_id')} invalid={!!err('unit_id')}
                  onChange={(e) => (e.target.value === ADD_UNIT ? setAddingUnit(true) : setValue('unit_id', e.target.value, dirty))}
                  options={[{ value: '', label: 'Choose…' }, ...(units.data ?? []).map((u) => ({ value: String(u.id), label: u.name })),
                    ...(can('inventory.create') ? [{ value: ADD_UNIT, label: 'Add unit…' }] : [])]} />
              </Field>
              {!service && <>
                <Field label="Stock group" error={err('stock_group_id')} hint="For stock valuation reports" htmlFor="p-group">
                  <Select id="p-group" options={options(groups.data, 'None')} {...register('stock_group_id')} />
                </Field>
                <Field label="Barcode" error={err('barcode')} htmlFor="p-barcode">
                  <Input id="p-barcode" mono {...register('barcode')} invalid={!!err('barcode')} placeholder="Optional" />
                </Field>
              </>}
            </div>
          </Card>

          <Card title="Pricing" subtitle="Prices before tax. Invoices can still change them per line.">
            <div style={grid}>
              <Field label="Selling price" required error={err('selling_price')} htmlFor="p-price">
                <Input id="p-price" prefix="৳" align="right" mono inputMode="decimal" {...register('selling_price')} invalid={!!err('selling_price')} placeholder="0.00" />
              </Field>
              <Field label="Wholesale price" error={err('wholesale_price')} hint="For customers on the wholesale tier" htmlFor="p-wholesale">
                <Input id="p-wholesale" prefix="৳" align="right" mono inputMode="decimal" {...register('wholesale_price')} invalid={!!err('wholesale_price')} placeholder="0.00" />
              </Field>
              {!service && can('inventory.view_costs') && (
                <Field label="Purchase cost" error={err('last_purchase_cost')} hint="Last known cost; bills update the average" htmlFor="p-cost">
                  <Input id="p-cost" prefix="৳" align="right" mono inputMode="decimal" {...register('last_purchase_cost')} invalid={!!err('last_purchase_cost')} placeholder="0.0000" />
                </Field>
              )}
            </div>
          </Card>

          <Card title="Accounts and tax" subtitle="Where this item posts in your books">
            <div style={grid}>
              <Field label="Income account" required error={err('income_ledger_id')} htmlFor="p-income">
                <LedgerPicker id="p-income" purpose="income_for_product" value={income} invalid={!!err('income_ledger_id')} aria-label="Income account"
                  onChange={(l) => { setIncome(l); setValue('income_ledger_id', l ? String(l.id) : '', dirty) }} />
              </Field>
              {service && (
                <Field label="Expense account" error={err('expense_ledger_id')} hint={mode === 'edit' ? 'Choose one to change it' : 'Where buying this service posts'} htmlFor="p-expense">
                  <LedgerPicker id="p-expense" purpose="expense_for_product" value={expense} invalid={!!err('expense_ledger_id')} aria-label="Expense account"
                    onChange={(l) => { setExpense(l); setValue('expense_ledger_id', l ? String(l.id) : '', dirty) }} />
                </Field>
              )}
              <Field label="Default tax rule" error={err('tax_rule_id')} hint={taxRules.data?.length ? 'Rates are set in Settings' : 'No tax rules yet (Settings)'} htmlFor="p-tax">
                <Select id="p-tax" {...register('tax_rule_id')}
                  options={[{ value: '', label: 'None' }, ...(taxRules.data ?? []).filter((t) => t.is_active || String(t.id) === watch('tax_rule_id')).map((t) => ({ value: String(t.id), label: `${t.name} (${t.applies_to})` }))]} />
              </Field>
            </div>
          </Card>

          {!service && (
            <Card title="Stock by warehouse" subtitle="Reorder level warns when stock falls to it; reorder quantity is what to buy then">
              {fields.length === 0
                ? <span style={{ color: 'var(--ink-muted)' }}>No active warehouses yet. Add one under Inventory › Warehouses.</span>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="lf-table" style={{ width: '100%', minWidth: 460 }}>
                      <thead><tr><th>Warehouse</th>{mode === 'edit' && <th style={{ textAlign: 'right' }}>On hand</th>}<th style={{ width: 150 }}>Reorder level</th><th style={{ width: 150 }}>Reorder quantity</th></tr></thead>
                      <tbody>
                        {fields.map((f, i) => (
                          <tr key={f.id}>
                            <td>{f.name}</td>
                            {mode === 'edit' && <td className="lf-num" style={{ textAlign: 'right' }}>{product?.warehouses?.find((l) => l.warehouse_id === f.warehouse_id)?.qty_on_hand ?? '0.000'}</td>}
                            <td><Input align="right" mono inputMode="decimal" aria-label={`Reorder level, ${f.name}`} {...register(`warehouses.${i}.reorder_level`)}
                              invalid={!!err(`warehouses.${i}.reorder_level`)} placeholder="0" />
                              {err(`warehouses.${i}.reorder_level`) && <span role="alert" style={{ color: 'var(--negative)', fontSize: 12 }}>{err(`warehouses.${i}.reorder_level`)}</span>}</td>
                            <td><Input align="right" mono inputMode="decimal" aria-label={`Reorder quantity, ${f.name}`} {...register(`warehouses.${i}.reorder_qty`)}
                              invalid={!!err(`warehouses.${i}.reorder_qty`)} placeholder="0" />
                              {err(`warehouses.${i}.reorder_qty`) && <span role="alert" style={{ color: 'var(--negative)', fontSize: 12 }}>{err(`warehouses.${i}.reorder_qty`)}</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ink-muted)' }}>Opening stock is entered once stock posting is live (phase 4); quantities change only through bills and stock documents.</p>
            </Card>
          )}

          {mode === 'edit' && product && (<>
            <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 560 }}>
                <span style={{ font: '600 15px/20px var(--font-sans)' }}>{active ? 'Make item inactive' : 'Reactivate item'}</span>
                <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--ink-muted)' }}>Hides it from new documents. Its stock history and past documents stay.</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {active
                  ? <Button variant="secondary" icon="x" onClick={() => void setActive(false)} loading={update.isPending} data-testid="deactivate-product">Make inactive</Button>
                  : <Button variant="secondary" icon="check" onClick={() => void setActive(true)} loading={update.isPending} data-testid="reactivate-product">Reactivate</Button>}
                {can('inventory.delete') && <Button variant="ghost" icon="trash-2" onClick={() => setConfirmDelete(true)}>Delete</Button>}
              </div>
            </section>
            <Card title="Activity" subtitle="Who changed what, newest first">
              <ActivityTimeline type="product" id={product.id} />
            </Card>
          </>)}
        </div>

        <aside className="lf-c4 lf-form-aside" style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 16 }}>
          {mode === 'edit' && product?.track_stock && (
            <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="lf-label">On hand</span>
              <span className="lf-num" style={{ font: '500 22px/28px var(--font-serif)' }} data-testid="on-hand">{product.on_hand ?? '0.000'} {product.unit}</span>
              {product.stock_value != null && <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Value {formatTaka(product.stock_value, { symbol: true })} · avg cost {product.avg_cost}</span>}
              <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Read only: quantities change through bills, invoices and stock documents.</span>
            </section>
          )}
          <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="lf-label">{service ? 'Service' : 'Stock item'}</span>
            <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--ink-muted)' }}>
              {service
                ? 'Sold or bought without stock. Sales post to the income account; purchases to the expense account.'
                : 'Tracked per warehouse at moving-average cost. Sales post to the income account; cost of goods posts automatically.'}
            </span>
          </section>
        </aside>
      </div>

      <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, margin: '0 -24px -48px', padding: '12px 24px', background: 'var(--surface)', borderTop: '1px solid var(--line)', boxShadow: '0 -4px 12px rgba(19,32,47,.05)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        {mode === 'edit' && isDirty && <Badge tone="accent" dot>Unsaved changes</Badge>}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={cancel}>Cancel</Button>
        {mode === 'add' && <Button variant="secondary" type="submit" disabled={isSubmitting} onClick={() => { addAnother.current = true }}>Save and add another</Button>}
        <Button variant="primary" icon="check" kbd="Ctrl S" type="submit" loading={isSubmitting} disabled={isSubmitting} onClick={() => { addAnother.current = false }} data-testid="save-product">
          {mode === 'edit' ? 'Save changes' : 'Save item'}
        </Button>
      </div>

      {guard.dialog}
      {addingUnit && <AddUnitDialog onClose={() => setAddingUnit(false)} onAdded={(id) => setValue('unit_id', String(id), dirty)} />}
      {confirmDelete && product && (
        <DeleteDialog name={product.name} what="item" description="Only items never used on a document can be deleted. Used items can be made inactive instead."
          loading={remove.isPending} onConfirm={() => void runDelete()} onClose={() => setConfirmDelete(false)} />
      )}
    </form>
  )
}

/** "Add unit…" in D2 (POST /units, NEW in the design): the new unit is selected straight away. */
function AddUnitDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: number) => void }) {
  const { Field, Input, Select, Button } = ds()
  const create = useCreateUnit()
  const [name, setName] = useState('')
  const [decimals, setDecimals] = useState('0')
  const [error, setError] = useState<string | undefined>()

  async function save() {
    if (!name.trim()) { setError('Enter a unit name'); return }
    try {
      const u = await create.mutateAsync({ name: name.trim(), decimals: Number(decimals) })
      onAdded(u.id)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? (e.fieldErrors.name?.[0] ?? e.problem.title) : 'The unit could not be added')
    }
  }

  return (
    <ResponsiveDialog title="Add a unit" description="For example ream, sack or tola." width={400} onClose={onClose} testId="add-unit-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={create.isPending} disabled={create.isPending} onClick={() => void save()}>Add unit</Button></>}>
      {/* No <form>: the dialog sits inside the product form, and a nested form would let Enter submit that one. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Unit name" required error={error} htmlFor="new-unit-name">
          <Input id="new-unit-name" value={name} maxLength={30} autoFocus invalid={!!error} onChange={(e) => { setName(e.target.value); setError(undefined) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save() } }} />
        </Field>
        <Field label="Decimals in quantities" hint="0 for whole items, 3 for weights and volumes" htmlFor="new-unit-decimals">
          <Select id="new-unit-decimals" value={decimals} onChange={(e) => setDecimals(e.target.value)} options={['0', '1', '2', '3']} />
        </Field>
      </div>
    </ResponsiveDialog>
  )
}

