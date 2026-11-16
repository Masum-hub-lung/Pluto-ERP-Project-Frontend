import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { PayrollLine, PayrollPayment, PayrollRun } from '../../api/contract.gen'
import { useMoneyAccounts } from '../../api/money'
import { usePayrollPaymentAction, usePayrollPayments } from '../../api/payroll'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { ds } from '../../ds'
import { compareDecimal } from '../../lib/decimal'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'

/**
 * PEP-522 paying salaries on P4. "Everyone still due" lets the server pay each line what is left; "Choose amounts" sends
 * the amounts typed per person (the server refuses more than is due). What is due, paid and the status are the API's.
 */
const MONEY = /^\d{1,13}(\.\d{1,2})?$/

export const PAYMENT_STATUS = { unpaid: { label: 'Not paid', tone: 'warning' }, part_paid: { label: 'Part paid', tone: 'info' }, paid: { label: 'Paid', tone: 'positive' } } as const

/** Chosen amounts → payment lines ('' or 0 skipped); null when an amount is not money. */
export function chosenLines(amounts: Record<number, string>): Array<{ payroll_line_id: number; amount: string }> | null {
  const out: Array<{ payroll_line_id: number; amount: string }> = []
  for (const [id, raw] of Object.entries(amounts)) {
    const v = raw.trim()
    if (v === '') continue
    if (!MONEY.test(v)) return null
    if (compareDecimal(v, '0') > 0) out.push({ payroll_line_id: Number(id), amount: v })
  }
  return out
}

export function PayDialog({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const { Button, Field, Input, Select, Segmented } = ds()
  const toast = useToast()
  const accounts = useMoneyAccounts({ purpose: 'payments' })
  const act = usePayrollPaymentAction(run.id)
  const idem = useIdempotencyKey()
  const [account, setAccount] = useState('')
  const [paidOn, setPaidOn] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }))
  const [reference, setReference] = useState('')
  const [mode, setMode] = useState<'all' | 'choose'>('all')
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [error, setError] = useState<unknown>(null)
  const open = (run.lines ?? []).filter((l) => compareDecimal(l.paid_amount, l.net) < 0)

  async function pay() {
    setError(null)
    const lines = mode === 'choose' ? chosenLines(amounts) : undefined
    if (lines === null) { setError(new Error('Enter amounts with up to 2 decimals')); return }
    if (lines && lines.length === 0) { setError(new Error('Enter an amount for at least one person')); return }
    try {
      const p = await act.pay.mutateAsync({ idempotencyKey: idem.key, input: { money_account_id: Number(account), paid_on: paidOn, reference: reference.trim() || null, ...(lines ? { lines } : {}) } })
      idem.reset()
      toast({ tone: 'positive', title: 'Salaries paid', description: `${formatTaka(p.amount, { symbol: true })} to ${p.employees_count} ${p.employees_count === 1 ? 'person' : 'people'} from ${p.money_account.name as string}.` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  const fieldError = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  return (
    <ResponsiveDialog title="Pay salaries" tone="info" width={560} onClose={onClose} testId="pay-dialog"
      description={`${run.label}. Pluto records the payment against salaries payable and takes the money out of the account you choose.`}
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button>
        <Button variant="primary" icon="banknote" loading={act.pay.isPending} disabled={act.pay.isPending || !account || !paidOn} onClick={() => void pay()} data-testid="confirm-pay">Pay</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length && !fieldError('money_account_id') ? null : error} />
        <Field label="Pay from" htmlFor="pay-from" error={fieldError('money_account_id')}>
          <Select id="pay-from" value={account} onChange={(e) => setAccount(e.target.value)}
            options={[{ value: '', label: accounts.isPending ? 'Loading…' : 'Choose cash, bank or wallet' }, ...(accounts.data ?? []).filter((a) => a.is_active).map((a) => ({ value: String(a.id), label: a.name }))]} />
        </Field>
        <div className="lf-grid">
          <div className="lf-c6"><Field label="Paid on" htmlFor="pay-on" error={fieldError('paid_on')}><Input id="pay-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field></div>
          <div className="lf-c6"><Field label="Reference" htmlFor="pay-ref" hint="Cheque, transfer or bKash ID"><Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field></div>
        </div>
        <Field label="Who">
          <Segmented value={mode} onChange={(v: string) => setMode(v as 'all' | 'choose')} options={[{ value: 'all', label: 'Everyone still due' }, { value: 'choose', label: 'Choose amounts' }]} />
        </Field>
        {mode === 'choose' && (
          <div style={{ display: 'grid', gap: 8 }} data-testid="pay-lines">
            {open.map((l: PayrollLine) => (
              <div key={l.id} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ minWidth: 0 }}><strong>{l.employee_name}</strong>
                  <span style={{ display: 'block', color: 'var(--ink-muted)', fontSize: 12 }}>Net {formatTaka(l.net)} · paid {formatTaka(l.paid_amount)}</span></span>
                <Input aria-label={`Amount for ${l.employee_name}`} inputMode="decimal" style={{ width: 120, textAlign: 'right' }} placeholder="0" value={amounts[l.id] ?? ''}
                  onChange={(e) => setAmounts((a) => ({ ...a, [l.id]: e.target.value }))} />
              </div>
            ))}
            {open.length === 0 && <span style={{ color: 'var(--ink-muted)' }}>Everyone is paid.</span>}
          </div>
        )}
      </div>
    </ResponsiveDialog>
  )
}

export function PaymentsCard({ run }: { run: PayrollRun }) {
  const { Card, Button, Badge, Field, Input } = ds()
  const { can } = useSession()
  const toast = useToast()
  const q = usePayrollPayments(run.id)
  const act = usePayrollPaymentAction(run.id)
  const idem = useIdempotencyKey()
  const [undo, setUndo] = useState<PayrollPayment | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const rows = q.data ?? []
  if (run.status === 'draft') return null

  async function reverse() {
    if (!undo || !reason.trim()) return
    try {
      await act.reverse.mutateAsync({ id: undo.id, reason: reason.trim(), idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: 'Payment reversed', description: `${formatTaka(undo.amount, { symbol: true })} is due again.` })
      setUndo(null); setReason('')
    } catch (e) {
      setUndo(null); setError(e)
    }
  }

  return (
    <Card title="Payments" subtitle={rows.length ? undefined : 'Nothing paid yet.'}>
      <ProblemBanner error={q.error ?? error} onRetry={q.error ? () => void q.refetch() : undefined} />
      <div style={{ display: 'grid', gap: 0 }} data-testid="payments-list">
        {rows.map((p) => (
          <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <span style={{ minWidth: 0 }}>
              <strong className="lf-num">{formatTaka(p.amount, { symbol: true })}</strong> to {p.employees_count} {p.employees_count === 1 ? 'person' : 'people'} from {p.money_account.name as string}
              <span style={{ display: 'block', color: 'var(--ink-muted)', fontSize: 12 }}>{p.paid_on}{p.reference ? ` · ${p.reference}` : ''}{p.voucher_number ? ` · ${p.voucher_number}` : ''} · {p.lines.map((l) => l.employee_name).join(', ')}</span>
            </span>
            {p.status === 'reversed'
              ? <Badge tone="neutral">Reversed{p.reverse_reason ? `: ${p.reverse_reason}` : ''}</Badge>
              : can('payroll.approve') && <Button size="sm" variant="ghost" icon="undo-2" onClick={() => setUndo(p)} data-testid={`reverse-${p.id}`}>Reverse</Button>}
          </div>
        ))}
      </div>
      {undo && (
        <ConfirmDialog title="Reverse this payment?" tone="warning" confirmLabel="Reverse" loading={act.reverse.isPending} onConfirm={() => void reverse()} onClose={() => setUndo(null)}
          description={`${formatTaka(undo.amount, { symbol: true })} goes back into ${undo.money_account.name as string} and is due to the employees again.`}>
          <Field label="Reason" htmlFor="rev-reason"><Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Paid the wrong person" /></Field>
        </ConfirmDialog>
      )}
    </Card>
  )
}
