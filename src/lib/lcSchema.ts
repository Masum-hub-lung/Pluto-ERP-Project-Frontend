import { z } from 'zod'
import type { LetterOfCredit, LetterOfCreditInput, Party } from '../api/contract.gen'
import { isBlankItem, itemProblems, linesToRows, toLcLines, emptyItem, type LcItemRow } from './lcItems'

/**
 * M3 create / edit LC (backlog P16.2-FE): shape checks only. What a submit needs (supplier, amount, issuing bank, expiry;
 * BR-039) is checked by the server and comes back as 422 lc_submit_incomplete; a draft can be saved with less.
 * Items (PEP-487): `link` says where the LC's items come from — entered here (`items`, the default; the server keeps
 * them on a purchase order it creates) or an existing purchase order (`po`).
 */
export interface LcDocRow { name: string; provided_by: string; copies: string }

export interface LcFormValues {
  party: Party | null
  link: 'items' | 'po'
  lines: LcItemRow[]
  warehouse_id: string
  purchase_order_id: string
  intended_import: string
  goods_description: string
  quantity: string
  quantity_unit: string
  import_authorization_ref: string
  lc_type: 'irrevocable' | 'irrevocable_transferable' | 'standby'
  tenor: 'sight' | 'usance'
  usance_days: string
  incoterm: string
  currency_code: string
  amount: string
  tolerance_pct: string
  planning_rate: string
  partial_shipments: boolean
  transhipment: boolean
  confirmation_required: boolean
  issuing_bank_account_id: string
  advising_bank: string
  margin_pct: string
  margin_account_id: string
  application_date: string
  latest_shipment_date: string
  expiry_date: string
  presentation_days: string
  document_template_id: string
  documents: LcDocRow[]
  record_shipments: boolean
  port_of_loading: string
  port_of_discharge: string
  eta: string
  mode: 'sea' | 'air' | 'road'
}

const money = /^\d{1,16}(\.\d{1,2})?$/
const rate = /^\d{1,10}(\.\d{1,6})?$/
const pct = /^\d{1,3}(\.\d{1,4})?$/
const date = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')])

export const lcSchema = z.object({
  party: z.custom<Party | null>().refine((p) => !!p, 'Choose the supplier'),
  goods_description: z.string().trim().min(1, 'Describe the goods').max(500, 'Use at most 500 characters'),
  incoterm: z.string().trim().min(1, 'Choose the incoterm'),
  currency_code: z.string().regex(/^[A-Z]{3}$/, 'Choose the currency'),
  amount: z.string().trim().regex(money, 'Enter the LC amount (up to 2 decimals)'),
  planning_rate: z.string().trim().regex(rate, 'Enter the planning rate (up to 6 decimals)'),
  tolerance_pct: z.union([z.literal(''), z.string().trim().regex(pct, 'Enter a percentage')]),
  margin_pct: z.union([z.literal(''), z.string().trim().regex(pct, 'Enter a percentage from 0 to 100')]),
  usance_days: z.string(),
  application_date: date, latest_shipment_date: date, expiry_date: date,
}).passthrough().superRefine((v, ctx) => {
  const f = v as unknown as LcFormValues
  if (f.tenor === 'usance' && !/^[1-9]\d{0,2}$/.test(f.usance_days.trim())) ctx.addIssue({ code: 'custom', path: ['usance_days'], message: 'Enter the usance days (1–999)' })
  if (f.expiry_date && f.application_date && f.expiry_date <= f.application_date) ctx.addIssue({ code: 'custom', path: ['expiry_date'], message: 'The expiry must be after the application date' })
  if (f.latest_shipment_date && f.expiry_date && f.latest_shipment_date > f.expiry_date) ctx.addIssue({ code: 'custom', path: ['latest_shipment_date'], message: 'The latest shipment cannot be after the expiry' })
  if (f.link === 'items') {
    f.lines.forEach((row, i) => {
      if (isBlankItem(row)) return
      for (const [field, message] of Object.entries(itemProblems(row))) ctx.addIssue({ code: 'custom', path: ['lines', i, field], message })
    })
  }
})

const opt = (s: string) => (s.trim() === '' ? null : s.trim())
const id = (s: string) => (s ? Number(s) : null)

/** Form → API body. Documents are sent only on create (later they are edited one by one on M4). */
export function toLcInput(v: LcFormValues, creating: boolean): LetterOfCreditInput {
  return {
    party_id: v.party?.id ?? 0,
    purchase_order_id: v.link === 'po' ? id(v.purchase_order_id) : null,
    intended_import: v.link === 'items' ? opt(v.intended_import) : null,
    ...(v.link === 'items' ? { lines: toLcLines(v.lines), ...(v.warehouse_id ? { warehouse_id: Number(v.warehouse_id) } : {}) } : {}),
    goods_description: v.goods_description.trim(),
    quantity: opt(v.quantity), quantity_unit: opt(v.quantity_unit), import_authorization_ref: opt(v.import_authorization_ref),
    lc_type: v.lc_type, tenor: v.tenor, usance_days: v.tenor === 'usance' && v.usance_days.trim() ? Number(v.usance_days) : null,
    incoterm: v.incoterm.trim(), currency_code: v.currency_code, amount: v.amount.trim(), planning_rate: v.planning_rate.trim(),
    ...(v.tolerance_pct.trim() ? { tolerance_pct: v.tolerance_pct.trim() } : {}),
    ...(v.margin_pct.trim() ? { margin_pct: v.margin_pct.trim() } : {}),
    partial_shipments: v.partial_shipments, transhipment: v.transhipment, confirmation_required: v.confirmation_required,
    issuing_bank_account_id: id(v.issuing_bank_account_id), advising_bank: opt(v.advising_bank), margin_account_id: id(v.margin_account_id),
    application_date: opt(v.application_date), latest_shipment_date: opt(v.latest_shipment_date), expiry_date: opt(v.expiry_date),
    ...(v.presentation_days.trim() ? { presentation_days: Number(v.presentation_days) } : {}),
    ...(creating && v.document_template_id ? { document_template_id: Number(v.document_template_id) } : {}),
    ...(creating && !v.document_template_id ? { documents: v.documents.filter((d) => d.name.trim()).map((d) => ({ name: d.name.trim(), provided_by: d.provided_by.trim() || 'Supplier', copies: Number(d.copies) || 1 })) } : {}),
    ...(creating ? { record_shipments: v.record_shipments } : {}),
    ...(creating && v.record_shipments ? { shipment: { port_of_loading: opt(v.port_of_loading), port_of_discharge: opt(v.port_of_discharge), eta: opt(v.eta), mode: v.mode } } : {}),
  }
}

/**
 * Contract gap (P16): the LetterOfCredit resource does not return these input fields, so an edit form cannot show their
 * stored values. The backend's update changes only the fields sent, so an edit sends them only when the user changed them.
 */
export const NOT_IN_RESOURCE: Array<keyof LcFormValues> = ['link', 'purchase_order_id', 'intended_import', 'quantity', 'quantity_unit', 'import_authorization_ref', 'lc_type',
  'partial_shipments', 'transhipment', 'confirmation_required', 'advising_bank', 'margin_account_id', 'application_date', 'presentation_days']

/**
 * Edit body: drops the fields the resource does not return unless the user touched them (the link counts for PO and
 * intended import). The items and their warehouse are sent only when touched too: sending them replaces the lines of
 * the LC's order, which the server refuses once a bill uses them.
 */
export function editBody(input: LetterOfCreditInput, dirty: Partial<Record<keyof LcFormValues, unknown>>): LetterOfCreditInput {
  const out = { ...input } as Record<string, unknown>
  for (const f of NOT_IN_RESOURCE) {
    if (f === 'link') continue
    const touched = !!dirty[f] || ((f === 'purchase_order_id' || f === 'intended_import') && !!dirty.link)
    if (!touched) delete out[f]
  }
  if (!dirty.lines && !dirty.link && !dirty.warehouse_id) { delete out.lines; delete out.warehouse_id }
  // The order made from the LC's own items stays linked: never send it back as a chosen order.
  if ('lines' in out && !dirty.link) delete out.purchase_order_id
  return out as unknown as LetterOfCreditInput
}

/** Stored LC (or nothing) → form values; a fresh object every call. */
export function lcToForm(lc: LetterOfCredit | null, party: Party | null): LcFormValues {
  const x = (lc ?? {}) as Partial<LetterOfCredit> & Record<string, unknown>
  const s = (k: string) => (typeof x[k] === 'string' ? (x[k] as string) : '')
  return {
    party, link: lc?.items_source === 'purchase_order' ? 'po' : 'items',
    purchase_order_id: lc?.items_source === 'purchase_order' && x.purchase_order_id ? String(x.purchase_order_id) : '', intended_import: s('intended_import'),
    lines: lc?.items_source === 'entered' && lc.lines?.length ? linesToRows(lc.lines) : [emptyItem()],
    warehouse_id: lc?.items_source === 'entered' && lc.warehouse_id ? String(lc.warehouse_id) : '',
    goods_description: lc?.goods_description ?? '', quantity: s('quantity'), quantity_unit: s('quantity_unit'), import_authorization_ref: s('import_authorization_ref'),
    lc_type: (s('lc_type') || 'irrevocable') as LcFormValues['lc_type'], tenor: (lc?.tenor ?? 'sight') as LcFormValues['tenor'],
    usance_days: lc?.usance_days ? String(lc.usance_days) : '', incoterm: lc?.incoterm ?? 'CFR', currency_code: lc?.currency_code ?? 'USD',
    amount: lc?.amount ?? '', tolerance_pct: lc ? trimPct(lc.tolerance_pct) : '', planning_rate: lc?.planning_rate ?? '',
    partial_shipments: x.partial_shipments === true, transhipment: x.transhipment === true, confirmation_required: x.confirmation_required === true,
    issuing_bank_account_id: lc?.issuing_bank ? String(lc.issuing_bank.id) : '', advising_bank: s('advising_bank'), margin_pct: lc ? trimPct(lc.margin_pct) : '',
    margin_account_id: x.margin_account_id ? String(x.margin_account_id) : '', application_date: s('application_date'),
    latest_shipment_date: lc?.latest_shipment_date ?? '', expiry_date: lc?.expiry_date ?? '', presentation_days: x.presentation_days ? String(x.presentation_days) : '',
    document_template_id: '', documents: lc ? [] : [{ name: 'Bill of lading', provided_by: 'Supplier', copies: '3' }, { name: 'Commercial invoice', provided_by: 'Supplier', copies: '3' }],
    record_shipments: false, port_of_loading: '', port_of_discharge: '', eta: '', mode: 'sea',
  }
}

/** '5.0000' → '5', '2.5000' → '2.5' (display of a percentage the API sent; no arithmetic). */
export function trimPct(v: string | null | undefined): string {
  if (!v) return ''
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v
}

/** API field → form field for 422 errors. */
export const lcFieldMap: Record<string, keyof LcFormValues> = {
  party_id: 'party', purchase_order_id: 'purchase_order_id', intended_import: 'intended_import', goods_description: 'goods_description', quantity: 'quantity',
  tenor: 'tenor', usance_days: 'usance_days', incoterm: 'incoterm', currency_code: 'currency_code', amount: 'amount', tolerance_pct: 'tolerance_pct',
  planning_rate: 'planning_rate', issuing_bank_account_id: 'issuing_bank_account_id', margin_pct: 'margin_pct', margin_account_id: 'margin_account_id',
  application_date: 'application_date', latest_shipment_date: 'latest_shipment_date', expiry_date: 'expiry_date', presentation_days: 'presentation_days',
  warehouse_id: 'warehouse_id', lines: 'lines',
}

/** M3 section of each form field, for the section marks. */
export const LC_SECTIONS = [
  { key: 'supplier', label: 'Supplier and purchase', fields: ['party', 'purchase_order_id', 'intended_import', 'goods_description', 'quantity', 'lines', 'warehouse_id'] },
  { key: 'terms', label: 'Terms and amount', fields: ['tenor', 'usance_days', 'incoterm', 'currency_code', 'amount', 'tolerance_pct', 'planning_rate'] },
  { key: 'banks', label: 'Banks and dates', fields: ['issuing_bank_account_id', 'margin_pct', 'margin_account_id', 'application_date', 'latest_shipment_date', 'expiry_date', 'presentation_days'] },
  { key: 'documents', label: 'Documents', fields: ['documents'] },
  { key: 'shipment', label: 'Shipment', fields: ['port_of_loading', 'eta'] },
  { key: 'review', label: 'Review', fields: [] },
] as const

/** What still stops a submit (BR-039), from the form as typed — the server checks again. */
export function missingForSubmit(v: LcFormValues): string[] {
  const out: string[] = []
  if (!v.party) out.push('Supplier')
  if (!money.test(v.amount.trim()) || /^0*(\.0*)?$/.test(v.amount.trim())) out.push('LC amount')
  if (!v.issuing_bank_account_id) out.push('Issuing bank')
  if (!v.expiry_date) out.push('Expiry date')
  return out
}
