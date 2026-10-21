import { useState } from 'react'
import { lf, type DataColumn } from '../ds'

type Row = Record<string, unknown> & { id: number }

/**
 * DataTable with row selection (lf().DataTable has none): a checkbox column and, while rows are selected, a bar
 * "N selected · <actions>" — used for bulk actions such as "Deactivate selected" (B1/C1). `actions` gets the ids
 * and a `clear()` to call after the action succeeded. Selection is per page.
 */
export function SelectableTable({ columns, rows, actions, ...table }: {
  columns: DataColumn[]; rows: Row[]; actions: (ids: number[], clear: () => void) => React.ReactNode
  onRowClick?: (row: any) => void; rowActions?: (row: any) => React.ReactNode; emptyState?: React.ReactNode; loading?: boolean; caption?: string
}) {
  const { DataTable, Button } = lf()
  const [selected, setSelected] = useState<number[]>([])
  const visible = selected.filter((id) => rows.some((r) => r.id === id))
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const all = rows.length > 0 && visible.length === rows.length
  const check: DataColumn = {
    key: '__select', label: 'Select', width: 44,
    render: (_v, r: Row) => (
      <input type="checkbox" checked={visible.includes(r.id)} aria-label={`Select ${String(r.name ?? r.id)}`}
        onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} style={{ width: 16, height: 16, accentColor: 'var(--brand)' }} />
    ),
  }
  return (
    <>
      {visible.length > 0 && (
        <div role="region" aria-label="Selection" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 16px', background: 'var(--brand-soft)', borderBottom: '1px solid var(--line)' }}>
          <strong>{visible.length} selected</strong>
          <Button size="sm" variant="ghost" onClick={() => setSelected(all ? [] : rows.map((r) => r.id))}>{all ? 'Clear selection' : `Select all ${rows.length}`}</Button>
          <span style={{ flex: 1 }} />
          {actions(visible, () => setSelected([]))}
        </div>
      )}
      <DataTable {...table} columns={[check, ...columns]} rows={rows} />
    </>
  )
}
