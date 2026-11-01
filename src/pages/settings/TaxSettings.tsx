import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { Ledger, TaxRule } from '../../api/contract.gen'
import { useTaxRules } from '../../api/inventory'
import { useCompanySettings } from '../../api/platform'
import { useSaveTaxRule, useUpdateSettings } from '../../api/settings'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { LedgerPicker } from '../../components/pickers/LedgerPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { Forbidden } from '../../components/states'
import { SettingsLayout } from './SettingsLayout'

/**
 * K6 Tax (Settings.dc.html; FR-084; BR-036; CON-5; R-14; backlog P15.2-FE-05): the rules you define — none by default,
 * Pluto never assumes a rate — with the ledger each collects in, and how tax shows on documents. "Add tax rule" opens a
 * drawer: a new payable/receivable ledger or an existing liability/asset one; "recoverable" applies to purchases (off =
 * the tax is added to the cost). A rate change applies to new documents only; rules in use are deactivated, never deleted.
 */
export function TaxSettings() {
  const { Card, DataTable, EmptyState, Button, Badge, Switch, Segmented } = ds()
  const { can } = useSession()
  const toast = useToast()
  const rules = useTaxRules()
  const settings = useCompanySettings()
  const update = useUpdateSettings()
  const [editing, setEditing] = useState<TaxRule | 'new' | null>(null)
  const editable = can('settings.edit')
  if (!can('settings.view')) return <Forbidden permission="settings.view" what="tax settings" />
  const s = settings.data

  async function setDisplay(patch: { prices_include_tax?: boolean; show_tax_no_on_invoice?: boolean }) {
    if (!s) return
    try {
      await update.mutateAsync({ input: patch, version: s.version })
      toast({ tone: 'positive', title: 'Tax display saved' })
    } catch (e) {
      toast({ tone: 'negative', title: 'Could not save', description: e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : undefined })
    }
  }

  const columns: DataColumn[] = [
    { key: 'name', label: 'Rule' }, { key: 'rate', label: 'Rate', align: 'right', render: (v: string) => <span className="lf-num">{trimRate(v)} %</span> },
    { key: 'applies', label: 'Applies to' }, { key: 'ledger', label: 'Posts to' },
    { key: 'recoverable', label: 'Input credit', render: (v: boolean, r) => (r.applies === 'Sales' ? '—' : v ? 'Recoverable' : 'Added to cost') },
    { key: 'active', label: 'Status', render: (v: boolean) => <Badge tone={v ? 'positive' : 'neutral'} dot>{v ? 'Active' : 'Inactive'}</Badge> },
  ]
  const rows = (rules.data ?? []).map((r) => ({ id: r.id, r, name: r.name, rate: r.rate, applies: ({ sales: 'Sales', purchases: 'Purchases', both: 'Sales and purchases' } as Record<string, string>)[r.applies_to],
    ledger: r.ledger_name, recoverable: r.is_recoverable, active: r.is_active }))

  return (
    <SettingsLayout current="Tax" eyebrow="Settings › Business" title="Tax" description="The tax rules you use. Pluto does not assume any rate."
      actions={editable ? <Button variant="primary" icon="plus" onClick={() => setEditing('new')} data-testid="add-tax-rule">Add tax rule</Button> : undefined}>
      <ProblemBanner error={rules.error} onRetry={() => void rules.refetch()} />
      <Card padding="none" title="Tax rules">
        <div style={{ overflowX: 'auto' }} data-testid="tax-rules">
          <DataTable caption="Tax rules" columns={columns} rows={rows} loading={rules.isPending} onRowClick={editable ? (r: { r: TaxRule }) => setEditing(r.r) : undefined}
            emptyState={<EmptyState icon="percent" title="No tax rules yet" description="Add the VAT, AIT or other rates your business charges or pays. Each rule posts to its own ledger."
              action={editable ? <Button variant="primary" onClick={() => setEditing('new')}>Add tax rule</Button> : undefined} />} />
        </div>
      </Card>
      {s && (
        <Card title="On documents">
          <div className="se-row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}><strong>Prices entered</strong><span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Whether line prices already include tax</span></span>
            <Segmented options={[{ value: 'exclude', label: 'Excluding tax' }, { value: 'include', label: 'Including tax' }]} value={s.prices_include_tax ? 'include' : 'exclude'}
              onChange={(v) => editable && void setDisplay({ prices_include_tax: v === 'include' })} />
          </div>
          <div className="se-row">
            <span style={{ display: 'flex', flexDirection: 'column' }}><strong>Show the tax registration number on invoices</strong></span>
            <Switch key={`tn-${String(s.show_tax_no_on_invoice)}`} checked={s.show_tax_no_on_invoice} disabled={!editable || update.isPending}
              onChange={(v) => void setDisplay({ show_tax_no_on_invoice: v })} label={s.show_tax_no_on_invoice ? 'On' : 'Off'} />
          </div>
        </Card>
      )}
      {editing && <TaxRuleDrawer rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </SettingsLayout>
  )
}

/** "7.5000" → "7.5" (display only). */
export const trimRate = (r: string) => r.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')

function TaxRuleDrawer({ rule, onClose }: { rule: TaxRule | null; onClose: () => void }) {
  const { Field, Input, Select, Switch, Button, Segmented } = ds()
  const toast = useToast()
  const save = useSaveTaxRule()
  const idem = useIdempotencyKey()
  const [name, setName] = useState(rule?.name ?? '')
  const [rate, setRate] = useState(rule ? trimRate(rule.rate) : '')
  const [applies, setApplies] = useState<'sales' | 'purchases' | 'both'>(rule?.applies_to ?? 'sales')
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [recoverable, setRecoverable] = useState(rule?.is_recoverable ?? true)
  const [active, setActive] = useState(rule?.is_active ?? true)
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)

  async function submit() {
    setError(null)
    try {
      const base = { name: name.trim(), rate: rate.trim(), applies_to: applies, is_recoverable: recoverable, is_active: active }
      if (rule) await save.mutateAsync({ id: rule.id, version: rule.version, input: base })
      else await save.mutateAsync({ idempotencyKey: idem.key, input: { ...base, ...(mode === 'new' ? { create_ledger: true } : { ledger_id: ledger?.id ?? null }) } })
      idem.reset()
      toast({ tone: 'positive', title: rule ? `${base.name} saved` : `${base.name} added`, description: rule && rule.rate !== rate ? 'The new rate applies to new documents only.' : undefined })
      onClose()
    } catch (e) { setError(e) }
  }

  return (
    <ResponsiveDialog title={rule ? `Edit ${rule.name}` : 'Add tax rule'} onClose={onClose} testId="tax-rule-drawer"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !rate.trim() || (!rule && mode === 'existing' && !ledger)} onClick={() => void submit()} data-testid="save-tax-rule">
          {rule ? 'Save' : 'Add rule'}</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />
        <Field label="Rule name" required error={fe('name')} htmlFor="tax-name"><Input id="tax-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VAT 15%" invalid={!!fe('name')} autoFocus /></Field>
        <Field label="Rate (%)" required hint="As your tax adviser tells you; 0 to 100" error={fe('rate')} htmlFor="tax-rate">
          <Input id="tax-rate" mono align="right" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} invalid={!!fe('rate')} placeholder="15" />
        </Field>
        <Field label="Applies to" required htmlFor="tax-applies">
          <Select id="tax-applies" value={applies} onChange={(e) => setApplies(e.target.value as typeof applies)}
            options={[{ value: 'sales', label: 'Sales' }, { value: 'purchases', label: 'Purchases' }, { value: 'both', label: 'Sales and purchases' }]} />
        </Field>
        {rule ? <Field label="Posts to ledger"><Input value={rule.ledger_name} readOnly aria-label="Posts to ledger" /></Field> : (
          <Field label="Posts to ledger" required error={fe('ledger_id')}>
            <div style={{ display: 'grid', gap: 8 }}>
              <Segmented options={[{ value: 'new', label: 'New ledger' }, { value: 'existing', label: 'Existing ledger' }]} value={mode} onChange={(v) => setMode(v as 'new' | 'existing')} />
              {mode === 'existing' ? <LedgerPicker purpose="tax" value={ledger} onChange={setLedger} aria-label="Existing ledger" />
                : <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>“{name.trim() || 'Rule'} {applies === 'purchases' ? 'receivable' : 'payable'}” is made under {applies === 'purchases' ? 'Current assets' : 'Current liabilities'}.</span>}
            </div>
          </Field>
        )}
        {applies !== 'sales' && <Switch label="Recoverable as input credit (off: the tax is added to the cost of purchases)" checked={recoverable} onChange={setRecoverable} />}
        {rule && <Switch label="Active" checked={active} onChange={setActive} />}
      </div>
    </ResponsiveDialog>
  )
}
