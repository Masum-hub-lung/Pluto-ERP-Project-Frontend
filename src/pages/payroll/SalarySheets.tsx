import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { PayrollLine, PayrollRun, PayrollRunCreate } from '../../api/contract.gen'
import { usePayrollRun, usePayrollRunAction, usePayrollRuns } from '../../api/payroll'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListCard } from '../../components/ListCard'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { Forbidden, NotFound } from '../../components/states'
import { ds } from '../../ds'
import { compareDecimal, isPositiveAmount } from '../../lib/decimal'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'
import { PAYMENT_STATUS, PayDialog, PaymentsCard } from './SalaryPayments'

/**
 * P3 Salary sheets and P4 Salary sheet (PEP-521). A draft sheet takes overtime, other earnings and deductions per
 * person; Save sends only those, and every figure shown (days paid, structure, gross, net, totals) is the server's.
 * Approve posts the salary entry; Cancel reverses an approved sheet.
 * PEP-524: festival bonus sheets (kind bonus) live in the same list; the server picks who qualifies and works out each
 * bonus (a % of basic or a fixed amount); a draft takes a changed bonus or a deduction per person.
 */
type Editable = 'overtime' | 'other_earnings' | 'deductions' | 'advance_recovery'
const EDITABLE: Array<{ key: Editable; label: string }> = [{ key: 'overtime', label: 'Overtime' }, { key: 'other_earnings', label: 'Other' }, { key: 'deductions', label: 'Deductions' },
  { key: 'advance_recovery', label: 'Advance' }] // PEP-523: filled from the employee's open advances
const BONUS_EDITABLE: Array<{ key: Editable; label: string }> = [{ key: 'other_earnings', label: 'Bonus' }, { key: 'deductions', label: 'Deductions' }]
const MONEY = /^\d{1,13}(\.\d{1,2})?$/
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/

/** The sheet's title: "Festival bonus, April 2027 · Eid-ul-Fitr" for a bonus sheet with a festival named. */
export function sheetTitle(r: Pick<PayrollRun, 'kind' | 'label' | 'notes'>): string {
  return r.kind === 'bonus' && r.notes ? `${r.label} · ${r.notes}` : r.label
}

export type BonusForm = { festival: string; month: string; pay_date: string; basis: 'percent' | 'fixed'; value: string; min_service_months: string }

/** The bonus dialog as PayrollRunCreate, or the first problem to show. The server works out who qualifies and each bonus. */
export function bonusInput(f: BonusForm): { input: PayrollRunCreate | null; bad: string | null } {
  const value = f.value.trim()
  const months = f.min_service_months.trim()
  if (!f.month) return { input: null, bad: 'Choose the month' }
  const ok = f.basis === 'percent' ? PERCENT.test(value) && compareDecimal(value, '0') > 0 && compareDecimal(value, '500') <= 0 : MONEY.test(value) && isPositiveAmount(value)
  if (!ok) {
    return { input: null, bad: f.basis === 'percent' ? 'Enter a percentage of basic above 0, up to 500' : 'Enter the bonus amount, above 0' }
  }
  // whole months, not money
  if (!/^\d{1,3}$/.test(months) || Number(months) > 120) return { input: null, bad: 'Enter the minimum service in whole months, 0 to 120' }
  return { input: { kind: 'bonus', month: f.month, pay_date: f.pay_date || null, notes: f.festival.trim() || null, min_service_months: Number(months),
    ...(f.basis === 'percent' ? { bonus_percent: value } : { bonus_amount: value }) }, bad: null }
}

export const STATUS = { draft: { label: 'Draft', tone: 'warning' }, approved: { label: 'Approved', tone: 'positive' }, cancelled: { label: 'Cancelled', tone: 'neutral' } } as const

/** The month before `today` as YYYY-MM: the usual sheet to prepare. */
export function lastMonth(today: Date = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  return d.toISOString().slice(0, 7)
}

/** Changed lines only, as the API expects; '' means 0. Returns the first bad field instead when an amount is not money. */
export function lineChanges(lines: readonly PayrollLine[], edits: Record<number, Partial<Record<Editable | 'note', string>>>):
  { changes: Array<{ id: number } & Partial<Record<Editable | 'note', string | null>>>; bad: string | null } {
  const changes: Array<{ id: number } & Partial<Record<Editable | 'note', string | null>>> = []
  for (const l of lines) {
    const e = edits[l.id]
    if (!e) continue
    const c: { id: number } & Partial<Record<Editable | 'note', string | null>> = { id: l.id }
    for (const { key } of EDITABLE) {
      const v = e[key]
      if (v === undefined || v === l[key]) continue
      const t = v.trim() === '' ? '0' : v.trim()
      if (!MONEY.test(t)) return { changes: [], bad: `${l.employee_name}: enter an amount of 0 or more with up to 2 decimals` }
      c[key] = t
    }
    if (e.note !== undefined && e.note !== (l.note ?? '')) c.note = e.note.trim() || null
    if (Object.keys(c).length > 1) changes.push(c)
  }
  return { changes, bad: null }
}

export function SalarySheetList() {
  const { PageHeader, Button, DataTable, EmptyState, Badge, Field, Input } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const { set, page } = useListParams()
  const list = usePayrollRuns({ page })
  const act = usePayrollRunAction(0)
  const idem = useIdempotencyKey()
  const [open, setOpen] = useState(false)
  const [bonusOpen, setBonusOpen] = useState(false) // PEP-524
  const [month, setMonth] = useState(lastMonth())
  const [error, setError] = useState<unknown>(null)
  if (!can('payroll.view')) return <Forbidden permission="payroll.view" what="salary sheets" />

  async function start() {
    setError(null)
    try {
      const r = await act.create.mutateAsync({ input: { month }, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `${r.label} started`, description: `${r.employees_count} employees, ${formatTaka(r.total_net, { symbol: true })} net. Add overtime or deductions, then approve.` })
      navigate(`/payroll/sheets/${r.id}`)
    } catch (e) {
      setError(e)
    }
  }

  const rows = (list.data?.data ?? []).map((r) => ({
    id: r.id, month: sheetTitle(r), employees: String(r.employees_count), gross: formatTaka(r.total_gross, { symbol: true }),
    deductions: formatTaka(r.total_deductions, { symbol: true }), net: formatTaka(r.total_net, { symbol: true }),
    status: <Badge tone={STATUS[r.status].tone} dot>{STATUS[r.status].label}</Badge>,
  }))
  const columns = [
    { key: 'month', label: 'Month' }, { key: 'employees', label: 'Employees', align: 'right' as const }, { key: 'gross', label: 'Gross', align: 'right' as const },
    { key: 'deductions', label: 'Deductions', align: 'right' as const }, { key: 'net', label: 'Net', align: 'right' as const }, { key: 'status', label: 'Status' },
  ]
  const newButton = can('payroll.create') ? <Button variant="primary" icon="plus" onClick={() => setOpen(true)} data-testid="new-sheet">New salary sheet</Button> : undefined
  const bonusButton = can('payroll.create') ? <Button variant="secondary" icon="sparkles" onClick={() => setBonusOpen(true)} data-testid="new-bonus-sheet">New bonus sheet</Button> : undefined
  const empty = <EmptyState icon="sheet" title="No salary sheets yet" description="Start a month: Pluto lists everyone employed that month with their salary, part months worked out by days." action={newButton} />

  return (
    <>
      <PageHeader title="Salary sheets" description="One sheet a month, plus festival bonus sheets: prepare, approve to post, then pay."
        actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{bonusButton}{newButton}</div>} />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Salary sheets" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(`/payroll/sheets/${r.id}`), mobileColumns: ['month', 'net', 'status'], badgeKey: 'status', empty }}>
        <DataTable columns={columns} rows={rows} loading={list.isPending} emptyState={empty} onRowClick={(r: { id: number }) => navigate(`/payroll/sheets/${r.id}`)} />
      </ListCard>
      {open && (
        <ResponsiveDialog title="New salary sheet" tone="info" width={440} onClose={() => setOpen(false)} testId="new-sheet-dialog"
          description="Everyone employed in the month is added with their salary; someone who joined or left in it is paid for their days."
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
            <Button variant="primary" loading={act.create.isPending} disabled={act.create.isPending || !month} onClick={() => void start()} data-testid="confirm-new-sheet">Start sheet</Button></>}>
          <div style={{ display: 'grid', gap: 12 }}>
            <ProblemBanner error={error} />
            <Field label="Month" htmlFor="sheet-month"><Input id="sheet-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
          </div>
        </ResponsiveDialog>
      )}
      {bonusOpen && <BonusDialog onClose={() => setBonusOpen(false)} />}
    </>
  )
}

/** PEP-524: start a festival bonus sheet. */
function BonusDialog({ onClose }: { onClose: () => void }) {
  const { Button, Field, Input, Segmented } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const act = usePayrollRunAction(0)
  const idem = useIdempotencyKey()
  const [f, setF] = useState<BonusForm>({ festival: 'Eid-ul-Fitr', month: new Date().toISOString().slice(0, 7), pay_date: '', basis: 'percent', value: '100', min_service_months: '12' })
  const [error, setError] = useState<unknown>(null)
  const set = (k: keyof BonusForm) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }))

  async function start() {
    setError(null)
    const { input, bad } = bonusInput(f)
    if (!input) { setError(new Error(bad ?? 'Check the form')); return }
    try {
      const r = await act.create.mutateAsync({ input, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `${sheetTitle(r)} started`, description: `${r.employees_count} employees, ${formatTaka(r.total_net, { symbol: true })} in all. Change a bonus if needed, then approve.` })
      navigate(`/payroll/sheets/${r.id}`)
    } catch (e) {
      setError(e)
    }
  }

  return (
    <ResponsiveDialog title="New festival bonus sheet" tone="info" width={480} onClose={onClose} testId="new-bonus-dialog"
      description="Everyone still working on the pay date who has served the minimum gets the bonus. You can change any amount before approving."
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button>
        <Button variant="primary" loading={act.create.isPending} disabled={act.create.isPending} onClick={() => void start()} data-testid="confirm-new-bonus">Start bonus sheet</Button></>}>
      <div className="lf-grid" style={{ gap: 12 }}>
        <div className="lf-c12"><ProblemBanner error={error} /></div>
        <div className="lf-c12"><Field label="Festival" htmlFor="bonus-festival" hint="Eid-ul-Fitr, Eid-ul-Adha, Durga Puja…"><Input id="bonus-festival" value={f.festival} onChange={set('festival')} maxLength={500} /></Field></div>
        <div className="lf-c6"><Field label="Month" htmlFor="bonus-month"><Input id="bonus-month" type="month" value={f.month} onChange={set('month')} /></Field></div>
        <div className="lf-c6"><Field label="Pay date" htmlFor="bonus-date" hint="Month end if empty"><Input id="bonus-date" type="date" value={f.pay_date} onChange={set('pay_date')} /></Field></div>
        <div className="lf-c12"><Field label="Bonus is">
          <Segmented options={[{ value: 'percent', label: '% of basic salary' }, { value: 'fixed', label: 'Same amount for all' }]} value={f.basis}
            onChange={(v: string) => setF((x) => ({ ...x, basis: v as BonusForm['basis'], value: v === 'percent' ? '100' : '' }))} />
        </Field></div>
        <div className="lf-c6"><Field label={f.basis === 'percent' ? 'Percent of basic' : 'Amount (৳)'} htmlFor="bonus-value"><Input id="bonus-value" inputMode="decimal" value={f.value} onChange={set('value')} /></Field></div>
        <div className="lf-c6"><Field label="Minimum service (months)" htmlFor="bonus-service" hint="By the pay date"><Input id="bonus-service" inputMode="numeric" value={f.min_service_months} onChange={set('min_service_months')} /></Field></div>
      </div>
    </ResponsiveDialog>
  )
}

export function SalarySheet() {
  const { can } = useSession()
  const id = Number(useParams().id)
  const q = usePayrollRun(id)
  if (!can('payroll.view')) return <Forbidden permission="payroll.view" what="salary sheets" />
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this salary sheet" back="/payroll/sheets" backLabel="Salary sheets" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  return <Sheet key={`${q.data.id}-${q.data.version}`} run={q.data} />
}

function Sheet({ run }: { run: PayrollRun }) {
  const { PageHeader, Button, Badge, Input, Card, Field } = ds()
  const { can } = useSession()
  const toast = useToast()
  const navigate = useNavigate()
  const act = usePayrollRunAction(run.id)
  const idem = useIdempotencyKey()
  const [edits, setEdits] = useState<Record<number, Partial<Record<Editable | 'note', string>>>>({})
  const [error, setError] = useState<unknown>(null)
  const [ask, setAsk] = useState<null | 'approve' | 'delete' | 'cancel'>(null)
  const [paying, setPaying] = useState(false) // PEP-522
  const [reason, setReason] = useState('')
  const lines = run.lines ?? []
  const bonus = run.kind === 'bonus' // PEP-524
  const cols = bonus ? BONUS_EDITABLE : EDITABLE
  const title = sheetTitle(run)
  const draft = run.status === 'draft'
  const canPrepare = draft && can('payroll.create')
  const dirty = Object.keys(edits).length > 0
  const edit = (id: number, key: Editable | 'note', v: string) => setEdits((e) => ({ ...e, [id]: { ...e[id], [key]: v } }))
  const shown = (l: PayrollLine, key: Editable) => edits[l.id]?.[key] ?? (l[key] === '0.00' ? '' : l[key])

  async function save(): Promise<boolean> {
    setError(null)
    const { changes, bad } = lineChanges(lines, edits)
    if (bad) { setError(new Error(bad)); return false }
    try {
      await act.update.mutateAsync({ input: { lines: changes }, version: run.version })
      toast({ tone: 'positive', title: 'Sheet saved', description: 'Gross, net and the totals are worked out again.' })
      return true
    } catch (e) {
      setError(e)
      return false
    }
  }

  async function run_(kind: 'approve' | 'delete' | 'cancel') {
    setError(null)
    try {
      if (kind === 'delete') {
        await act.remove.mutateAsync()
        toast({ tone: 'positive', title: `${title} deleted` })
        navigate('/payroll/sheets')
        return
      }
      if (kind === 'approve') {
        if (dirty && !(await save())) { setAsk(null); return }
        const r = await act.approve.mutateAsync({ idempotencyKey: idem.key })
        toast({ tone: 'positive', title: `${title} approved`, description: `Posted as ${r.voucher_number ?? 'a journal'}: ${formatTaka(r.total_net, { symbol: true })} salaries payable.` })
      } else {
        await act.cancel.mutateAsync({ reason: reason.trim(), idempotencyKey: idem.key })
        toast({ tone: 'positive', title: `${title} cancelled`, description: bonus ? 'The bonus entry was reversed.' : 'The salary entry was reversed.' })
      }
      idem.reset()
      setAsk(null)
    } catch (e) {
      setAsk(null)
      setError(e)
    }
  }

  const money = (v: string) => <span className="lf-num">{formatTaka(v)}</span>
  const cell = { padding: '8px 10px', borderTop: '1px solid var(--line)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
  return (
    <>
      <PageHeader title={title} description={`Pay date ${run.pay_date}${run.voucher_number ? ` · entry ${run.voucher_number}` : ''}${run.approved_by ? ` · approved by ${run.approved_by.name}` : ''}`}
        actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge tone={STATUS[run.status].tone} dot>{STATUS[run.status].label}</Badge>
          {run.status === 'approved' && <Badge tone={PAYMENT_STATUS[run.payment_status].tone}>{PAYMENT_STATUS[run.payment_status].label}</Badge>}
          {run.status === 'approved' && run.payment_status !== 'paid' && can('payroll.approve') && <Button variant="primary" icon="banknote" onClick={() => setPaying(true)} data-testid="pay-sheet">{bonus ? 'Pay bonus' : 'Pay salaries'}</Button>}
          {canPrepare && <Button variant="ghost" onClick={() => setAsk('delete')} data-testid="delete-sheet">Delete draft</Button>}
          {canPrepare && <Button variant="secondary" disabled={!dirty || act.update.isPending} loading={act.update.isPending} onClick={() => void save().then((ok) => { if (ok) setEdits({}) })} data-testid="save-sheet">Save changes</Button>}
          {draft && can('payroll.approve') && <Button variant="primary" icon="check" onClick={() => setAsk('approve')} data-testid="approve-sheet">Approve and post</Button>}
          {run.status === 'approved' && can('payroll.approve') && <Button variant="secondary" icon="undo-2" onClick={() => setAsk('cancel')} data-testid="cancel-sheet">Cancel sheet</Button>}
        </div>} />
      <ProblemBanner error={error} />
      {run.status === 'cancelled' && run.cancel_reason && <p style={{ margin: '0 0 12px', color: 'var(--ink-muted)' }}>Cancelled: {run.cancel_reason}</p>}
      <div className="lf-grid" style={{ marginBottom: 16 }}>
        {[draft ? ['Employees', String(run.employees_count)] : ['Paid so far', formatTaka(run.total_paid, { symbol: true })], ['Gross', formatTaka(run.total_gross, { symbol: true })], ['Deductions', formatTaka(run.total_deductions, { symbol: true })], ['Net to pay', formatTaka(run.total_net, { symbol: true })]].map(([k, v]) => (
          <div key={k} className="lf-c3" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: '12px 16px' }}>
            <div className="lf-label">{k}</div><div className="lf-num" style={{ font: '500 22px/30px var(--font-serif)' }} data-testid={`sheet-${k.toLowerCase().replace(/ /g, '-')}`}>{v}</div>
          </div>
        ))}
      </div>
      <Card title="Employees on this sheet" subtitle={draft ? (bonus ? 'Change a bonus or type a deduction, then Save changes. Net is worked out by Pluto.'
        : 'Type overtime, other earnings, deductions or the advance to take back, then Save changes. Gross and net are worked out by Pluto.') : undefined}>
        <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="Salary lines">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }} data-testid="sheet-lines">
            <thead><tr style={{ color: 'var(--ink-muted)', fontSize: 12, textTransform: 'uppercase' }}>
              <th style={{ ...cell, textAlign: 'left', borderTop: 0 }}>Employee</th>{bonus ? <th style={{ ...cell, borderTop: 0 }}>Basic</th> : <th style={{ ...cell, borderTop: 0 }}>Days</th>}
              {cols.map((c) => <th key={c.key} style={{ ...cell, borderTop: 0 }}>{c.label}</th>)}
              {!bonus && <th style={{ ...cell, borderTop: 0 }}>Gross</th>}<th style={{ ...cell, borderTop: 0 }}>Net</th>
              {!draft && <th style={{ ...cell, borderTop: 0 }}>Paid</th>}
            </tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id}>
                <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal', minWidth: 190 }}><strong>{l.employee_name}</strong><div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>{l.employee_code}{l.designation ? ` · ${l.designation}` : ''}</div>
                  {!bonus && <div style={{ color: 'var(--ink-muted)', fontSize: 12 }} className="lf-num">Basic {formatTaka(l.basic_salary)} · HR {formatTaka(l.house_rent)} · Med {formatTaka(l.medical)} · Conv {formatTaka(l.conveyance)}</div>}</td>
                {bonus ? <td style={cell}>{money(l.basic_salary)}</td> : <td style={cell}>{l.days_paid === l.days_in_month ? 'Full' : `${l.days_paid}/${l.days_in_month}`}</td>}
                {cols.map((c) => (
                  <td key={c.key} style={cell}>{canPrepare
                    ? <Input aria-label={`${c.label} for ${l.employee_name}`} inputMode="decimal" style={{ width: 88, textAlign: 'right' }} value={shown(l, c.key)} placeholder="0" onChange={(e) => edit(l.id, c.key, e.target.value)} />
                    : money(l[c.key])}</td>
                ))}
                {!bonus && <td style={cell}>{money(l.gross)}</td>}<td style={{ ...cell, fontWeight: 600 }}>{money(l.net)}</td>
                {!draft && <td style={cell}>{money(l.paid_amount)}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
      <div style={{ marginTop: 16 }}><PaymentsCard run={run} /></div>
      {paying && <PayDialog run={run} onClose={() => setPaying(false)} />}
      {ask === 'approve' && (
        <ConfirmDialog title={`Approve ${title}?`} tone="info" confirmLabel="Approve and post" loading={act.approve.isPending || act.update.isPending} onConfirm={() => void run_('approve')} onClose={() => setAsk(null)}
          description={`Pluto posts ${bonus ? 'the bonus' : 'the salaries'} on ${run.pay_date}: ${bonus ? 'festival bonus' : 'salary'} expense against salaries payable${dirty ? ', after saving your changes' : ''}. The sheet can no longer be changed; cancel it to undo.`} />
      )}
      {ask === 'delete' && (
        <ConfirmDialog title={`Delete ${title}?`} tone="negative" confirmLabel="Delete draft" loading={act.remove.isPending} onConfirm={() => void run_('delete')} onClose={() => setAsk(null)}
          description="Nothing was posted. You can start the month again." />
      )}
      {ask === 'cancel' && (
        <ConfirmDialog title={`Cancel ${title}?`} tone="warning" confirmLabel="Cancel sheet" loading={act.cancel.isPending} onConfirm={() => { if (reason.trim()) void run_('cancel') }} onClose={() => setAsk(null)}
          description={bonus ? 'Pluto reverses the bonus entry. Then you can start the bonus sheet again.' : 'Pluto reverses the salary entry. Then you can start the month again.'}>
          <Field label="Reason" htmlFor="sheet-reason"><Input id="sheet-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong overtime" /></Field>
        </ConfirmDialog>
      )}
    </>
  )
}
