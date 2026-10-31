import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ApiError } from '../../api/client'
import type { Warehouse } from '../../api/contract.gen'
import { useCreateWarehouse, useInventoryLedgers, useUpdateWarehouse, useWarehouses } from '../../api/inventory'
import { useBranches } from '../../api/platform'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { applyProblemToForm } from '../../lib/forms'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { emptyWarehouse, toWarehouseForm, toWarehouseInput, warehouseSchema, type WarehouseFormParsed, type WarehouseFormValues } from '../../lib/warehouseSchema'
import { ConflictBanner } from '../../components/ConflictBanner'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'

/**
 * D7 Warehouse list (Inv-Warehouses.dc.html; backlog P3.2-FE-02): a table of warehouses with their inventory ledger,
 * items and status; a row opens D8 (P11.2-FE-02), the pencil and "Add warehouse" open the add/edit dialog.
 */
const STATUS_LABEL: Record<Warehouse['status'], string> = { active: 'Active', planned: 'Planned', inactive: 'Inactive' }
const STATUS_TONE: Record<Warehouse['status'], 'positive' | 'info' | 'neutral'> = { active: 'positive', planned: 'info', inactive: 'neutral' }

export function WarehouseList() {
  const { PageHeader, Button, DataTable, EmptyState, Badge, IconButton } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const list = useWarehouses()
  const branches = useBranches()
  const ledgers = useInventoryLedgers(can('accounting.view'))
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null)
  const canEdit = can('inventory.edit')

  const branchName = new Map((branches.data ?? []).map((b) => [b.id, b.name]))
  const ledgerCode = new Map((ledgers.data ?? []).map((l) => [l.id, l.code]))
  const rows = (list.data ?? []).map((w) => ({
    id: w.id, name: w.name, code: w.code, branch: branchName.get(w.branch_id) ?? '—', ledger: ledgerCode.get(w.inventory_ledger_id) ?? '—',
    items: w.products_count, below: w.below_reorder_count, status: w.status, isDefault: w.is_default_for_sales, w,
  }))
  const columns: DataColumn[] = [
    { key: 'name', label: 'Warehouse', render: (_v, r) => (
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
        <span style={{ fontWeight: 600 }}>{r.name}{r.isDefault && <span style={{ marginLeft: 8 }}><Badge tone="accent">Default for sales</Badge></span>}</span>
        <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{r.code}</span>
      </span>) },
    { key: 'branch', label: 'Branch' },
    ...(ledgers.data ? [{ key: 'ledger', label: 'Inventory ledger', mono: true }] : []),
    { key: 'items', label: 'Items', align: 'right' as const },
    { key: 'below', label: 'Below reorder', align: 'right' as const },
    { key: 'status', label: 'Status', render: (v: Warehouse['status']) => <Badge tone={STATUS_TONE[v]} dot>{STATUS_LABEL[v]}</Badge> },
  ]
  const open = (r: { id: number }) => navigate(`/inventory/warehouses/${r.id}`)
  const addButton = (testId: string) => can('inventory.create')
    ? <Button variant="primary" icon="plus" onClick={() => setEditing('new')} data-testid={testId}>Add warehouse</Button> : undefined
  const add = addButton('new-warehouse')
  const empty = <EmptyState icon="warehouse" title="No warehouses yet" description="Add the places you keep stock. Each gets its own inventory ledger under 1301."
    action={addButton('empty-new-warehouse')} />

  return (
    <>
      <PageHeader title="Warehouses" description="Where your stock is kept. Quantities fill in as purchase bills post." actions={add} />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Warehouses" cards={{ columns, rows, loading: list.isPending, onOpen: open, mobileColumns: ['name', 'branch', 'items'], badgeKey: 'status', empty }}>
        <DataTable caption="Warehouses" columns={columns} rows={rows} loading={list.isPending} onRowClick={open}
          rowActions={canEdit ? (r: { w: Warehouse; name: string }) => <IconButton icon="pencil" label={`Edit ${r.name}`} size="sm" onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); setEditing(r.w) }} /> : undefined} />
      </ListCard>
      {editing && <WarehouseDialog warehouse={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

const FIELDS = ['name', 'code', 'branch_id', 'address', 'phone', 'status', 'opens_on', 'is_default_for_sales'] as const

export function WarehouseDialog({ warehouse, onClose }: { warehouse: Warehouse | null; onClose: () => void }) {
  const { Field, Input, Select, Button, Switch } = ds()
  const toast = useToast()
  const branches = useBranches()
  const list = useWarehouses()
  const create = useCreateWarehouse()
  const update = useUpdateWarehouse()
  const idem = useIdempotencyKey()
  const [version, setVersion] = useState(warehouse?.version ?? 0)
  const [conflict, setConflict] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const defaults = useMemo(() => {
    const d = warehouse ? toWarehouseForm(warehouse) : { ...emptyWarehouse }
    // A new warehouse belongs to the only branch when there is just one (the usual case: Head office).
    if (!warehouse && branches.data?.length === 1) d.branch_id = String(branches.data[0].id)
    return d
  }, [warehouse, branches.data])
  const { register, handleSubmit, setError, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<WarehouseFormValues, unknown, WarehouseFormParsed>({ resolver: zodResolver(warehouseSchema), values: defaults, resetOptions: { keepDirtyValues: true } })
  const err = (k: (typeof FIELDS)[number]) => errors[k]?.message as string | undefined

  async function onValid(values: WarehouseFormParsed) {
    setFormError(null)
    setConflict(false)
    const input = toWarehouseInput(values)
    try {
      if (warehouse) {
        const w = await update.mutateAsync({ id: warehouse.id, input, version })
        toast({ tone: 'positive', title: 'Changes saved', description: `${w.name} · version ${w.version}` })
      } else {
        const w = await create.mutateAsync({ input, idempotencyKey: idem.key })
        idem.reset()
        toast({ tone: 'positive', title: `${w.name} added`, description: 'Its inventory ledger was created under 1301 Inventory.' })
      }
      onClose()
    } catch (e) {
      if (applyProblemToForm(e, setError, {}, FIELDS)) return
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else setFormError(e)
    }
  }

  async function reloadLatest() {
    const fresh = (await list.refetch()).data?.find((w) => w.id === warehouse?.id)
    if (fresh) {
      setVersion(fresh.version)
      setConflict(false)
      toast({ tone: 'info', title: 'Loaded the latest version', description: 'Your edits are kept; save again to apply them.' })
    }
  }

  const branchOptions = [{ value: '', label: 'Choose…' }, ...(branches.data ?? []).map((b) => ({ value: String(b.id), label: b.name }))]
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 } as const
  return (
    <ResponsiveDialog title={warehouse ? `Edit ${warehouse.name}` : 'Add a warehouse'} width={560} onClose={onClose} testId="warehouse-dialog"
      description={warehouse ? undefined : 'A new inventory ledger is created for it under 1301 Inventory.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={isSubmitting} disabled={isSubmitting} onClick={() => void handleSubmit(onValid)()} data-testid="save-warehouse">
          {warehouse ? 'Save changes' : 'Add warehouse'}</Button></>}>
      {/* No <form>: Enter in a field must not close anything by accident; the footer button submits. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {conflict && <ConflictBanner onReload={() => void reloadLatest()} loading={list.isFetching} />}
        <ProblemBanner error={formError} />
        <div style={grid}>
          <Field label="Warehouse name" required error={err('name')} htmlFor="w-name">
            <Input id="w-name" {...register('name')} invalid={!!err('name')} placeholder="e.g. Narayanganj depot" autoFocus />
          </Field>
          <Field label="Code" required error={err('code')} hint="Short and unique, e.g. WH-NGJ" htmlFor="w-code">
            <Input id="w-code" mono {...register('code')} invalid={!!err('code')} placeholder="WH-…" />
          </Field>
          <Field label="Branch" required error={err('branch_id')} htmlFor="w-branch">
            <Select id="w-branch" options={branchOptions} {...register('branch_id')} invalid={!!err('branch_id')} />
          </Field>
          <Field label="Phone" error={err('phone')} htmlFor="w-phone">
            <Input id="w-phone" mono {...register('phone')} placeholder="Optional" inputMode="tel" />
          </Field>
        </div>
        <Field label="Address" error={err('address')} htmlFor="w-address">
          <Input id="w-address" {...register('address')} placeholder="Road, area, city" />
        </Field>
        <div style={grid}>
          <Field label="Status" error={err('status')} hint={warehouse ? 'Inactive only once it holds no stock' : undefined} htmlFor="w-status">
            <Select id="w-status" {...register('status')} options={[{ value: 'active', label: 'Active' }, { value: 'planned', label: 'Planned' }, { value: 'inactive', label: 'Inactive' }]} />
          </Field>
          <Field label="Opens on" error={err('opens_on')} htmlFor="w-opens">
            <Input id="w-opens" type="date" {...register('opens_on')} />
          </Field>
        </div>
        <Switch label="Default warehouse for sales" checked={watch('is_default_for_sales')} onChange={(v) => setValue('is_default_for_sales', v, { shouldDirty: true })} />
      </div>
    </ResponsiveDialog>
  )
}
