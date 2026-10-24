import type { ReactNode } from 'react'
import type { UseFormRegister } from 'react-hook-form'
import type { Warehouse } from '../../api/contract.gen'
import { ds } from '../../ds'

/**
 * Document header fields (F3/E3; backlog P4.4-FE-04): date, due date, warehouse and a slot for side-specific
 * references (supplier's bill number, customer PO …). An empty due date means "the date + the party's payment-term
 * days" (BR-055), filled in by the server when the document is saved.
 */
export function DocumentHeader({ register, errors, warehouses, dateLabel = 'Date', warehouseLabel = 'Warehouse', children }: {
  register: UseFormRegister<any>; errors: Record<string, string | undefined>; warehouses: Warehouse[]; dateLabel?: string; warehouseLabel?: string; children?: ReactNode
}) {
  const { Field, Input, Select } = ds()
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 } as const
  const options = [{ value: '', label: 'Choose…' }, ...warehouses.filter((w) => w.status !== 'inactive').map((w) => ({ value: String(w.id), label: w.name }))]
  return (
    <div style={grid} data-testid="document-header">
      {children}
      <Field label={dateLabel} required error={errors.date} htmlFor="doc-date">
        <Input id="doc-date" type="date" {...register('date')} invalid={!!errors.date} />
      </Field>
      <Field label="Due date" error={errors.due_date} hint="Empty: date + payment terms" htmlFor="doc-due">
        <Input id="doc-due" type="date" {...register('due_date')} invalid={!!errors.due_date} />
      </Field>
      <Field label={warehouseLabel} required error={errors.warehouse_id} htmlFor="doc-warehouse">
        <Select key={options.length} id="doc-warehouse" options={options} {...register('warehouse_id')} invalid={!!errors.warehouse_id} />
      </Field>
    </div>
  )
}
