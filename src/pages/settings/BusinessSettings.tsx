import { useEffect, useState, type ReactNode } from 'react'
import { ApiError } from '../../api/client'
import type { CompanySettings, CompanySettingsUpdate, NumberSequence } from '../../api/contract.gen'
import { useWarehouses } from '../../api/inventory'
import { useCompanySettings } from '../../api/platform'
import { usePaymentTerms } from '../../api/parties'
import { useCompany, useNumberSequences, useUpdateSequence, useUpdateSettings } from '../../api/settings'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ConflictBanner } from '../../components/ConflictBanner'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden } from '../../components/states'
import { SettingsLayout } from './SettingsLayout'

/**
 * K3 Preferences (numbering, defaults, controls), K5 Currency and region, K7 Invoice design with a live A4 preview
 * (Settings.dc.html; FR-081, FR-083, FR-085; backlog P15.2-FE-03/04). Each page edits a part of GET /company/settings
 * and saves only what changed with PATCH (If-Match); a series' next number can only go up (BR-006). Valuation is
 * weighted average in this release.
 */
type Draft = CompanySettingsUpdate & { invoice?: Invoice }
interface Invoice { template?: string; accent_color?: string; show_logo?: boolean; show_words?: boolean; show_bank?: boolean; show_signature?: boolean; footer_note?: string | null }

function useSettingsDraft<K extends keyof CompanySettings>(keys: K[]) {
  const q = useCompanySettings()
  const update = useUpdateSettings()
  const toast = useToast()
  const pickKeys = (s: CompanySettings) => Object.fromEntries(keys.map((k) => [k, s[k]])) as Draft
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState(false)
  useEffect(() => { if (q.data) setDraft(pickKeys(q.data)) }, [q.data?.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const original = q.data ? pickKeys(q.data) : null
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(original)
  const changed = () => Object.fromEntries(Object.entries(draft ?? {}).filter(([k, val]) => JSON.stringify(val) !== JSON.stringify((original as Record<string, unknown>)?.[k]))) as Draft
  async function save(extra?: () => Promise<void>, what = 'Settings') {
    setError(null)
    setConflict(false)
    try {
      const body = changed()
      if (Object.keys(body).length > 0) await update.mutateAsync({ input: body as CompanySettingsUpdate, version: q.data!.version })
      await extra?.()
      toast({ tone: 'positive', title: `${what} saved` })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else setError(e)
    }
  }
  return { q, draft, setDraft, dirty, save, saving: update.isPending, error, conflict, reload: () => { setConflict(false); void q.refetch() }, discard: () => q.data && setDraft(pickKeys(q.data)) }
}

function Frame({ title, current, description, s, extraDirty = false, onSave, onDiscard, children }: {
  title: string; current: string; description: string; s: ReturnType<typeof useSettingsDraft>; extraDirty?: boolean; onSave: () => void; onDiscard?: () => void; children: ReactNode
}) {
  const { Button } = ds()
  const { can } = useSession()
  const dirty = s.dirty || extraDirty
  const guard = useUnsavedChangesBlocker(dirty, `Your changes to ${title.toLowerCase()} are not saved.`)
  if (!can('settings.view')) return <Forbidden permission="settings.view" what={title.toLowerCase()} />
  if (!s.draft) return s.q.error ? <ProblemBanner error={s.q.error} onRetry={() => void s.q.refetch()} /> : <PageSkeleton template="form" />
  return (
    <SettingsLayout current={current} eyebrow="Settings › Business" title={title} description={description}
      actions={can('settings.edit') ? <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="ghost" disabled={!dirty} onClick={() => { s.discard(); onDiscard?.() }}>Discard</Button>
        <Button variant="primary" loading={s.saving} disabled={!dirty} onClick={onSave} data-testid="save-settings">Save changes</Button>
      </div> : undefined}>
      {s.conflict && <ConflictBanner onReload={s.reload} />}
      <ProblemBanner error={s.error} />
      {children}
      {guard.dialog}
    </SettingsLayout>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 200, flex: '1 1 240px' }}>
        <span style={{ fontWeight: 600 }}>{label}</span>{hint && <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{hint}</span>}
      </span>
      <span style={{ flex: '0 1 auto', maxWidth: '100%', overflowX: 'auto' }}>{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------- K3

const DOC_LABELS: Record<string, string> = { customer: 'Customers', supplier: 'Suppliers', sales_invoice: 'Sales invoices', purchase_bill: 'Purchase bills',
  quotation: 'Quotations', purchase_order: 'Purchase orders', receipt: 'Receipts', payment: 'Payments', journal: 'Journal vouchers', contra: 'Contra vouchers',
  expense: 'Expenses', income: 'Income', sales_return: 'Sales returns', purchase_return: 'Purchase returns', credit_note: 'Credit notes', debit_note: 'Debit notes',
  stock_adjustment: 'Stock adjustments', stock_transfer: 'Stock transfers', system_journal: 'System journals' }

export function Preferences() {
  const { Card, Select, Switch, Input } = ds()
  const { can } = useSession()
  const editable = can('settings.edit')
  const s = useSettingsDraft(['default_warehouse_id', 'default_payment_term_id', 'valuation_method', 'invoice_rounding', 'allow_negative_stock', 'require_approval', 'backdate_warning_days'])
  const seqs = useNumberSequences()
  const updateSeq = useUpdateSequence()
  const warehouses = useWarehouses()
  const terms = usePaymentTerms()
  const [edits, setEdits] = useState<Record<number, { prefix: string; next_number: string; padding: string }>>({})
  const [seqErrors, setSeqErrors] = useState<Record<number, string>>({})
  const changedSeqs = (seqs.data ?? []).filter((q) => edits[q.id] && (edits[q.id].prefix !== q.prefix || edits[q.id].next_number !== String(q.next_number) || edits[q.id].padding !== String(q.padding)))
  const d = s.draft
  const set = (patch: Draft) => s.setDraft({ ...d, ...patch })
  const row = (q: NumberSequence) => edits[q.id] ?? { prefix: q.prefix, next_number: String(q.next_number), padding: String(q.padding) }

  async function saveSequences() {
    const errs: Record<number, string> = {}
    for (const q of changedSeqs) {
      const e = edits[q.id]
      try {
        await updateSeq.mutateAsync({ id: q.id, version: q.version, input: { prefix: e.prefix, next_number: Number(e.next_number), padding: Number(e.padding) } })
      } catch (err) {
        errs[q.id] = err instanceof ApiError ? Object.values(err.fieldErrors)[0]?.[0] ?? err.problem.detail ?? err.problem.title : 'Could not save'
      }
    }
    setSeqErrors(errs)
    if (Object.keys(errs).length === 0) setEdits({})
    else throw new Error('Some number series were not saved')
  }

  return (
    <Frame title="Preferences" current="Preferences" description="Numbering, defaults and controls for everyone in the company." s={s} extraDirty={changedSeqs.length > 0}
      onSave={() => void s.save(changedSeqs.length ? saveSequences : undefined, 'Preferences')} onDiscard={() => setEdits({})}>
      {d && <>
        <Card title="Numbering" subtitle="Prefix and next number of each series this year. A number is never reused, so the next one can only go up.">
          <div style={{ overflowX: 'auto' }}>
            <table className="lf-statement" data-testid="number-sequences">
              <thead><tr><th scope="col">Series</th><th scope="col">Prefix</th><th scope="col" className="num">Next number</th><th scope="col" className="num">Digits</th><th scope="col">Next looks like</th></tr></thead>
              <tbody>
                {(seqs.data ?? []).map((q) => {
                  const r = row(q)
                  const preview = `${r.prefix}${String(r.next_number || q.next_number).padStart(Number(r.padding) || q.padding, '0')}`
                  return (
                    <tr key={q.id}>
                      <td>{DOC_LABELS[q.document_type] ?? q.document_type}{seqErrors[q.id] && <div role="alert" style={{ color: 'var(--negative)', fontSize: 12 }}>{seqErrors[q.id]}</div>}</td>
                      <td><Input mono value={r.prefix} readOnly={!editable} aria-label={`${DOC_LABELS[q.document_type] ?? q.document_type} prefix`}
                        onChange={(e) => setEdits({ ...edits, [q.id]: { ...r, prefix: e.target.value } })} /></td>
                      <td className="num"><Input mono align="right" inputMode="numeric" value={r.next_number} readOnly={!editable} aria-label="Next number"
                        onChange={(e) => setEdits({ ...edits, [q.id]: { ...r, next_number: e.target.value.replace(/\D/g, '') } })} /></td>
                      <td className="num"><Input mono align="right" inputMode="numeric" value={r.padding} readOnly={!editable} aria-label="Digits"
                        onChange={(e) => setEdits({ ...edits, [q.id]: { ...r, padding: e.target.value.replace(/\D/g, '').slice(0, 1) } })} /></td>
                      <td className="lf-mono">{preview}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Defaults">
          <Row label="Default warehouse" hint="Pre-selected on new invoices and bills">
            <Select aria-label="Default warehouse" disabled={!editable} value={String(d.default_warehouse_id ?? '')} onChange={(e) => set({ default_warehouse_id: e.target.value ? Number(e.target.value) : null })}
              options={[{ value: '', label: 'None' }, ...(warehouses.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))]} />
          </Row>
          <Row label="Default payment terms">
            <Select aria-label="Default payment terms" disabled={!editable} value={String(d.default_payment_term_id ?? '')} onChange={(e) => set({ default_payment_term_id: e.target.value ? Number(e.target.value) : null })}
              options={[{ value: '', label: 'None' }, ...(terms.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))]} />
          </Row>
          <Row label="Stock valuation" hint="Weighted average; FIFO comes in a later release">
            <Select aria-label="Stock valuation" disabled value="weighted_average" options={[{ value: 'weighted_average', label: 'Weighted average' }]} />
          </Row>
          <Row label="Rounding on invoices">
            <Select aria-label="Rounding on invoices" disabled={!editable} value={d.invoice_rounding ?? 'nearest_1'} onChange={(e) => set({ invoice_rounding: e.target.value as Draft['invoice_rounding'] })}
              options={[{ value: 'none', label: 'No rounding' }, { value: 'nearest_1', label: 'To the nearest ৳ 1' }, { value: 'nearest_5', label: 'To the nearest ৳ 5' }]} />
          </Row>
        </Card>
        <Card title="Controls">
          <Row label="Allow selling below zero stock" hint="Off: an invoice that would take stock below zero is refused">
            <Switch key={`neg-${String(d.allow_negative_stock)}`} checked={!!d.allow_negative_stock} disabled={!editable} onChange={(v) => set({ allow_negative_stock: v })} label={d.allow_negative_stock ? 'On' : 'Off'} />
          </Row>
          <Row label="Require approval above limits" hint="Payments and journals above a role's limit wait for approval">
            <Switch key={`app-${String(d.require_approval)}`} checked={!!d.require_approval} disabled={!editable} onChange={(v) => set({ require_approval: v })} label={d.require_approval ? 'On' : 'Off'} />
          </Row>
          <Row label="Warn when a voucher is dated more than … days back">
            <Select aria-label="Back-date warning" disabled={!editable} value={String(d.backdate_warning_days ?? 7)} onChange={(e) => set({ backdate_warning_days: Number(e.target.value) })}
              options={['0', '3', '7', '15', '30', '60'].map((n) => ({ value: n, label: n === '0' ? 'Always ask' : `${n} days` }))} />
          </Row>
        </Card>
      </>}
    </Frame>
  )
}

// ---------------------------------------------------------------- K5

export function Region() {
  const { Card, Segmented, Select, Input } = ds()
  const { can } = useSession()
  const editable = can('settings.edit')
  const company = useCompany()
  const s = useSettingsDraft(['symbol_position', 'table_decimals', 'negative_format', 'number_grouping', 'date_format', 'week_start', 'print_language'])
  const d = s.draft
  const set = (patch: Draft) => s.setDraft({ ...d, ...patch })
  const seg = (value: string, options: Array<{ value: string; label: string }>, onChange: (v: string) => void, label: string) => (
    <span aria-label={label} role="group">{editable ? <Segmented options={options} value={value} onChange={onChange} /> : <strong>{options.find((o) => o.value === value)?.label}</strong>}</span>
  )
  const sample = d ? sampleAmount(d) : ''
  return (
    <Frame title="Currency and region" current="Currency and region" description="How amounts and dates look on screens and printed documents." s={s} onSave={() => void s.save(undefined, 'Currency and region')}>
      {d && <>
        <Card title="Currency">
          <Row label="Base currency" hint="Fixed once the first entry is posted (BR-035)"><Input aria-label="Base currency" value={company.data?.base_currency_code ?? 'BDT'} readOnly /></Row>
          <Row label="Symbol position">{seg(d.symbol_position ?? 'before', [{ value: 'before', label: '৳ 1,250' }, { value: 'after', label: '1,250 ৳' }], (v) => set({ symbol_position: v as Draft['symbol_position'] }), 'Symbol position')}</Row>
          <Row label="Decimal places">{seg(String(d.table_decimals ?? 2), [{ value: '2', label: '2' }, { value: '0', label: '0' }], (v) => set({ table_decimals: Number(v) }), 'Decimal places')}</Row>
          <Row label="Negative amounts">{seg(d.negative_format ?? 'parentheses', [{ value: 'parentheses', label: '(1,250)' }, { value: 'minus', label: '−1,250' }], (v) => set({ negative_format: v as Draft['negative_format'] }), 'Negative amounts')}</Row>
          <Row label="Number grouping">{seg(d.number_grouping ?? 'lakh', [{ value: 'lakh', label: '12,34,567 (lakh)' }, { value: 'million', label: '1,234,567 (million)' }], (v) => set({ number_grouping: v as Draft['number_grouping'] }), 'Number grouping')}</Row>
          <Row label="Looks like"><span className="lf-num" data-testid="region-sample">{sample}</span></Row>
        </Card>
        <Card title="Region">
          <Row label="Date format">
            <Select aria-label="Date format" disabled={!editable} value={d.date_format ?? 'd M Y'} onChange={(e) => set({ date_format: e.target.value })}
              options={[{ value: 'd M Y', label: '13 Oct 2026' }, { value: 'd/m/Y', label: '13/10/2026' }, { value: 'd-m-Y', label: '13-10-2026' }, { value: 'Y-m-d', label: '2026-10-13' }]} />
          </Row>
          <Row label="Time zone"><Input aria-label="Time zone" value="Asia/Dhaka (UTC+6)" readOnly /></Row>
          <Row label="Week starts on">
            <Select aria-label="Week starts on" disabled={!editable} value={d.week_start ?? 'saturday'} onChange={(e) => set({ week_start: e.target.value as Draft['week_start'] })}
              options={[{ value: 'saturday', label: 'Saturday' }, { value: 'sunday', label: 'Sunday' }, { value: 'monday', label: 'Monday' }]} />
          </Row>
          <Row label="Language on printed documents">{seg(d.print_language ?? 'en', [{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }, { value: 'both', label: 'Both' }], (v) => set({ print_language: v as Draft['print_language'] }), 'Print language')}</Row>
        </Card>
      </>}
    </Frame>
  )
}

/** A fixed example (not a computed amount): shows how the chosen formats print −12,34,567.50. */
export function sampleAmount(d: { symbol_position?: string; table_decimals?: number; negative_format?: string; number_grouping?: string }): string {
  const digits = d.number_grouping === 'million' ? '1,234,567' : '12,34,567'
  const num = d.table_decimals === 0 ? digits : `${digits}.50`
  const withSymbol = d.symbol_position === 'after' ? `${num} ৳` : `৳ ${num}`
  return d.negative_format === 'minus' ? `−${withSymbol}` : `(${withSymbol})`
}

// ---------------------------------------------------------------- K7

const ACCENTS = ['#0B6B5A', '#1A4D8F', '#7A3E9D', '#B5452E', '#2F3B45', '#9A7B1F']

export function InvoiceDesign() {
  const { Card, Segmented, Switch, Field, Input } = ds()
  const { can } = useSession()
  const editable = can('settings.edit')
  const company = useCompany()
  const s = useSettingsDraft(['invoice', 'show_tax_no_on_invoice'])
  const d = s.draft
  const inv = (d?.invoice ?? {}) as Invoice
  const setInv = (patch: Invoice) => s.setDraft({ ...d, invoice: { ...inv, ...patch } })
  const toggles: Array<[keyof Invoice, string]> = [['show_logo', 'Logo'], ['show_words', 'Amount in words'], ['show_bank', 'Bank details'], ['show_signature', 'Signature line']]
  return (
    <Frame title="Invoice design" current="Invoice design" description="Layout, colour and what appears on printed invoices." s={s} onSave={() => void s.save(undefined, 'Invoice design')}>
      {d && (
        <div className="lf-grid">
          <div className="lf-c5" style={{ display: 'grid', gap: 24, alignContent: 'start' }}>
            <Card title="Layout">
              <Segmented options={[{ value: 'classic', label: 'Classic' }, { value: 'banded', label: 'Banded' }, { value: 'minimal', label: 'Minimal' }]} value={inv.template ?? 'classic'}
                onChange={(v) => editable && setInv({ template: v })} />
              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }} role="radiogroup" aria-label="Accent colour">
                {ACCENTS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={inv.accent_color?.toUpperCase() === c} aria-label={`Accent ${c}`} disabled={!editable} onClick={() => setInv({ accent_color: c })}
                    style={{ width: 32, height: 32, borderRadius: 16, background: c, border: inv.accent_color?.toUpperCase() === c ? '3px solid var(--ink)' : '1px solid var(--line)', cursor: 'pointer' }} />
                ))}
              </div>
            </Card>
            <Card title="Show on the invoice">
              {toggles.map(([k, label]) => (
                <Row key={k} label={label}><Switch key={`${k}-${String(inv[k])}`} checked={!!inv[k]} disabled={!editable} onChange={(v) => setInv({ [k]: v })} label={inv[k] ? 'On' : 'Off'} /></Row>
              ))}
              <Row label="Tax registration number"><Switch key={`tax-${String(d.show_tax_no_on_invoice)}`} checked={!!d.show_tax_no_on_invoice} disabled={!editable}
                onChange={(v) => s.setDraft({ ...d, show_tax_no_on_invoice: v })} label={d.show_tax_no_on_invoice ? 'On' : 'Off'} /></Row>
              <Field label="Footer note" hint="Up to 255 characters" htmlFor="inv-footer">
                <Input id="inv-footer" value={inv.footer_note ?? ''} maxLength={255} readOnly={!editable} onChange={(e) => setInv({ footer_note: e.target.value || null })} />
              </Field>
            </Card>
          </div>
          <div className="lf-c7" style={{ minWidth: 0 }}>
            <Card title="Preview" subtitle="A sample invoice with your settings">
              <InvoicePreview inv={inv} showTaxNo={!!d.show_tax_no_on_invoice} company={company.data?.trading_name || company.data?.legal_name || 'Your company'}
                logo={company.data?.logo_url ?? null} taxNo={company.data?.tax_registration_no ?? null} />
            </Card>
          </div>
        </div>
      )}
    </Frame>
  )
}

/** Live A4 preview with sample figures (fixed text, not calculated). */
function InvoicePreview({ inv, showTaxNo, company, logo, taxNo }: { inv: Invoice; showTaxNo: boolean; company: string; logo: string | null; taxNo: string | null }) {
  const accent = inv.accent_color ?? '#0B6B5A'
  const banded = inv.template === 'banded'
  const minimal = inv.template === 'minimal'
  return (
    <div data-testid="invoice-preview" style={{ aspectRatio: '210 / 297', width: '100%', maxWidth: 520, margin: '0 auto', background: '#fff', color: '#1d2329', boxShadow: 'var(--shadow-1)',
      border: '1px solid var(--line)', fontSize: 11, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px', background: banded ? accent : 'transparent', color: banded ? '#fff' : 'inherit', borderBottom: minimal ? '1px solid #ddd' : `3px solid ${accent}`,
        display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          {inv.show_logo && logo && <img src={logo} alt="" style={{ maxHeight: 32, marginBottom: 6, display: 'block' }} />}
          <strong style={{ fontSize: 15 }}>{company}</strong>
          {showTaxNo && <div style={{ opacity: 0.8 }}>BIN {taxNo ?? '000000000-0000'}</div>}
        </div>
        <div style={{ textAlign: 'right' }}><strong style={{ fontSize: 16, color: banded ? '#fff' : accent }}>INVOICE</strong><div>INV-2026-0001 · 13 Oct 2026</div></div>
      </div>
      <div style={{ padding: '14px 24px', flex: 1 }}>
        <div style={{ marginBottom: 12 }}><span style={{ opacity: 0.6 }}>Bill to</span><br /><strong>Karim Distributors</strong><br />Mirpur 10, Dhaka</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: minimal ? 'transparent' : `${accent}1A`, color: accent }}>
            {['Item', 'Qty', 'Price', 'Amount'].map((h, i) => <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '6px 4px', borderBottom: `1px solid ${accent}` }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {[['Soybean oil 5L jar', '20', '940.00', '18,800.00'], ['Miniket rice 25kg', '10', '1,850.00', '18,500.00']].map((r) => (
              <tr key={r[0]}>{r.map((c, i) => <td key={i} style={{ textAlign: i ? 'right' : 'left', padding: '6px 4px', borderBottom: '1px solid #eee' }}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: 'right', marginTop: 10, fontSize: 13 }}><strong>Total ৳ 37,300.00</strong></div>
        {inv.show_words && <div style={{ marginTop: 6, fontStyle: 'italic' }}>Taka thirty-seven thousand three hundred only</div>}
        {inv.show_bank && <div style={{ marginTop: 14 }}><span style={{ opacity: 0.6 }}>Pay to</span><br />Sonali Bank · 0012345678</div>}
      </div>
      <div style={{ padding: '10px 24px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 12 }}>
        <span style={{ opacity: 0.7 }}>{inv.footer_note ?? ''}</span>
        {inv.show_signature && <span style={{ borderTop: '1px solid #999', paddingTop: 4, minWidth: 120, textAlign: 'center' }}>Authorised signature</span>}
      </div>
    </div>
  )
}
