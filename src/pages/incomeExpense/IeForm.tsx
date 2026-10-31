import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Attachment } from '../../api/contract.gen'
import { useIeCategories, useRecordEntry, type IeKind } from '../../api/incomeExpense'
import { useTaxRules } from '../../api/inventory'
import { useMoneyAccounts } from '../../api/money'
import { dhakaToday } from '../../api/platform'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { applyProblemToForm } from '../../lib/forms'
import { emptyIeEntry, ieEntrySchema, nextDate, toIeEntryInput, type IeEntryFormValues, type IeMethod } from '../../lib/ieEntrySchema'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { AttachmentUploader } from '../../components/AttachmentUploader'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { FormErrorSummary } from '../../components/FormErrorSummary'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden } from '../../components/states'

/**
 * I3 Add income, I6 Add expense (Inc-Add.dc.html, Exp-Add.dc.html, Exp-AddErr.dc.html; backlog P13.2-FE-02): amount,
 * date, category, the account it was paid from / received into, method, who, reference, tax rule, notes, receipts
 * (uploaded straight away, linked on save) and an optional recurrence. The aside shows the category's budget use as the
 * API reports it (warning at its level, non-blocking) and what will post. Saving posts an EXP-/INC- voucher; above
 * the payment limit it waits for approval (202). "Save and add another" keeps the date, account and method.
 */
const METHODS: { value: IeMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'cheque', label: 'Cheque' }, { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' }, { value: 'card', label: 'Card' }, { value: 'beftn', label: 'BEFTN' }, { value: 'npsb', label: 'NPSB' }, { value: 'rtgs', label: 'RTGS' },
]
const FREQUENCIES = [{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'yearly', label: 'Yearly' }]
const FIELDS = ['amount', 'date', 'category_id', 'money_account_id', 'method', 'payee_text', 'reference', 'tax_rule_id', 'notes', 'next_run_on', 'ends_after_count', 'ends_on'] as const

export function IeForm({ kind }: { kind: IeKind }) {
  const { can } = useSession()
  if (!can('banking.create')) return <Forbidden permission="banking.create" what={kind === 'income' ? 'recording income' : 'recording expenses'} />
  return <Form kind={kind} />
}

function Form({ kind }: { kind: IeKind }) {
  const { PageHeader, Card, Field, Input, Select, Segmented, Switch, Button, Banner, Skeleton } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const income = kind === 'income'
  const base = income ? '/income' : '/expenses'
  const categories = useIeCategories(kind)
  const accounts = useMoneyAccounts({ purpose: income ? 'receipts' : 'payments' })
  const taxRules = useTaxRules()
  const record = useRecordEntry()
  const idem = useIdempotencyKey()
  const [files, setFiles] = useState<Attachment[]>([])
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [backdated, setBackdated] = useState<null | { another: boolean }>(null)
  const { register, handleSubmit, watch, setValue, setError, reset, formState: { errors, isDirty, submitCount, isSubmitting } } =
    useForm<IeEntryFormValues>({ resolver: zodResolver(ieEntrySchema) as never, defaultValues: emptyIeEntry(dhakaToday()), mode: 'onSubmit' })
  const guard = useUnsavedChangesBlocker(isDirty || files.length > 0, `This ${kind} has not been saved yet.`)
  const v = watch()
  const category = (categories.data ?? []).find((c) => String(c.id) === v.category_id)
  const account = (accounts.data ?? []).find((a) => String(a.id) === v.money_account_id)
  const rules = (taxRules.data ?? []).filter((r) => r.is_active !== false && (r.applies_to === 'both' || r.applies_to === (income ? 'sales' : 'purchases')))

  const submit = (another: boolean, confirm = false) => handleSubmit(async (values) => {
    setFormError(null); setUnmatched([])
    try {
      const { voucher, approval } = await record.mutateAsync({ input: toIeEntryInput(kind, values, files.map((f) => f.id), confirm), idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: approval ? 'warning' : 'positive', title: approval ? `${voucher.voucher_number} sent for approval` : `${voucher.voucher_number} saved`,
        description: approval ? 'It is above your approval limit; it posts when an approver accepts it.'
          : `${formatTaka(values.amount, { symbol: true })} ${income ? 'into' : 'from'} ${account?.name ?? 'the account'}${values.recurring ? ' · repeats ' + values.frequency : ''}.` })
      setFiles([])
      if (another) {
        reset({ ...emptyIeEntry(values.date), date: values.date, money_account_id: values.money_account_id, method: values.method, category_id: values.category_id })
      } else {
        guard.allowNavigation()
        navigate(`/accounting/vouchers/${voucher.id}`)
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'backdated_confirmation_required') { idem.reset(); setBackdated({ another }); return }
      const placed = e instanceof ApiError && e.status === 422 ? applyProblemToForm(e, setError as never, { 'recurrence.next_run_on': 'next_run_on', 'recurrence.ends_after_count': 'ends_after_count',
        'recurrence.ends_on': 'ends_on', 'recurrence.ends_': 'ends_on' } as never, FIELDS as never) : null
      if (placed && placed.applied.length > 0) setUnmatched(placed.unmatched)
      else setFormError(e)
    }
  })()

  const err = (k: keyof IeEntryFormValues) => errors[k]?.message
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 } as const
  const noun = income ? 'income' : 'expense'

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(false) }} noValidate data-testid="ie-form">
      <PageHeader eyebrow={income ? 'Income' : 'Expenses'} title={income ? 'Add income' : 'Add expense'}
        description={income ? 'Other income — commission, interest, scrap sales — received into cash or bank.' : 'An expense paid from cash or bank, with its receipt.'} />
      <FormErrorSummary count={submitCount > 0 ? Object.keys(errors).length : 0} noun={noun} messages={unmatched} />
      <ProblemBanner error={formError ?? categories.error ?? accounts.error} />
      {categories.data && categories.data.length === 0 && (
        <Banner tone="warning" title={`No ${noun} categories yet`} action={<Button variant="secondary" size="sm" onClick={() => navigate(`${base}/categories`)}>Add a category</Button>}>
          Each category posts to its own ledger; add one before recording {income ? 'income' : 'an expense'}.
        </Banner>
      )}
      <div className="lf-grid" style={{ alignItems: 'start', marginTop: 8 }}>
        <div className="lf-c8" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Details">
            <div style={grid}>
              <Field label="Amount (৳)" required error={err('amount')} htmlFor="ie-amount">
                <Input id="ie-amount" mono align="right" inputMode="decimal" autoFocus {...register('amount')} invalid={!!errors.amount} placeholder="0.00" />
              </Field>
              <Field label="Date" required error={err('date')} htmlFor="ie-date"><Input id="ie-date" type="date" {...register('date')} invalid={!!errors.date} /></Field>
              <Field label="Category" required error={err('category_id')} htmlFor="ie-category">
                {categories.isPending ? <Skeleton height={40} /> : (
                  <Select id="ie-category" value={v.category_id} onChange={(e) => setValue('category_id', e.target.value, { shouldDirty: true })} invalid={!!errors.category_id}
                    options={[{ value: '', label: 'Choose a category' }, ...(categories.data ?? []).map((c) => ({ value: String(c.id), label: `${c.name} · ${c.ledger_code}` }))]} />
                )}
              </Field>
              <Field label={income ? 'Received into' : 'Paid from'} required error={err('money_account_id')} htmlFor="ie-account">
                <Select id="ie-account" value={v.money_account_id} onChange={(e) => setValue('money_account_id', e.target.value, { shouldDirty: true })} invalid={!!errors.money_account_id}
                  options={[{ value: '', label: 'Choose the account' }, ...(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} />
              </Field>
            </div>
            <div style={{ marginTop: 16 }}>
              <Field label="Payment method">
                <div style={{ overflowX: 'auto' }} data-testid="ie-method">
                  <Segmented options={METHODS.slice(0, 6)} value={METHODS.slice(0, 6).some((m) => m.value === v.method) ? v.method : ''}
                    onChange={(m: string) => setValue('method', m as IeMethod, { shouldDirty: true })} />
                </div>
              </Field>
            </div>
            <div style={{ ...grid, marginTop: 16 }}>
              <Field label={income ? 'Received from' : 'Paid to'} error={err('payee_text')} htmlFor="ie-payee"><Input id="ie-payee" {...register('payee_text')} invalid={!!errors.payee_text} /></Field>
              <Field label="Reference" hint="Receipt, cheque or transaction number" error={err('reference')} htmlFor="ie-ref"><Input id="ie-ref" {...register('reference')} invalid={!!errors.reference} /></Field>
              <Field label="Tax rule" hint="The amount includes the tax" error={err('tax_rule_id')} htmlFor="ie-tax">
                <Select id="ie-tax" value={v.tax_rule_id} onChange={(e) => setValue('tax_rule_id', e.target.value, { shouldDirty: true })}
                  options={[{ value: '', label: 'No tax' }, ...rules.map((r) => ({ value: String(r.id), label: `${r.name} ${r.rate}%` }))]} />
              </Field>
            </div>
            <div style={{ marginTop: 16 }}>
              <Field label="Notes" error={err('notes')} htmlFor="ie-notes"><Input id="ie-notes" {...register('notes')} invalid={!!errors.notes} /></Field>
            </div>
          </Card>
          <Card title="Receipt or document">
            <AttachmentUploader type="voucher" pending={files} onChange={setFiles} compact testId="ie-attachments" />
          </Card>
          <Card title="Repeat">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Switch label={`Recurring ${noun}`} checked={v.recurring} onChange={(c) => setValue('recurring', c, { shouldDirty: true })} />
              {v.recurring && (
                <>
                  <div style={grid}>
                    <Field label="Repeats" htmlFor="ie-freq">
                      <Select id="ie-freq" value={v.frequency} options={FREQUENCIES}
                        onChange={(e) => { const f = e.target.value as IeEntryFormValues['frequency']; setValue('frequency', f, { shouldDirty: true }); setValue('next_run_on', nextDate(v.date, f)) }} />
                    </Field>
                    <Field label="Next on" error={err('next_run_on')} htmlFor="ie-next"><Input id="ie-next" type="date" {...register('next_run_on')} invalid={!!errors.next_run_on} /></Field>
                    <Field label="Ends" htmlFor="ie-ends">
                      <Select id="ie-ends" value={v.ends_type} onChange={(e) => setValue('ends_type', e.target.value as IeEntryFormValues['ends_type'], { shouldDirty: true })}
                        options={[{ value: 'never', label: 'Never' }, { value: 'after_count', label: 'After a number of times' }, { value: 'on_date', label: 'On a date' }]} />
                    </Field>
                    {v.ends_type === 'after_count' && <Field label="Times in all" error={err('ends_after_count')} htmlFor="ie-count"><Input id="ie-count" inputMode="numeric" {...register('ends_after_count')} invalid={!!errors.ends_after_count} /></Field>}
                    {v.ends_type === 'on_date' && <Field label="Last date" error={err('ends_on')} htmlFor="ie-ends-on"><Input id="ie-ends-on" type="date" {...register('ends_on')} invalid={!!errors.ends_on} /></Field>}
                  </div>
                  <Banner tone="info">Each time it is due, a draft is made for you to check and post. Nothing posts on its own.</Banner>
                </>
              )}
            </div>
          </Card>
        </div>
        <div className="lf-c4 lf-form-aside" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Summary">
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', fontSize: 14 }} data-testid="ie-summary">
              <dt style={{ color: 'var(--ink-muted)' }}>Amount</dt><dd style={{ margin: 0, textAlign: 'right' }} className="lf-num">{v.amount ? formatTaka(v.amount.trim(), { symbol: true }) : '—'}</dd>
              <dt style={{ color: 'var(--ink-muted)' }}>Category</dt><dd style={{ margin: 0, textAlign: 'right' }}>{category?.name ?? '—'}</dd>
              <dt style={{ color: 'var(--ink-muted)' }}>{income ? 'Into' : 'From'}</dt><dd style={{ margin: 0, textAlign: 'right' }}>{account?.name ?? '—'}</dd>
              <dt style={{ color: 'var(--ink-muted)' }}>Files</dt><dd style={{ margin: 0, textAlign: 'right' }}>{files.length}</dd>
            </dl>
          </Card>
          {category && category.monthly_budget && (
            <Card title="Budget this month">
              <div style={{ display: 'grid', gap: 8 }} data-testid="ie-budget">
                <span>{formatTaka(category.spent, { symbol: true })} of {formatTaka(category.monthly_budget, { symbol: true })} used{category.used_pct ? ` (${category.used_pct} %)` : ''}</span>
                <div style={{ height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden' }} aria-hidden>
                  <div style={{ width: `${Math.min(100, Number(category.used_pct ?? '0'))}%`, height: '100%', background: category.status === 'on_track' || category.status === 'not_used' ? 'var(--positive)' : 'var(--negative)' }} />
                </div>
                {(category.status === 'near_limit' || category.status === 'over_budget') && (
                  <Banner tone="warning" title={category.status === 'over_budget' ? 'Over budget' : 'Near the budget'}>
                    {category.name} has used {category.used_pct} % of its monthly budget. You can still save this {noun}.
                  </Banner>
                )}
              </div>
            </Card>
          )}
          <Card title="What posts">
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-muted)' }} data-testid="ie-posting">
              {category && account
                ? income ? <>Dr {account.name} · Cr {category.name} ({category.ledger_code}){v.tax_rule_id ? ' and the tax ledger' : ''}</>
                  : <>Dr {category.name} ({category.ledger_code}){v.tax_rule_id ? ' and the tax ledger' : ''} · Cr {account.name}</>
                : 'Choose a category and an account.'}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13 }}><Link to={`${base}/categories`}>Categories and budgets</Link></p>
          </Card>
        </div>
      </div>
      <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, margin: '16px -24px -48px', padding: '12px 24px', background: 'var(--surface)',
        borderTop: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={() => navigate(`${base}/list`)}>Cancel</Button>
        <Button variant="secondary" loading={isSubmitting} disabled={isSubmitting} onClick={() => void submit(true)} data-testid="save-add-another">Save and add another</Button>
        <Button variant="primary" icon="check" loading={isSubmitting} disabled={isSubmitting} onClick={() => void submit(false)} data-testid="save-ie">{income ? 'Save income' : 'Save expense'}</Button>
      </div>
      {backdated && <ConfirmDialog title={`Save a back-dated ${noun}?`} confirmLabel="Yes, save it" tone="warning" loading={record.isPending}
        description={`It is dated ${v.date}, older than the company's back-date window.`} onConfirm={() => { const a = backdated.another; setBackdated(null); void submit(a, true) }}
        onClose={() => setBackdated(null)} />}
      {guard.dialog}
    </form>
  )
}
