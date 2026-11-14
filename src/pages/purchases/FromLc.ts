import { api } from '../../api/client'
import type { LetterOfCredit, Party, PurchaseOrder } from '../../api/contract.gen'
import type { LineValues } from '../../components/document/lines'
import { poToLines } from './FromPoField'

/**
 * F3 "choose an LC first" (BR-056): what a bill needs from a letter of credit. Loads the LC, its supplier and, when the
 * LC keeps its items on a purchase order (entered on the LC, PEP-487, or an order it was raised against), that order,
 * whose still-to-come lines fill the bill (poToLines). An LC without items fills only the header and offers to add its
 * items once on the LC; its goods description and quantity are shown as a reference.
 */
export interface LcFill {
  lc: LetterOfCredit
  party: Party
  po: PurchaseOrder | null
  lines: LineValues[]
  /** What to tell the user about the lines; null when the order's remaining lines were loaded. */
  note: { tone: 'info' | 'warning'; title: string; text: string; action?: { label: string; to: string } } | null
}

export async function loadLcForBill(id: number, signal?: AbortSignal): Promise<LcFill> {
  const lc = (await api.request<{ data: LetterOfCredit }>('GET', `/letters-of-credit/${id}`, { signal })).data.data
  const [party, po] = await Promise.all([
    api.request<{ data: Party }>('GET', `/parties/${lc.party.id}`, { signal }).then((r) => r.data.data),
    lc.purchase_order_id ? api.request<{ data: PurchaseOrder }>('GET', `/purchase-orders/${lc.purchase_order_id}`, { signal }).then((r) => r.data.data) : Promise.resolve(null),
  ])
  const goods = [lc.goods_description, lc.quantity ? `${lc.quantity} ${lc.quantity_unit ?? ''}`.trim() : null].filter(Boolean).join(' · ')
  if (!po) {
    return { lc, party, po, lines: [], note: { tone: 'info', title: `${lc.lc_number} has no items yet`,
      text: `Add its items once on the LC and its bills fill themselves, or enter what you received below. LC goods: ${goods}.`,
      action: { label: `Add the items to ${lc.lc_number}`, to: `/lc/${lc.id}?add-items=1` } } }
  }
  if (po.status === 'closed' || po.status === 'cancelled') {
    return { lc, party, po: null, lines: [], note: { tone: 'warning', title: `${po.number} is ${po.status}`, text: `Its lines cannot be received any more, and a bill from ${lc.lc_number} may hold only its items. LC goods: ${goods}.` } }
  }
  const lines = poToLines(po)
  if (!lines.length) {
    return { lc, party, po, lines, note: { tone: 'warning', title: 'Everything on this LC has already been billed', text: `Every line of ${po.number} has been received in full, so there is nothing left to bill against ${lc.lc_number}.` } }
  }
  return { lc, party, po, lines, note: null }
}
