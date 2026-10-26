import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Ledger } from '../../api/contract.gen'
import { useAccountTree, useCreateLedger, useDeactivateLedger, useLedger, useUpdateLedger, fySummaryOf } from '../../api/accounting'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { applyProblemToForm } from '../../lib/forms'
import { emptyLedger, ledgerSchema, ledgerToForm, toLedgerInput, type LedgerFormValues } from '../../lib/ledgerSchema'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ConflictBanner } from '../../components/ConflictBanner'
import { FormErrorSummary } from '../../components/FormErrorSummary'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden, NotFound } from '../../components/states'
import { flattenGroups } from './ChartOfAccounts'
import { drCrText, natureLabel } from './common'

/**
 * H4 Add ledger / H5 Edit ledger (Acc-AddLedger.dc.html, Acc-EditLedger.dc.html; backlog P7.2-FE-03). Nature and
 * normal balance follow the group. Once the ledger has entries its code and opening balance are read-only with the
 * reason (BR-027, BR-028); it can move only to a group of the same nature. Ledgers of customers, suppliers, money
 * accounts and warehouses are changed from those records. Make inactive needs a zero balance (BR-026).
 */
const MASTER_KINDS: Record<string, string> = { party: 'customer or supplier', bank: 'money account', cash: 'money account', inventory: 'warehouse' }

export function LedgerForm({ mode }: { mode: 'add' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const q = useLedger(mode === 'edit' ? id : 0)
  if (!can(mode === 'add' ? 'accounting.create' : 'accounting.edit')) return <Forbidden permission={mode === 'add' ? 'accounting.create' : 'accounting.edit'} what="ledgers" />
  if (mode === 'add') return <Form />
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this ledger" back="/accounting/ledgers" backLabel="Ledgers" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="form" />
  return <Form ledger={q.data} key={q.data.version} />
}

function Form({ ledger }: { ledger?: Ledger }) {
  const { PageHeader, Card, Field, Input, Select, Segmented, Switch, Button, Banner } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const tree = useAccountTree({ with_ledgers: 'false' })
  const create = useCreateLedger()
  const update = useUpdateLedger(ledger?.id ?? 0)
  const deactivate = useDeactivateLedger(ledger?.id ?? 0)
  const idem = useIdempotencyKey()
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [confirmOff, setConfirmOff] = useState(false)
  const { register, handleSubmit, watch, setValue, setError, reset, formState: { errors, isDirty, submitCount, isSubmitting } } = useForm<LedgerFormValues>({
    resolver: zodResolver(ledgerSchema) as never, defaultValues: ledger ? ledgerToForm(ledger) : emptyLedger(params.get('group') ?? ''), mode: 'onSubmit',
  })
  const guard = useUnsavedChangesBlocker(isDirty, ledger ? 'Your changes to this ledger are not saved.' : 'This ledger has not been created yet.')
  const v = watch()
  const groups = flattenGroups(tree.data?.nodes ?? [])
  const group = groups.find((g) => String(g.id) === v.account_group_id)
  const locked = !!ledger?.has_entries
  const master = ledger ? MASTER_KINDS[ledger.ledger_kind] : undefined
  const choices = ledger ? groups.filter((g) => g.nature === ledger.nature) : groups
  const fy = ledger ? fySummaryOf(ledger) : null
  const conflict = formError instanceof ApiError && formError.status === 409 && formError.code === 'version_conflict'

  const submit = (another: boolean) => handleSubmit(async (values) => {
    setFormError(null); setUnmatched([])
    try {
      if (ledger) {
        const l = await update.mutateAsync({ input: toLedgerInput(values, locked), version: ledger.version })
        toast({ tone: 'positive', title: `${l.code} · ${l.name} saved` })
        guard.allowNavigation()
        navigate(`/accounting/ledgers/${l.id}`)
        return
      }
      const l = await create.mutateAsync({ input: toLedgerInput(values), idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `Ledger ${l.code} · ${l.name} created`, description: l.opening_balance && l.opening_balance !== '0.00' ? `Opening ${drCrText(l.opening_balance, l.opening_side ?? 'dr')}` : undefined })
      if (another) { reset(emptyLedger(values.account_group_id)); return }
      guard.allowNavigation()
      navigate(`/accounting/ledgers/${l.id}`)
    } catch (e) {
      const placed = applyProblemToForm(e, setError as never, {} as never, Object.keys(emptyLedger()) as never)
      if (placed) setUnmatched(placed.unmatched)
      else setFormError(e)
    }
  })
  const makeInactive = async () => {
    try {
      await deactivate.mutateAsync()
      toast({ tone: 'positive', title: `${ledger!.name} is now inactive` })
      setConfirmOff(false)
      guard.allowNavigation()
      navigate(`/accounting/ledgers/${ledger!.id}`)
    } catch (e) { setConfirmOff(false); setFormError(e) }
  }
  const err = (k: keyof LedgerFormValues) => errors[k]?.message
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 } as const

  if (master) {
    return (
      <>
        <PageHeader eyebrow="Accounting" title={`${ledger!.code} · ${ledger!.name}`} />
        <Banner tone="info" title={`This ledger belongs to a ${master}`}>Change its name, opening balance or status from that {master}; the ledger follows.</Banner>
      </>
    )
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(false)() }} noValidate data-testid="ledger-form">
      <PageHeader eyebrow="Accounting" title={ledger ? `Edit ${ledger.code} · ${ledger.name}` : 'Add ledger account'}
        description={ledger ? 'Rename or regroup a ledger; code and opening are locked once it has entries.' : 'A ledger sits under a group; its nature follows the group.'} />
      <FormErrorSummary count={submitCount > 0 ? Object.keys(errors).length : 0} noun="ledger" messages={unmatched} />
      {conflict ? <ConflictBanner onReload={() => window.location.reload()} /> : <ProblemBanner error={formError} />}
      {locked && <Banner tone="info" title="This ledger has entries">Its code and opening balance can no longer change (BR-027). It can move only to another {ledger!.nature} group.</Banner>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', marginTop: 12 }}>
        <div style={{ flex: '2 1 420px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Ledger">
            <div style={grid}>
              <Field label="Ledger name" required error={err('name')} htmlFor="l-name"><Input id="l-name" {...register('name')} invalid={!!errors.name} /></Field>
              <Field label="Under group" required error={err('account_group_id')} htmlFor="l-group">
                <Select id="l-group" {...register('account_group_id')} invalid={!!errors.account_group_id}
                  options={[{ value: '', label: 'Choose the group' }, ...choices.map((g) => ({ value: String(g.id), label: g.label }))]} />
              </Field>
              <Field label="Ledger code" hint={ledger ? (locked ? 'Locked: the ledger has entries' : undefined) : 'Empty: the next free code in the group'} error={err('code')} htmlFor="l-code">
                <Input id="l-code" mono {...register('code')} readOnly={locked} invalid={!!errors.code} />
              </Field>
              <Field label="Nature"><Input readOnly aria-label="Nature" value={group ? natureLabel(group.nature) : ledger ? natureLabel(ledger.nature) : '—'} /></Field>
              <Field label="Description" error={err('description')} htmlFor="l-desc"><Input id="l-desc" {...register('description')} /></Field>
            </div>
          </Card>
          <Card title="Opening balance">
            <div style={grid}>
              <Field label="Opening amount (৳)" hint={locked ? 'Locked: the ledger has entries' : 'Booked on the first day of the financial year'} error={err('opening_balance')} htmlFor="l-open">
                <Input id="l-open" mono align="right" inputMode="decimal" placeholder="0.00" {...register('opening_balance')} readOnly={locked} invalid={!!errors.opening_balance} />
              </Field>
              <Field label="Side">
                <Segmented options={[{ value: 'dr', label: 'Dr' }, { value: 'cr', label: 'Cr' }]} value={v.opening_side}
                  onChange={(s) => { if (!locked) setValue('opening_side', s as 'dr' | 'cr', { shouldDirty: true }) }} />
              </Field>
            </div>
          </Card>
          <Card title="Behaviour">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Switch label="Track bill by bill" checked={v.track_bills} onChange={(c) => setValue('track_bills', c, { shouldDirty: true })} />
              <Switch label="Show in payment and receipt vouchers" checked={v.show_in_cash_vouchers} onChange={(c) => setValue('show_in_cash_vouchers', c, { shouldDirty: true })} />
            </div>
          </Card>
        </div>
        <div className="lf-form-aside" style={{ flex: '1 1 260px' }}>
          <Card title={fy ? `This year (${fy.fiscal_year})` : 'Where it will appear'}>
            {fy
              ? <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px' }} data-testid="fy-summary">
                  <dt>Opening</dt><dd style={{ margin: 0, textAlign: 'right' }}>{drCrText(fy.opening, fy.opening_side)}</dd>
                  <dt>Debits</dt><dd style={{ margin: 0, textAlign: 'right' }}>{formatTaka(fy.debit)}</dd>
                  <dt>Credits</dt><dd style={{ margin: 0, textAlign: 'right' }}>{formatTaka(fy.credit)}</dd>
                  <dt>Closing</dt><dd style={{ margin: 0, textAlign: 'right', fontWeight: 600 }}>{drCrText(fy.closing, fy.closing_side)}</dd>
                  <dt>Entries</dt><dd style={{ margin: 0, textAlign: 'right' }}>{fy.entries}</dd>
                </dl>
              : <p style={{ margin: 0, color: 'var(--ink-muted)' }}>{group ? `${group.label.trim()} in the chart of accounts, and in the ${group.nature === 'income' || group.nature === 'expense' ? 'profit and loss' : 'balance sheet'}.` : 'Choose a group.'}</p>}
          </Card>
        </div>
      </div>
      <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, margin: '16px -24px -48px', padding: '12px 24px', background: 'var(--surface)',
        borderTop: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
        {ledger?.is_active && <Button variant="danger" onClick={() => setConfirmOff(true)} data-testid="deactivate-ledger">Make inactive</Button>}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={() => navigate(ledger ? `/accounting/ledgers/${ledger.id}` : '/accounting/ledgers')}>Cancel</Button>
        {!ledger && <Button variant="secondary" disabled={isSubmitting} onClick={() => void submit(true)()}>Save and add another</Button>}
        <Button variant="primary" icon="check" loading={isSubmitting} disabled={isSubmitting} onClick={() => void submit(false)()} data-testid="save-ledger">
          {ledger ? 'Save changes' : 'Create ledger'}
        </Button>
      </div>
      {confirmOff && <ConfirmDialog title={`Make ${ledger!.name} inactive?`} confirmLabel="Make inactive" tone="warning" loading={deactivate.isPending}
        description="It stays in the books and reports but cannot be used on new vouchers. Only a ledger with a zero balance can be made inactive."
        onConfirm={() => void makeInactive()} onClose={() => setConfirmOff(false)} />}
      {guard.dialog}
    </form>
  )
}
