import { useRef, useState } from 'react'
import { ds, type DataColumn } from '../ds'

type Row = Record<string, unknown> & { id: number }

/**
 * DataTable with row selection (ds().DataTable has none): a checkbox column and, while rows are selected, a bar
 * "N selected · <actions>" — used for bulk actions such as "Deactivate selected" (B1/C1). `actions` gets the ids
 * , a `clear()` to call after the action succeeded, and the names of every row seen so far (for messages about rows
 * selected on other pages). The selection survives page changes (P2.2-FE-05): ids stay
 * selected while the user pages, and "Select all on this page" adds or removes only the visible rows.
 */
export function SelectableTable({ columns, rows, actions, ...table }: {
  columns: DataColumn[]; rows: Row[]; actions: (ids: number[], clear: () => void, names: Map<number, string>) => React.ReactNode
  onRowClick?: (row: any) => void; rowActions?: (row: any) => React.ReactNode; emptyState?: React.ReactNode; loading?: boolean; caption?: string
}) {
  const { DataTable, Button } = ds()
  const [selected, setSelected] = useState<number[]>([])
  const names = useRef(new Map<number, string>()).current
  for (const r of rows) names.set(r.id, String(r.name ?? r.id))
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const pageIds = rows.map((r) => r.id)
  const pageAll = rows.length > 0 && pageIds.every((id) => selected.includes(id))
  const onOtherPages = selected.filter((id) => !pageIds.includes(id)).length
  const check: DataColumn = {
    key: '__select', label: 'Select', width: 44,
    render: (_v, r: Row) => (
      <input type="checkbox" checked={selected.includes(r.id)} aria-label={`Select ${String(r.name ?? r.id)}`}
        onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} style={{ width: 16, height: 16, accentColor: 'var(--brand)' }} />
    ),
  }
  return (
    <div className="lf-selectable">
      {selected.length > 0 && (
        <div role="region" aria-label="Selection" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 16px', background: 'var(--brand-soft)', borderBottom: '1px solid var(--line)' }}>
          <strong data-testid="selection-count">{selected.length} selected</strong>
          {onOtherPages > 0 && <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>({onOtherPages} on other pages)</span>}
          <Button size="sm" variant="ghost" onClick={() => setSelected((s) => (pageAll ? s.filter((id) => !pageIds.includes(id)) : [...new Set([...s, ...pageIds])]))}>
            {pageAll ? 'Clear this page' : 'Select all on this page'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear selection</Button>
          <span style={{ flex: 1 }} />
          {actions(selected, () => setSelected([]), names)}
        </div>
      )}
      <DataTable {...table} columns={[check, ...columns]} rows={rows} />
    </div>
  )
}
