import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import type { Branch, Company, CompanyUpdate } from '../../api/contract.gen'
import { useCompany, useRemoveLogo, useSaveBranch, useUpdateCompany, useUploadLogo } from '../../api/settings'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { BRAND_PRESETS, brandVariables, normaliseHex } from '../../lib/brand'
import { applyProblemToForm } from '../../lib/forms'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ConflictBanner } from '../../components/ConflictBanner'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { Forbidden } from '../../components/states'
import { SettingsLayout } from './SettingsLayout'

/**
 * K1 Company profile and K2 Edit company (Settings.dc.html; FR-080; backlog P15.2-FE-02): identity, registration and
 * contact (one form, saved with If-Match), the logo (PNG or SVG up to 1 MB; the server sniffs it), and the locations
 * with Add / Edit (GAP-14). Base currency and the financial year start are fixed after set-up (BR-035).
 * PEP-497: the company's brand colour (8 swatches or a hex code; saved with the profile, refused by the API when it
 * cannot be read; the app is recoloured from the palette the API returns).
 */
const TYPES = [{ value: 'private_limited', label: 'Private limited company' }, { value: 'sole_proprietorship', label: 'Sole proprietorship' },
  { value: 'partnership', label: 'Partnership' }, { value: 'public_limited', label: 'Public limited company' }]
const FIELDS: Array<[keyof CompanyUpdate, string, string?]> = [['legal_name', 'Legal name'], ['trading_name', 'Trading name'], ['trade_licence_no', 'Trade licence number'],
  ['tax_registration_no', 'Tax registration number (BIN/TIN)'], ['registered_address', 'Registered address'], ['phone', 'Phone'], ['email', 'Email', 'Enter an email like name@company.com'],
  ['website', 'Website']]

export function CompanyProfile() {
  const { can } = useSession()
  const q = useCompany()
  if (!can('settings.view')) return <Forbidden permission="settings.view" what="the company profile" />
  if (!q.data) return q.error ? <ProblemBanner error={q.error} onRetry={() => void q.refetch()} /> : <PageSkeleton template="form" />
  return <Profile company={q.data} reload={() => void q.refetch()} />
}

const pick = (c: Company): CompanyUpdate => ({ legal_name: c.legal_name, trading_name: c.trading_name ?? '', business_type: c.business_type as CompanyUpdate['business_type'],
  trade_licence_no: c.trade_licence_no ?? '', tax_registration_no: c.tax_registration_no ?? '', incorporated_on: c.incorporated_on ?? '', registered_address: c.registered_address ?? '',
  phone: c.phone ?? '', email: c.email ?? '', website: c.website ?? '', brand_color: c.brand?.color ?? '' })
const FORM_FIELDS = ['legal_name', 'trading_name', 'business_type', 'trade_licence_no', 'tax_registration_no', 'incorporated_on', 'registered_address', 'phone', 'email', 'website',
  'brand_color'] as const

function Profile({ company, reload }: { company: Company; reload: () => void }) {
  const { Card, Field, Input, Select, Button, Badge, Icon } = ds()
  const { can, refreshMe } = useSession()
  const toast = useToast()
  const editable = can('settings.edit')
  const update = useUpdateCompany()
  const upload = useUploadLogo()
  const removeLogo = useRemoveLogo()
  const [form, setForm] = useState<CompanyUpdate>(() => pick(company))
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState(false)
  const [branch, setBranch] = useState<Branch | 'new' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { setForm(pick(company)) }, [company.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(company))
  const guard = useUnsavedChangesBlocker(dirty, 'Your changes to the company profile are not saved.')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const fe = (k: string) => fieldErrors[k]

  async function save() {
    setError(null)
    setConflict(false)
    setFieldErrors({})
    const colour = form.brand_color ? normaliseHex(form.brand_color) : ''
    if (colour === null) { // shape only; whether it can be read is the API's answer
      setFieldErrors({ brand_color: 'Enter a colour like #1f3a5f' })
      document.getElementById('co-brand_color')?.focus()
      return
    }
    try {
      const empty = (s: unknown) => (s === '' ? null : s)
      const input = Object.fromEntries(Object.entries({ ...form, brand_color: colour }).map(([k, val]) => [k, k === 'legal_name' || k === 'business_type' ? val : empty(val)])) as CompanyUpdate
      const saved = await update.mutateAsync({ input, version: company.version })
      toast({ tone: 'positive', title: 'Company profile saved' })
      // PEP-497: everyone's screens follow Me.brand; fetch it again so this one changes colour now.
      if ((saved.brand?.color ?? null) !== (company.brand?.color ?? null)) await refreshMe().catch(() => undefined)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_conflict') { setConflict(true); return }
      const found: Record<string, string> = {}
      const r = applyProblemToForm<(typeof FORM_FIELDS)[number]>(e, (name, err, options) => {
        found[name] = err.message
        if (options?.shouldFocus) document.getElementById(`co-${name}`)?.focus()
      }, {}, FORM_FIELDS)
      setFieldErrors(found)
      if (!r || r.unmatched.length) setError(e)
    }
  }

  async function chooseLogo(f: File | undefined) {
    if (!f) return
    if (!/\.(png|svg)$/i.test(f.name) || f.size > 1024 * 1024) { toast({ tone: 'negative', title: 'Use a PNG or SVG up to 1 MB' }); return }
    try {
      await upload.mutateAsync({ file: f, version: company.version })
      toast({ tone: 'positive', title: 'Logo updated' })
    } catch (e) {
      toast({ tone: 'negative', title: 'Could not upload the logo', description: e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : undefined })
    }
  }

  return (
    <SettingsLayout current="Company profile" eyebrow="Settings › Business" title="Company profile" description="Identity, registration, contact and locations."
      actions={editable ? <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="ghost" disabled={!dirty} onClick={() => setForm(pick(company))}>Discard</Button>
        <Button variant="primary" loading={update.isPending} disabled={!dirty || !form.legal_name?.trim()} onClick={() => void save()} data-testid="save-company">Save changes</Button>
      </div> : undefined}>
      {conflict && <ConflictBanner onReload={() => { setConflict(false); reload() }} loading={false} />}
      <ProblemBanner error={error} />
      <Card title="Identity">
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ width: 120, height: 64, border: '1px dashed var(--line)', borderRadius: 'var(--radius-md)', display: 'grid', placeItems: 'center', overflow: 'hidden', background: 'var(--surface)' }}
            data-testid="company-logo">
            {company.logo_url ? <img src={company.logo_url} alt={`${company.legal_name} logo`} style={{ maxWidth: '100%', maxHeight: '100%' }} />
              : <span style={{ color: 'var(--ink-muted)', display: 'inline-flex' }}><Icon name="image" size={22} /></span>}
          </div>
          {editable && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" icon="upload" loading={upload.isPending} onClick={() => file.current?.click()} data-testid="replace-logo">{company.logo_url ? 'Replace logo' : 'Upload logo'}</Button>
              {company.logo_url && <Button size="sm" variant="ghost" icon="trash-2" onClick={() => setConfirmRemove(true)}>Remove</Button>}
              <input ref={file} type="file" accept=".png,.svg,image/png,image/svg+xml" hidden data-testid="logo-input" onChange={(e) => { void chooseLogo(e.target.files?.[0]); e.target.value = '' }} />
              <span style={{ fontSize: 13, color: 'var(--ink-muted)', flexBasis: '100%' }}>PNG or SVG, at least 400 px wide, up to 1 MB</span>
            </div>
          )}
        </div>
        <div className="lf-grid" style={{ gap: 16 }}>
          {FIELDS.slice(0, 2).map(([key, label]) => (
            <div key={key} className="lf-c6">
              <Field label={label} required={key === 'legal_name'} error={fe(key)} htmlFor={`co-${key}`}>
                <Input id={`co-${key}`} value={String(form[key] ?? '')} readOnly={!editable} onChange={(e) => setForm({ ...form, [key]: e.target.value })} invalid={!!fe(key)} />
              </Field>
            </div>
          ))}
          <div className="lf-c6">
            <Field label="Business type" required htmlFor="co-type">
              <Select id="co-type" options={TYPES} value={form.business_type ?? ''} disabled={!editable} onChange={(e) => setForm({ ...form, business_type: e.target.value as CompanyUpdate['business_type'] })} />
            </Field>
          </div>
          <div className="lf-c6">
            <Field label="Incorporated on" error={fe('incorporated_on')} htmlFor="co-inc">
              <Input id="co-inc" type="date" value={String(form.incorporated_on ?? '')} readOnly={!editable} onChange={(e) => setForm({ ...form, incorporated_on: e.target.value })} />
            </Field>
          </div>
        </div>
      </Card>
      <Card title="Registration and contact">
        <div className="lf-grid" style={{ gap: 16 }}>
          {FIELDS.slice(2).map(([key, label, hint]) => (
            <div key={key} className="lf-c6">
              <Field label={label} hint={hint} error={fe(key)} htmlFor={`co-${key}`}>
                <Input id={`co-${key}`} value={String(form[key] ?? '')} readOnly={!editable} onChange={(e) => setForm({ ...form, [key]: e.target.value })} invalid={!!fe(key)} />
              </Field>
            </div>
          ))}
          <div className="lf-c6"><Field label="Base currency"><Input value={company.base_currency_code} readOnly aria-label="Base currency" /></Field></div>
          <div className="lf-c6"><Field label="Financial year starts" hint="Fixed after set-up">
            <Input value={new Date(2000, company.fy_start_month - 1, 1).toLocaleString('en-GB', { month: 'long' })} readOnly aria-label="Financial year starts" /></Field></div>
        </div>
      </Card>
      <BrandColourCard company={company} value={form.brand_color ?? ''} onChange={(brand_color) => setForm({ ...form, brand_color })} editable={editable} error={fe('brand_color')} />
      <Card title="Locations" subtitle={`${company.seats_used ?? 0} of ${company.seat_limit ?? 0} user seats in use`}
        actions={editable ? <Button size="sm" icon="plus" onClick={() => setBranch('new')} data-testid="add-branch">Add location</Button> : undefined}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="branches">
          {(company.branches ?? []).map((b) => (
            <li key={b.id} className="se-row">
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>{b.name}
                  {b.is_head_office && <Badge tone="accent">Head office</Badge>}{!b.is_active && <Badge tone="neutral">Closed</Badge>}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{[b.code, b.kind, b.address, b.phone].filter(Boolean).join(' · ')}</span>
              </span>
              {editable && <Button size="sm" variant="ghost" icon="pencil" onClick={() => setBranch(b)}>Edit</Button>}
            </li>
          ))}
        </ul>
      </Card>
      {branch && <BranchDialog branch={branch === 'new' ? null : branch} onClose={() => setBranch(null)} />}
      {confirmRemove && <ConfirmDialog title="Remove the logo?" description="Invoices and statements will print without a logo." confirmLabel="Remove" tone="negative"
        onConfirm={async () => { await removeLogo.mutateAsync(); setConfirmRemove(false); toast({ tone: 'positive', title: 'Logo removed' }) }} onClose={() => setConfirmRemove(false)} />}
      {guard.dialog}
    </SettingsLayout>
  )
}

/**
 * PEP-497 brand colour: 8 swatches, a custom hex code, Reset to Pluto default. The colours of buttons, links and badges
 * are worked out by the API, so before saving only the chosen swatch is shown; after saving the preview shows a real
 * button and badge in the palette the API returned.
 */
function BrandColourCard({ company, value, onChange, editable, error }: { company: Company; value: string; onChange: (v: string) => void; editable: boolean; error?: string }) {
  const { Card, Field, Input, Button, Badge } = ds()
  const saved = company.brand?.color ?? ''
  const chosen = value ? normaliseHex(value) : ''
  const pending = chosen !== saved
  const preset = BRAND_PRESETS.find((p) => p.value === chosen)
  const theme = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  const swatch = (colour: string, size = 20) => <span aria-hidden="true" className="se-brand-dot" style={{ width: size, height: size, background: colour }} />
  return (
    <Card title="Brand colour" subtitle="Buttons, links and highlights across Pluto, and the headings of your invoices and other PDFs, use this colour for everyone in the company.">
      <div style={{ display: 'grid', gap: 16 }} data-testid="brand-colour">
        <div role="radiogroup" aria-label="Brand colour" className="se-brand-swatches">
          {BRAND_PRESETS.map((p) => (
            <button key={p.name} type="button" role="radio" aria-checked={p.value === chosen} disabled={!editable} className="se-brand-swatch" onClick={() => onChange(p.value)}
              data-testid={`brand-${p.name.toLowerCase().replace(/ /g, '-')}`}>
              {swatch(p.swatch, 28)}<span>{p.name}</span>
            </button>
          ))}
        </div>
        {editable && (
          <div className="lf-grid" style={{ gap: 16, alignItems: 'end' }}>
            <div className="lf-c6">
              <Field label="Custom colour" hint="A hex code, e.g. #0f766e" error={error} htmlFor="co-brand_color">
                <Input id="co-brand_color" mono value={value} placeholder="#1f3a5f" maxLength={7} autoComplete="off" spellCheck={false} invalid={!!error}
                  onChange={(e) => onChange(e.target.value.trim())} onBlur={() => { const n = value ? normaliseHex(value) : ''; if (n) onChange(n) }} />
              </Field>
            </div>
            <div className="lf-c6" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="color" aria-label="Pick a colour" className="se-brand-native" value={chosen || BRAND_PRESETS[0]!.swatch} onChange={(e) => onChange(e.target.value.toLowerCase())} />
              <Button variant="ghost" icon="undo-2" disabled={value === ''} onClick={() => onChange('')} data-testid="brand-reset">Reset to Pluto default</Button>
            </div>
          </div>
        )}
        {!editable && error && <span role="alert" style={{ color: 'var(--negative)', fontSize: 13 }}>{error}</span>}
        <div className="se-brand-preview" data-testid="brand-preview" aria-live="polite">
          {pending ? (
            <>
              {swatch(chosen || BRAND_PRESETS[0]!.swatch, 28)}
              <span><strong>{chosen === '' ? 'Pluto blue (default)' : (preset?.name ?? chosen ?? value)}</strong>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--ink-muted)' }}>Save changes to see buttons and badges in this colour.</span></span>
            </>
          ) : (
            <div style={{ ...(brandVariables(company.brand, theme) ?? {}), display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              {swatch(saved || BRAND_PRESETS[0]!.swatch, 28)}
              <span style={{ fontWeight: 600 }}>{saved === '' ? 'Pluto blue (default)' : (preset?.name ?? saved)}</span>
              <span className="lf-btn lf-btn-primary lf-btn-sm se-brand-sample"><span className="lf-btn-label">Primary button</span></span>
              <Badge tone="brand">Badge</Badge>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function BranchDialog({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const { Field, Input, Button, Switch } = ds()
  const toast = useToast()
  const save = useSaveBranch()
  const idem = useIdempotencyKey()
  const [f, setF] = useState({ code: branch?.code ?? '', name: branch?.name ?? '', kind: branch?.kind ?? '', address: branch?.address ?? '', phone: branch?.phone ?? '',
    is_head_office: branch?.is_head_office ?? false, is_active: branch?.is_active ?? true })
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  async function submit() {
    setError(null)
    try {
      const input = { ...f, kind: f.kind || null, address: f.address || null, phone: f.phone || null }
      await save.mutateAsync(branch ? { id: branch.id, input, version: branch.version } : { input, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: branch ? `${f.name} saved` : `${f.name} added` })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title={branch ? `Edit ${branch.name}` : 'Add location'} onClose={onClose} testId="branch-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!f.code.trim() || !f.name.trim()} onClick={() => void submit()} data-testid="save-branch">{branch ? 'Save' : 'Add location'}</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />
        <Field label="Code" required error={fe('code')} htmlFor="br-code"><Input id="br-code" mono value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} invalid={!!fe('code')} autoFocus /></Field>
        <Field label="Name" required error={fe('name')} htmlFor="br-name"><Input id="br-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!fe('name')} /></Field>
        <Field label="What it is" hint="e.g. Office, warehouse, retail counter" htmlFor="br-kind"><Input id="br-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} /></Field>
        <Field label="Address" htmlFor="br-addr"><Input id="br-addr" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Phone" htmlFor="br-phone"><Input id="br-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Switch label="Head office" checked={f.is_head_office} onChange={(v) => setF({ ...f, is_head_office: v })} />
        {fe('is_head_office') && <span role="alert" style={{ color: 'var(--negative)', fontSize: 13 }}>{fe('is_head_office')}</span>}
        {branch && <Switch label="Open" checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />}
        {fe('is_active') && <span role="alert" style={{ color: 'var(--negative)', fontSize: 13 }}>{fe('is_active')}</span>}
      </div>
    </ResponsiveDialog>
  )
}
