import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { StaffAdvance } from '../../api/contract.gen'
import { useMoneyAccounts } from '../../api/money'
import { useEmployees, useStaffAdvanceAction, useStaffAdvances } from '../../api/payroll'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { Forbidden } from '../../components/states'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'

/**
 * P5 Staff advances (PEP-523): money given to an employee before payday, taken back by salary sheets an instalment a
 * month (oldest advance first). Balance and status are the server's. Reverse only while nothing was taken back.
 */
export const ADVANCE_STATUS = { open: { label: 'Owing', tone: 'warning' }, settled: { label: 'Settled', tone: 'positive' }, reversed: { label: 'Reversed', tone: 'neutral' } } as const

export function StaffAdvanceList() {
  const { PageHeader, Button, DataTable, EmptyState, Badge, Tabs } = ds()
  const { can } = useSession()
  const toast = useToast()
  const { get, set, page } = useListParams()
  const tab = (['open', 'settled', 'reversed'] as const).find((t) => t === get('tab')) ?? 'open'
  const list = useStaffAdvances({ status: tab, page })
  const act = useStaffAdvanceAction()
  const idem = useIdempotencyKey()
  const [giving, setGiving] = useState(false)
  const [undo, setUndo] = useState<StaffAdvance | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  if (!can('payroll.view')) return <Forbidden permission="payroll.view" what="staff advances" />

  async function reverse() {
    if (!undo || !reason.trim()) return
    try {
      await act.reverse.mutateAsync({ id: undo.id, reason: reason.trim(), idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: 'Advance reversed', description: `${formatTaka(undo.amount, { symbol: true })} went back into ${undo.money_account.name as string}.` })
    } catch (e) {
      setError(e)
    }
    setUndo(null); setReason('')
  }

  const rows = (list.data?.data ?? []).map((a) => ({
    id: a.id, employee: `${a.employee.name as string} · ${a.employee.code as string}`, given: a.given_on, amount: formatTaka(a.amount, { symbol: true }),
    instalment: `${formatTaka(a.instalment, { symbol: true })} a month`, recovered: formatTaka(a.recovered, { symbol: true }), balance: formatTaka(a.balance, { symbol: true }),
    status: <Badge tone={ADVANCE_STATUS[a.status].tone} dot>{ADVANCE_STATUS[a.status].label}</Badge>,
    actions: a.status === 'open' && a.recovered === '0.00' && can('payroll.approve')
      ? <Button size="sm" variant="ghost" icon="undo-2" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setUndo(a) }} data-testid={`reverse-advance-${a.id}`}>Reverse</Button> : null,
  }))
  const columns = [
    { key: 'employee', label: 'Employee' }, { key: 'given', label: 'Given on' }, { key: 'amount', label: 'Amount', align: 'right' as const },
    { key: 'instalment', label: 'Taken back' }, { key: 'recovered', label: 'Recovered', align: 'right' as const }, { key: 'balance', label: 'Still owed', align: 'right' as const },
    { key: 'status', label: 'Status' }, { key: 'actions', label: '', align: 'right' as const },
  ]
  const give = can('payroll.approve') ? <Button variant="primary" icon="plus" onClick={() => setGiving(true)} data-testid="give-advance">Give advance</Button> : undefined
  const empty = <EmptyState icon="hand-coins" title={tab === 'open' ? 'Nobody owes an advance' : 'Nothing here'}
    description="Give an employee money before payday; each salary sheet takes back the monthly amount until it is settled." action={tab === 'open' ? give : undefined} />

  return (
    <>
      <PageHeader title="Staff advances" description="Money given before payday, taken back from salary sheets a month at a time." actions={give} />
      <div style={{ marginBottom: 12 }}>
        <Tabs key={tab} value={tab} onChange={(v) => set({ tab: v === 'open' ? null : v })} items={[{ value: 'open', label: 'Owing' }, { value: 'settled', label: 'Settled' }, { value: 'reversed', label: 'Reversed' }]} />
      </div>
      <ProblemBanner error={list.error ?? error} onRetry={list.error ? () => void list.refetch() : undefined} />
      <ListCard label="Staff advances" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, mobileColumns: ['employee', 'balance', 'actions'], badgeKey: 'status', empty }}>
        <DataTable columns={columns} rows={rows} loading={list.isPending} emptyState={empty} />
      </ListCard>
      {giving && <GiveAdvanceDialog onClose={() => setGiving(false)} />}
      {undo && (
        <ConfirmDialog title="Reverse this advance?" tone="warning" confirmLabel="Reverse" loading={act.reverse.isPending} onConfirm={() => void reverse()} onClose={() => setUndo(null)}
          description={`${formatTaka(undo.amount, { symbol: true })} to ${undo.employee.name as string} is undone and goes back into ${undo.money_account.name as string}.`}>
          <ReasonField value={reason} onChange={setReason} />
        </ConfirmDialog>
      )}
    </>
  )
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { Field, Input } = ds()
  return <Field label="Reason" htmlFor="adv-reason"><Input id="adv-reason" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Given by mistake" /></Field>
}

function GiveAdvanceDialog({ onClose }: { onClose: () => void }) {
  const { Button, Field, Input, Select } = ds()
  const toast = useToast()
  const employees = useEmployees({ status: 'active' })
  const accounts = useMoneyAccounts({ purpose: 'payments' })
  const act = useStaffAdvanceAction()
  const idem = useIdempotencyKey()
  const [v, setV] = useState({ employee_id: '', money_account_id: '', given_on: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }), amount: '', instalment: '', reference: '' })
  const [error, setError] = useState<unknown>(null)
  const fieldError = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))

  async function save() {
    setError(null)
    try {
      const a = await act.give.mutateAsync({ idempotencyKey: idem.key, input: { employee_id: Number(v.employee_id), money_account_id: Number(v.money_account_id), given_on: v.given_on,
        amount: v.amount.trim(), instalment: v.instalment.trim(), reference: v.reference.trim() || null } })
      idem.reset()
      toast({ tone: 'positive', title: 'Advance given', description: `${formatTaka(a.amount, { symbol: true })} to ${a.employee.name as string}; ${formatTaka(a.instalment, { symbol: true })} comes back each month.` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <ResponsiveDialog title="Give an advance" tone="info" width={520} onClose={onClose} testId="give-advance-dialog"
      description="Pluto takes the money out of the account you choose; each salary sheet takes back the monthly amount."
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button>
        <Button variant="primary" loading={act.give.isPending} disabled={act.give.isPending || !v.employee_id || !v.money_account_id || !v.amount || !v.instalment} onClick={() => void save()} data-testid="confirm-advance">Give advance</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />
        <Field label="Employee" htmlFor="adv-emp" error={fieldError('employee_id')}>
          <Select id="adv-emp" value={v.employee_id} onChange={set('employee_id')}
            options={[{ value: '', label: employees.isPending ? 'Loading…' : 'Choose an employee' }, ...(employees.data?.data ?? []).map((e) => ({ value: String(e.id), label: `${e.name} · ${e.code}` }))]} />
        </Field>
        <Field label="Pay from" htmlFor="adv-acc" error={fieldError('money_account_id')}>
          <Select id="adv-acc" value={v.money_account_id} onChange={set('money_account_id')}
            options={[{ value: '', label: accounts.isPending ? 'Loading…' : 'Choose cash, bank or wallet' }, ...(accounts.data ?? []).filter((a) => a.is_active).map((a) => ({ value: String(a.id), label: a.name }))]} />
        </Field>
        <div className="lf-grid">
          <div className="lf-c6"><Field label="Amount (৳)" htmlFor="adv-amt" error={fieldError('amount')}><Input id="adv-amt" inputMode="decimal" value={v.amount} onChange={set('amount')} /></Field></div>
          <div className="lf-c6"><Field label="Take back each month (৳)" htmlFor="adv-inst" error={fieldError('instalment')} hint="Not more than the advance">
            <Input id="adv-inst" inputMode="decimal" value={v.instalment} onChange={set('instalment')} /></Field></div>
          <div className="lf-c6"><Field label="Given on" htmlFor="adv-on" error={fieldError('given_on')}><Input id="adv-on" type="date" value={v.given_on} onChange={set('given_on')} /></Field></div>
          <div className="lf-c6"><Field label="Reference" htmlFor="adv-ref" hint="Optional"><Input id="adv-ref" value={v.reference} onChange={set('reference')} /></Field></div>
        </div>
      </div>
    </ResponsiveDialog>
  )
}
