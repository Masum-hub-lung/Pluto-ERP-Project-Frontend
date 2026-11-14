import { useQueries } from '@tanstack/react-query'
import type { Product, ProductUnit } from '../../api/contract.gen'
import { productQuery } from '../../api/inventory'
import { ds } from '../../ds'
import { PHONE, useMediaQuery } from '../../lib/useMediaQuery'
import { ProductPicker } from '../../components/pickers/ProductPicker'

import { emptyItem, type LcItemRow } from '../../lib/lcItems'

/**
 * Editor for the items of a letter of credit (PEP-487; rows and helpers in lib/lcItems.ts): item, quantity, unit (the
 * item's units, BR-069), unit cost in the LC currency, optional description; Enter on the last row adds one; phones get
 * one card per item. Nothing is added up here.
 */
export function LcItemsEditor({ rows, onChange, errors = {}, currency, idPrefix = 'lc-item' }: {
  rows: LcItemRow[]; onChange: (rows: LcItemRow[]) => void
  /** `rowIndex.field` → message (fields: product, unit_id, quantity, unit_cost, description). */
  errors?: Record<string, string>; currency: string; idPrefix?: string
}) {
  const { Input, Select, Button, IconButton } = ds()
  const phone = useMediaQuery(PHONE)
  // Items of stored lines arrive without their units: fetch each once (shared cache with the product pages).
  const stubIds = [...new Set(rows.flatMap((r) => (r.product && !r.product.units ? [r.product.id] : [])))]
  const fetched = useQueries({ queries: stubIds.map((id) => productQuery(id)) })
  const full = new Map(fetched.flatMap((q) => (q.data ? [[q.data.product.id, q.data.product] as const] : [])))
  const unitsOf = (p: Product | null): ProductUnit[] | undefined => (p ? p.units ?? full.get(p.id)?.units : undefined)

  const set = (i: number, patch: Partial<LcItemRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const add = () => onChange([...rows, emptyItem()])
  const remove = (i: number) => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : [emptyItem()])
  const onEnter = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && i === rows.length - 1) { e.preventDefault(); add() }
  }
  const err = (i: number, f: string) => errors[`${i}.${f}`]

  const cells = (i: number) => {
    const r = rows[i]!
    const units = unitsOf(r.product)
    const unitOptions = units ? units.map((u) => ({ value: String(u.unit_id), label: u.name }))
      : r.product ? [{ value: r.unit_id, label: r.product.unit }] : [{ value: '', label: '—' }]
    const current = r.unit_id || (r.product && units ? String(units.find((u) => u.is_base)?.unit_id ?? '') : '')
    return {
      item: <ProductPicker value={r.product} onChange={(p) => set(i, { product: p, unit_id: p ? String(p.unit_id) : '' })} invalid={!!err(i, 'product')} aria-label={`Item ${i + 1}`} />,
      qty: <Input id={`${idPrefix}-qty-${i}`} value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} align="right" mono inputMode="decimal"
        invalid={!!err(i, 'quantity')} aria-label={`Quantity, item ${i + 1}`} onKeyDown={onEnter(i)} />,
      unit: <Select value={current} options={unitOptions} disabled={!r.product || !units || units.length < 2} invalid={!!err(i, 'unit_id')}
        aria-label={`Unit, item ${i + 1}`} data-testid={`${idPrefix}-unit-${i}`} onChange={(e) => set(i, { unit_id: e.target.value })} />,
      cost: <Input id={`${idPrefix}-cost-${i}`} value={r.unit_cost} onChange={(e) => set(i, { unit_cost: e.target.value })} align="right" mono inputMode="decimal"
        invalid={!!err(i, 'unit_cost')} aria-label={`Unit cost (${currency}), item ${i + 1}`} onKeyDown={onEnter(i)} />,
      note: <Input value={r.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Optional" invalid={!!err(i, 'description')}
        aria-label={`Description, item ${i + 1}`} onKeyDown={onEnter(i)} />,
      remove: <IconButton icon="trash-2" label={`Remove item ${i + 1}`} size="sm" onClick={() => remove(i)} />,
      messages: ['product', 'unit_id', 'quantity', 'unit_cost', 'description'].map((f) => err(i, f)).filter(Boolean) as string[],
    }
  }
  const notes = (i: number, messages: string[]) => messages.length > 0 && (
    <div role="alert" style={{ color: 'var(--negative)', fontSize: 12, lineHeight: '16px', marginTop: 4 }} data-testid={`${idPrefix}-errors-${i}`}>{messages.join(' · ')}</div>
  )

  return (
    <div data-testid={`${idPrefix}s`}>
      {phone ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((_, i) => {
            const c = cells(i)
            return (
              <li key={i} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>Item {i + 1}</strong>{c.remove}</div>
                {c.item}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{c.qty}{c.unit}</div>
                {c.cost}
                {c.note}
                {notes(i, c.messages)}
              </li>
            )
          })}
        </ul>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="lf-table lf-linegrid" style={{ width: '100%', minWidth: 800, tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: 36 }} /><col /><col style={{ width: 132 }} /><col style={{ width: 100 }} /><col style={{ width: 130 }} /><col style={{ width: 170 }} /><col style={{ width: 44 }} /></colgroup>
            <thead>
              <tr><th>#</th><th>Item</th><th>Qty</th><th>Unit</th><th>Unit cost ({currency})</th><th>Description</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((_, i) => {
                const c = cells(i)
                return (
                  <tr key={i} style={{ verticalAlign: 'top' }}>
                    <td className="lf-num" style={{ paddingTop: 18 }}>{i + 1}</td>
                    <td>{c.item}{notes(i, c.messages)}</td>
                    <td>{c.qty}</td><td>{c.unit}</td><td>{c.cost}</td><td>{c.note}</td><td style={{ paddingTop: 10 }}>{c.remove}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <Button variant="secondary" icon="plus" size="sm" onClick={add} data-testid={`${idPrefix}-add`}>Add item</Button>
      </div>
    </div>
  )
}
