import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { LetterOfCredit } from '../../api/contract.gen'
import { useWarehouses } from '../../api/inventory'
import { lcLive, useAddLcItems } from '../../api/lc'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { compareDecimal } from '../../lib/decimal'
import { emptyItem, isBlankItem, itemErrors, itemProblems, sentIndexes, toLcLines, type LcItemRow } from '../../lib/lcItems'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { LcItemsEditor } from './LcItemsEditor'

/**
 * M4 "Items on this LC" (PEP-487): the LC's items as the API returns them (read from its purchase order) with what
 * has been received and what is still to come, the server's items total next to the LC amount, and — for an LC that
 * has no items yet — the "Add items" action. Once opened, items change only through an amendment (BR-041).
 */
export function LcItemsCard({ lc, onAdd, onAmend }: { lc: LetterOfCredit; onAdd: () => void; onAmend: () => void }) {
  const { Card, Button, Banner, EmptyState } = ds()
  const { can } = useSession()
  const lines = lc.lines ?? []
  const canAdd = lc.items_source === 'none' && can('lc.edit') && !['closed', 'cancelled'].includes(lc.status)
  const differs = lc.lines_total != null && compareDecimal(lc.lines_total, lc.amount) !== 0
  const actions = canAdd ? <Button size="sm" variant="primary" icon="plus" onClick={onAdd} data-testid="lc-add-items">Add items</Button>
    : lines.length > 0 && lcLive(lc.status) && can('lc.edit') ? <Button size="sm" variant="secondary" icon="file-pen" onClick={onAmend} data-testid="lc-amend-items">Change by amendment</Button>
      : undefined
  return (
    <div data-testid="lc-items-card"><Card title="Items on this LC" padding="none" actions={actions}
      subtitle={lc.purchase_order_number ? (lc.items_source === 'entered' ? `Kept on ${lc.purchase_order_number}` : `From purchase order ${lc.purchase_order_number}`) : undefined}>
      {lines.length === 0 ? (
        <EmptyState icon="package" title="No items on this LC yet"
          description={canAdd ? 'Add the items once and every purchase bill made from this LC fills itself.' : 'This LC was raised without items.'} />
      ) : (
        <>
          {differs && (
            <div style={{ padding: '12px 16px 0' }} data-testid="lc-items-differ">
              <Banner tone="warning" title="The items and the LC amount are not the same">
                The items add up to {lc.currency_code} {lc.lines_total}; the LC amount is {lc.currency_code} {lc.amount}.
              </Banner>
            </div>
          )}
          <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="Items on this LC">
            <table className="lf-table" style={{ width: '100%', minWidth: 720 }} data-testid="lc-items-table">
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Items on this LC</caption>
              <thead>
                <tr><th scope="col">#</th><th scope="col">Item</th><th scope="col" style={{ textAlign: 'right' }}>Quantity</th><th scope="col">Unit</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Unit cost ({lc.currency_code})</th><th scope="col" style={{ textAlign: 'right' }}>Line total ({lc.currency_code})</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Received</th><th scope="col" style={{ textAlign: 'right' }}>Still to come</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} data-testid={`lc-item-${l.id}`}>
                    <td className="lf-num">{l.line_no}</td>
                    <td><strong>{l.product_name}</strong><br /><span className="lf-mono" style={{ color: 'var(--ink-muted)', fontSize: 12 }}>{l.product_code}{l.description ? ` · ${l.description}` : ''}</span></td>
                    <td className="lf-num" style={{ textAlign: 'right' }}>{l.quantity}</td>
                    <td>{l.unit}</td>
                    <td className="lf-num" style={{ textAlign: 'right' }}>{l.unit_cost}</td>
                    <td className="lf-num" style={{ textAlign: 'right' }}>{l.line_total}</td>
                    <td className="lf-num" style={{ textAlign: 'right' }}>{l.received_quantity}</td>
                    <td className="lf-num" style={{ textAlign: 'right', fontWeight: 600 }}>{l.remaining_quantity}</td>
                  </tr>
                ))}
              </tbody>
              {lc.lines_total != null && (
                <tfoot>
                  <tr><th scope="row" colSpan={5} style={{ textAlign: 'right' }}>Items total</th>
                    <td className="lf-num" style={{ textAlign: 'right', fontWeight: 600 }} data-testid="lc-items-total">{lc.lines_total}</td><td colSpan={2} /></tr>
                </tfoot>
              )}
            </table>
          </div>
          <p style={{ margin: 0, padding: '10px 16px', color: 'var(--ink-muted)', fontSize: 13, borderTop: '1px solid var(--line)' }}>
            {lc.purchase_order_id && can('purchases.view') && <><Link to={`/purchases/orders/${lc.purchase_order_id}`}>{lc.purchase_order_number}</Link> · </>}
            {lcLive(lc.status) ? 'A bill from this LC may hold only these items; they change through an accepted amendment.'
              : ['draft', 'awaiting_bank'].includes(lc.status) ? 'Edit the LC to change its items until the bank opens it.' : 'The items of this LC.'}
          </p>
        </>
      )}
    </Card></div>
  )
}

/** "Add items" for an LC that has none (POST /letters-of-credit/{id}/items): the same editor as the LC form, plus the arrival warehouse. */
export function AddItemsDialog({ lc, onClose }: { lc: LetterOfCredit; onClose: () => void }) {
  const { Field, Select, Button } = ds()
  const toast = useToast()
  const add = useAddLcItems(lc.id)
  const idem = useIdempotencyKey()
  const warehouses = useWarehouses()
  const [rows, setRows] = useState<LcItemRow[]>(() => [emptyItem()])
  const [warehouse, setWarehouse] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const filled = rows.some((r) => !isBlankItem(r))

  const save = async () => {
    setError(null)
    const local: Record<string, string> = {}
    rows.forEach((r, i) => { if (!isBlankItem(r)) for (const [f, m] of Object.entries(itemProblems(r))) local[`${i}.${f}`] = m })
    setErrors(local)
    if (Object.keys(local).length) return
    try {
      const r = await add.mutateAsync({ input: { lines: toLcLines(rows), ...(warehouse ? { warehouse_id: Number(warehouse) } : {}) }, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `Items added to ${r.lc_number}`, description: `${r.lines?.length ?? 0} items · ${r.currency_code} ${r.lines_total ?? ''} · bills from this LC now fill themselves.` })
      onClose()
    } catch (e) {
      const placed = e instanceof ApiError && e.status === 422 ? itemErrors(e.fieldErrors, sentIndexes(rows)) : {}
      setErrors(placed)
      setError(e)
    }
  }
  const fieldErr = error instanceof ApiError && error.status === 422 ? error.fieldErrors : {}
  return (
    <ResponsiveDialog title={`Add items — ${lc.lc_number}`} onClose={onClose} testId="lc-add-items-dialog" width={860}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!filled} loading={add.isPending} onClick={() => void save()} data-testid="save-lc-items">Add items</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={Object.keys(errors).length ? null : error} />
        <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13 }}>
          What {lc.lc_number} covers, at the unit cost in {lc.currency_code}. This is done once; afterwards the items of an opened LC change through an amendment.
        </p>
        <LcItemsEditor rows={rows} onChange={setRows} errors={errors} currency={lc.currency_code} idPrefix="lc-add-item" />
        <div style={{ maxWidth: 320 }}>
          <Field label="Arrival warehouse" htmlFor="lc-items-warehouse" error={fieldErr.warehouse_id?.[0]} hint="Where the goods will be received">
            <Select id="lc-items-warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}
              options={[{ value: '', label: 'Head office warehouse' }, ...(warehouses.data ?? []).filter((w) => w.status === 'active').map((w) => ({ value: String(w.id), label: w.name }))]} />
          </Field>
        </div>
        <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13 }}>The items total is worked out when you save.</p>
      </div>
    </ResponsiveDialog>
  )
}
