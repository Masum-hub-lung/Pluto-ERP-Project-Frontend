import { useQueries } from '@tanstack/react-query'
import { useFieldArray, type Control, type FieldErrors, type UseFormRegister, type UseFormSetValue, type UseFormWatch } from 'react-hook-form'
import type { CalculatedLine, Product, ProductUnit, TaxRule } from '../../api/contract.gen'
import { productQuery } from '../../api/inventory'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { PHONE, useMediaQuery } from '../../lib/useMediaQuery'
import { ProductPicker } from '../pickers/ProductPicker'
import { emptyLine, type LineValues } from './lines'
import './document.css'

/**
 * Line grid of a trade document (F3/E3; backlog P4.4-FE-03): # · item · qty · unit · price · disc % · tax · line total ·
 * remove. There is no description input (owner, 3 Nov 2026); a description already on a saved line is kept as it is.
 * Unit (P10.7-FE-02, BR-069): the item's base unit or one of its extra units (1 box = 12 pcs); quantity and price are
 * per that unit, and choosing a unit fills that unit's price as the API gives it (`ProductUnit`, never multiplied here).
 * Lines loaded from a saved document carry only the item's code and name, so their item is fetched for its units.
 * The line total and on-hand come from the calculate result (`results`, keyed by form row); nothing is computed here.
 * Choosing an item fills the price from `defaultPrice` (purchase cost for bills, selling or wholesale price for
 * invoices). "Add line", or Enter in the last row, adds a row; blank rows are ignored on save. Errors from 422
 * (lines.N.field) and calculate warnings show under their row. Phones get one card per line.
 */
export function LineGrid<F extends { lines: LineValues[] }>(props: {
  control: Control<F>; register: UseFormRegister<F>; watch: UseFormWatch<F>; setValue: UseFormSetValue<F>; errors: FieldErrors<F>
  side: 'purchase' | 'sale'; results: Record<number, CalculatedLine>; warnings?: Record<number, string[]>; taxRules: TaxRule[]
  defaultPrice: (p: Product, unit: ProductUnit | undefined) => string; priceLabel?: string
}) {
  // Field paths are built at run time (lines.N.field), so the form is handled untyped inside.
  const { control, register, watch, setValue, errors, side, results, warnings = {}, taxRules, defaultPrice, priceLabel } = props as unknown as {
    control: Control<any>; register: UseFormRegister<any>; watch: UseFormWatch<any>; setValue: UseFormSetValue<any>; errors: FieldErrors<any>
    side: 'purchase' | 'sale'; results: Record<number, CalculatedLine>; warnings?: Record<number, string[]>; taxRules: TaxRule[]
    defaultPrice: (p: Product, unit: ProductUnit | undefined) => string; priceLabel?: string
  }
  const { Input, Select, Button, IconButton } = ds()
  const phone = useMediaQuery(PHONE)
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const label = priceLabel ?? (side === 'purchase' ? 'Cost' : 'Price')
  const rules = taxRules.filter((t) => t.is_active && (t.applies_to === 'both' || t.applies_to === (side === 'purchase' ? 'purchases' : 'sales')))
  const taxOptions = [{ value: '', label: 'No tax' }, ...rules.map((t) => ({ value: String(t.id), label: t.name }))]
  const err = (i: number, f: string) => ((errors.lines as unknown as Record<string, { message?: string }>[] | undefined)?.[i])?.[f]?.message
  const add = () => append(emptyLine(), { shouldFocus: false })
  const onEnter = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && i === fields.length - 1) { e.preventDefault(); add() }
  }

  // Items of saved lines arrive without their units: fetch each once (shared cache with the product pages).
  const lines = (watch('lines') ?? []) as LineValues[]
  const stubIds = [...new Set(lines.flatMap((l) => (l.product && !l.product.units ? [l.product.id] : [])))]
  const fetched = useQueries({ queries: stubIds.map((id) => productQuery(id)) })
  const full = new Map(fetched.flatMap((q) => (q.data ? [[q.data.product.id, q.data.product] as const] : [])))
  const unitsOf = (p: Product | null): ProductUnit[] | undefined => (p ? p.units ?? full.get(p.id)?.units : undefined)
  const baseName = (p: Product) => unitsOf(p)?.find((u) => u.is_base)?.name ?? (p.units ? p.unit : full.get(p.id)?.unit) ?? ''

  const choose = (i: number, p: Product | null) => {
    setValue(`lines.${i}.product`, p, { shouldDirty: true })
    const base = p?.units?.find((u) => u.is_base)
    setValue(`lines.${i}.unit_id`, p ? String(p.unit_id) : '', { shouldDirty: true })
    if (p) setValue(`lines.${i}.price`, defaultPrice(p, base), { shouldDirty: true })
    if (p && p.tax_rule_id && rules.some((t) => t.id === p.tax_rule_id)) setValue(`lines.${i}.tax_rule_id`, String(p.tax_rule_id), { shouldDirty: true })
  }
  const chooseUnit = (i: number, p: Product, unitId: string) => {
    setValue(`lines.${i}.unit_id`, unitId, { shouldDirty: true })
    const unit = unitsOf(p)?.find((u) => String(u.unit_id) === unitId)
    if (unit) setValue(`lines.${i}.price`, defaultPrice(full.get(p.id) ?? p, unit), { shouldDirty: true })
  }

  const cells = (i: number) => {
    const product = watch(`lines.${i}.product`) as Product | null
    const unitId = (watch(`lines.${i}.unit_id`) as string | undefined) ?? ''
    const units = unitsOf(product)
    const r = results[i]
    // Until a saved line's item has loaded, its own unit is the only choice (its name is on the line).
    const unitOptions = units ? units.map((u) => ({ value: String(u.unit_id), label: u.name }))
      : product ? [{ value: unitId, label: product.unit }] : [{ value: '', label: '—' }]
    const current = unitId || (product && units ? String(units.find((u) => u.is_base)?.unit_id ?? '') : '')
    return {
      item: <ProductPicker value={product} onChange={(p) => choose(i, p)} invalid={!!err(i, 'product')} aria-label={`Item, line ${i + 1}`} />,
      unit: <Select value={current} options={unitOptions} disabled={!product || !units || units.length < 2} invalid={!!err(i, 'unit_id')}
        aria-label={`Unit, line ${i + 1}`} data-testid={`line-unit-${i}`} onChange={(e) => product && chooseUnit(i, product, e.target.value)} />,
      onHand: product && product.track_stock && r?.available_qty != null ? `${r.available_qty} ${baseName(product)} on hand` : '',
      qty: <Input {...register(`lines.${i}.quantity`)} align="right" mono inputMode="decimal" invalid={!!err(i, 'quantity')} aria-label={`Quantity, line ${i + 1}`} onKeyDown={onEnter(i)} />,
      price: <Input {...register(`lines.${i}.price`)} align="right" mono inputMode="decimal" invalid={!!err(i, 'price')} aria-label={`${label}, line ${i + 1}`} onKeyDown={onEnter(i)} />,
      disc: <Input {...register(`lines.${i}.discount_pct`)} align="right" mono inputMode="decimal" placeholder="0" invalid={!!err(i, 'discount_pct')} aria-label={`Discount %, line ${i + 1}`} onKeyDown={onEnter(i)} />,
      tax: <Select {...register(`lines.${i}.tax_rule_id`)} options={taxOptions} aria-label={`Tax, line ${i + 1}`} />,
      total: <span className="lf-num" data-testid={`line-total-${i}`}>{r ? formatTaka(r.line_total) : '—'}</span>,
      remove: <IconButton icon="trash-2" label={`Remove line ${i + 1}`} size="sm" onClick={() => (fields.length > 1 ? remove(i) : setValue(`lines.${i}`, emptyLine()))} />,
      messages: [...['product', 'unit_id', 'quantity', 'price', 'discount_pct', 'tax_rule_id'].map((f) => err(i, f)).filter(Boolean), ...(warnings[i] ?? [])] as string[],
    }
  }
  const notes = (i: number, messages: string[]) => messages.length > 0 && (
    <div role="alert" style={{ color: 'var(--negative)', fontSize: 12, lineHeight: '16px' }} data-testid={`line-errors-${i}`}>{messages.join(' · ')}</div>
  )

  return (
    <div data-testid="line-grid">
      {phone ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fields.map((f, i) => {
            const c = cells(i)
            return (
              <li key={f.id} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>Line {i + 1}</strong>{c.remove}</div>
                {c.item}
                {c.onHand && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{c.onHand}</span>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{c.qty}{c.unit}{c.price}{c.disc}{c.tax}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-muted)' }}>Line total</span>{c.total}</div>
                {notes(i, c.messages)}
              </li>
            )
          })}
        </ul>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          {/* Fixed layout: the column widths hold even though the inputs would like to be wider. */}
          <table className="lf-table lf-linegrid" style={{ width: '100%', minWidth: 900, tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: 36 }} /><col /><col style={{ width: 100 }} /><col style={{ width: 110 }} /><col style={{ width: 120 }} />
              <col style={{ width: 80 }} /><col style={{ width: 140 }} /><col style={{ width: 120 }} /><col style={{ width: 44 }} /></colgroup>
            <thead>
              <tr><th>#</th><th>Item</th><th>Qty</th><th>Unit</th><th>{label}</th><th>Disc %</th><th>Tax</th>
                <th style={{ textAlign: 'right' }}>Line total</th><th /></tr>
            </thead>
            <tbody>
              {fields.map((f, i) => {
                const c = cells(i)
                return (
                  <tr key={f.id} style={{ verticalAlign: 'top' }}>
                    <td className="lf-num" style={{ paddingTop: 18 }}>{i + 1}</td>
                    <td>{c.item}{c.onHand && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>{c.onHand}</div>}{notes(i, c.messages)}</td>
                    <td>{c.qty}</td><td>{c.unit}</td><td>{c.price}</td><td>{c.disc}</td><td>{c.tax}</td>
                    <td style={{ textAlign: 'right', paddingTop: 18 }}>{c.total}</td><td style={{ paddingTop: 10 }}>{c.remove}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <Button variant="secondary" icon="plus" size="sm" onClick={add} data-testid="add-line">Add line</Button>
      </div>
    </div>
  )
}
