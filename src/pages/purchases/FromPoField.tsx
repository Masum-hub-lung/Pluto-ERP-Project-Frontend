import { useState } from 'react'
import { api } from '../../api/client'
import type { Product, PurchaseOrder } from '../../api/contract.gen'
import { purchaseOrders } from '../../api/trade'
import { ds } from '../../ds'
import type { LineValues } from '../../components/document/lines'

/**
 * F3 "From PO" (backlog P10.2-FE-01): pick one of the supplier's open purchase orders (sent or partly received) and
 * prefill the bill with what is still to come, at the order's cost, each line linked to its order line so posting the
 * bill updates the order. The quantities stay editable (part deliveries).
 */
interface OrderLine { id: number; product_id: number; product_code: string; product_name: string; unit: string; description?: string | null; unit_cost: string
  discount_pct?: string | null; tax_rule_id?: number | null; remaining_quantity: string }

export function poToLines(po: PurchaseOrder): LineValues[] {
  return (po.lines as unknown as OrderLine[]).filter((l) => !/^0+(\.0+)?$/.test(l.remaining_quantity)).map((l) => ({
    product: { id: l.product_id, code: l.product_code, name: l.product_name, unit: l.unit, track_stock: true } as Product,
    description: l.description ?? '', quantity: l.remaining_quantity, price: l.unit_cost,
    discount_pct: l.discount_pct && !/^0+(\.0+)?$/.test(l.discount_pct) ? l.discount_pct : '', tax_rule_id: l.tax_rule_id ? String(l.tax_rule_id) : '', po_line_id: l.id,
  }))
}

export function FromPoField({ supplierId, value, onPick }: { supplierId: number | null; value: string; onPick: (po: PurchaseOrder | null) => void }) {
  const { Field, Select } = ds()
  const list = purchaseOrders.useList({ status: 'open', party_id: supplierId ?? undefined, per_page: 50 }, !!supplierId)
  const [loading, setLoading] = useState(false)
  const orders = list.data?.data ?? []
  const options = [{ value: '', label: supplierId ? (orders.length ? 'Not from an order' : 'No open orders') : 'Choose the supplier first' },
    ...orders.map((o) => ({ value: String(o.id), label: `${o.number} · ${o.order_date}` }))]
  if (value && !orders.some((o) => String(o.id) === value)) options.push({ value, label: 'Linked order' })

  async function choose(id: string) {
    if (!id) { onPick(null); return }
    setLoading(true)
    try {
      onPick((await api.request<{ data: PurchaseOrder }>('GET', `/purchase-orders/${id}`)).data.data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Field label="From purchase order" hint={loading ? 'Loading the order…' : 'Fills the lines still to come'} htmlFor="f-from-po">
      <Select key={options.length} id="f-from-po" options={options} value={value} disabled={!supplierId || loading} onChange={(e) => void choose(e.target.value)} data-testid="from-po" />
    </Field>
  )
}
