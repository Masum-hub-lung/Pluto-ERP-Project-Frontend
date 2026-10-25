import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useCreateMoneyAccount } from '../../api/money'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { applyProblemToForm } from '../../lib/forms'
import { ACCOUNT_TYPES, emptyMoneyAccount, moneyAccountSchema, needsBank, toMoneyAccountInput, type AccountType, type MoneyAccountFormValues } from '../../lib/moneyAccountSchema'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { FormErrorSummary } from '../../components/FormErrorSummary'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden } from '../../components/states'

/**
 * G4 Add account (Bnk-AddBank.dc.html; backlog P6.2-FE-02): type (cash, bank, mobile wallet, card, cash credit), the
 * account details a bank account needs, the opening balance with its "as of" date, and the use-for switches. The server
 * creates the ledger (1101/1102/… under Cash and bank, cash credit under liabilities) and posts the opening balance
 * dated the financial year's start (BR-028); the toast shows the balance it booked.
 */
export function MoneyAccountForm() {
  const { can } = useSession()
  if (!can('banking.create')) return <Forbidden permission="banking.create" what="adding money accounts" />
  return <Form />
}

function Form() {
  const { PageHeader, Card, Field, Input, Segmented, Switch, Button, Banner } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateMoneyAccount()
  const idem = useIdempotencyKey()
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const { register, handleSubmit, watch, setValue, setError, formState: { errors, isDirty, submitCount, isSubmitting } } =
    useForm<MoneyAccountFormValues>({ resolver: zodResolver(moneyAccountSchema) as never, defaultValues: emptyMoneyAccount(), mode: 'onSubmit' })
  const guard = useUnsavedChangesBlocker(isDirty, 'This account has not been added yet.')
  const v = watch()
  const bank = needsBank(v.account_type)

  const save = handleSubmit(async (values) => {
    setFormError(null); setUnmatched([])
    try {
      const a = await create.mutateAsync({ input: toMoneyAccountInput(values), idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `${a.name} added`, description: `Ledger ${a.ledger_code} · balance ${formatTaka(a.book_balance, { symbol: true })}` })
      guard.allowNavigation()
      navigate('/banking/accounts')
    } catch (e) {
      const placed = e instanceof ApiError && e.status === 422 ? applyProblemToForm(e, setError as never, {} as never, Object.keys(emptyMoneyAccount()) as never) : null
      if (placed) setUnmatched(placed.unmatched)
      else setFormError(e)
    }
  })

  const err = (k: keyof MoneyAccountFormValues) => errors[k]?.message
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 } as const

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save() }} noValidate data-testid="account-form">
      <PageHeader eyebrow="Cash and bank" title="Add account" description="Its ledger is created for you. Receipts and payments can then use it." />
      <FormErrorSummary count={submitCount > 0 ? Object.keys(errors).length : 0} noun="account" messages={unmatched} />
      <ProblemBanner error={formError} />
      <Card title="Account">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ overflowX: 'auto' }} data-testid="account-type">
            <Segmented options={ACCOUNT_TYPES} value={v.account_type} onChange={(t) => setValue('account_type', t as AccountType, { shouldDirty: true })} />
          </div>
          <div style={grid}>
            <Field label="Account name in the books" hint={bank ? 'Empty: "<bank> ••<last 4 digits>"' : v.account_type === 'cash' ? 'Empty: "Cash in hand"' : undefined}
              error={err('name')} htmlFor="ma-name">
              <Input id="ma-name" {...register('name')} invalid={!!errors.name} placeholder={v.account_type === 'wallet' ? 'bKash merchant 01711…' : undefined} />
            </Field>
            {(bank || v.account_type === 'card') && <>
              <Field label="Bank" required={bank} error={err('bank_name')} htmlFor="ma-bank"><Input id="ma-bank" {...register('bank_name')} invalid={!!errors.bank_name} /></Field>
              <Field label="Branch" error={err('branch_name')} htmlFor="ma-branch"><Input id="ma-branch" {...register('branch_name')} /></Field>
              <Field label="Name on the account" required={bank} error={err('account_name')} htmlFor="ma-holder"><Input id="ma-holder" {...register('account_name')} invalid={!!errors.account_name} /></Field>
              <Field label="Account number" required={bank} error={err('account_number')} htmlFor="ma-number"><Input id="ma-number" mono {...register('account_number')} invalid={!!errors.account_number} /></Field>
              <Field label="Routing number" hint="9 digits" error={err('routing_number')} htmlFor="ma-routing"><Input id="ma-routing" mono inputMode="numeric" {...register('routing_number')} invalid={!!errors.routing_number} /></Field>
            </>}
            {(v.account_type === 'bank' || v.account_type === 'cash_credit') && (
              <Field label={v.account_type === 'cash_credit' ? 'Cash-credit limit (৳)' : 'Overdraft limit (৳)'} hint="Payments may take the balance down to minus this"
                error={err('overdraft_limit')} htmlFor="ma-limit">
                <Input id="ma-limit" mono align="right" inputMode="decimal" {...register('overdraft_limit')} invalid={!!errors.overdraft_limit} />
              </Field>
            )}
            <Field label="Currency"><Input value="BDT" readOnly aria-label="Currency" /></Field>
          </div>
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Opening balance">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={grid}>
            <Field label="Opening balance (৳)" hint="Minus for an overdrawn account" error={err('opening_balance')} htmlFor="ma-opening">
              <Input id="ma-opening" mono align="right" inputMode="decimal" {...register('opening_balance')} invalid={!!errors.opening_balance} placeholder="0.00" />
            </Field>
            <Field label="As of" hint="Any date in the financial year" htmlFor="ma-asof"><Input id="ma-asof" type="date" {...register('opening_date')} /></Field>
          </div>
          <Banner tone="info">The opening balance is booked on the first day of the financial year, against the opening balance adjustment ledger. It can be changed until the account is used.</Banner>
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Use for">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Switch label="Receiving customer payments" checked={v.use_for_receipts} onChange={(c) => setValue('use_for_receipts', c, { shouldDirty: true })} />
          <Switch label="Paying suppliers" checked={v.use_for_payments} onChange={(c) => setValue('use_for_payments', c, { shouldDirty: true })} />
          <Switch label="Show on invoices (bank details for customers)" checked={v.show_on_invoices} onChange={(c) => setValue('show_on_invoices', c, { shouldDirty: true })} />
        </div>
      </Card>
      <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, margin: '16px -24px -48px', padding: '12px 24px', background: 'var(--surface)',
        borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={() => navigate('/banking/accounts')}>Cancel</Button>
        <Button variant="primary" icon="check" loading={isSubmitting} disabled={isSubmitting} onClick={() => void save()} data-testid="save-account">Add account</Button>
      </div>
      {guard.dialog}
    </form>
  )
}
