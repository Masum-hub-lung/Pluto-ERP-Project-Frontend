import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Employee } from '../../api/contract.gen'
import { useEmployee, useEmployees, useSaveEmployee } from '../../api/payroll'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ConflictBanner } from '../../components/ConflictBanner'
import { FormErrorSummary } from '../../components/FormErrorSummary'
import { ListCard } from '../../components/ListCard'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden, NotFound } from '../../components/states'
import { ds } from '../../ds'
import { employeeSchema, employeeToForm, toEmployeeInput, type EmployeeFormParsed, type EmployeeFormValues } from '../../lib/employeeSchema'
import { formatTaka } from '../../lib/format'
import { applyProblemToForm } from '../../lib/forms'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'

/**
 * P1 Employees and P2 Employee form (PEP-520). Payroll is private (payroll.* permissions) and a plan module; the
 * monthly gross (basic + house rent + medical + conveyance) is the server's.
 */
export const PAY_METHODS = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank transfer' }, { value: 'mobile', label: 'Mobile wallet (bKash, Nagad…)' }] as const

export function payLabel(e: Pick<Employee, 'pay_method' | 'bank_name' | 'account_no'>): string {
  if (e.pay_method === 'cash') return 'Cash'
  const acc = e.account_no ? ` · ${e.account_no}` : ''
  return e.pay_method === 'bank' ? `${e.bank_name || 'Bank'}${acc}` : `Mobile wallet${acc}`
}

export function EmployeeList() {
  const { PageHeader, Button, Input, Tabs, DataTable, EmptyState, Badge } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const { get, set, search, setSearch, page } = useListParams()
  const tab = get('tab') === 'left' ? 'left' : 'active'
  const list = useEmployees({ q: search || undefined, status: tab, page })
  if (!can('payroll.view')) return <Forbidden permission="payroll.view" what="employees" />

  const rows = (list.data?.data ?? []).map((e) => ({
    id: e.id, code: e.code, name: e.name, designation: e.designation ?? '—', department: e.department ?? '—',
    gross: formatTaka(e.gross_salary, { symbol: true }), pay: payLabel(e),
    status: <Badge tone={e.status === 'active' ? 'positive' : 'neutral'} dot>{e.status === 'active' ? 'Active' : 'Left'}</Badge>,
  }))
  const columns = [
    { key: 'code', label: 'Code', mono: true }, { key: 'name', label: 'Name' }, { key: 'designation', label: 'Designation' }, { key: 'department', label: 'Department' },
    { key: 'gross', label: 'Gross salary', align: 'right' as const }, { key: 'pay', label: 'Paid by' }, { key: 'status', label: 'Status' },
  ]
  const empty = <EmptyState icon="users" title={tab === 'active' ? 'No employees yet' : 'Nobody has left'}
    description="Add the people you pay a salary: their basic, house rent, medical and conveyance, and how you pay them."
    action={tab === 'active' && can('payroll.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/payroll/employees/new')}>Add employee</Button> : undefined} />

  return (
    <>
      <PageHeader title="Employees" description="Everyone the company pays a salary, with their monthly gross."
        actions={can('payroll.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/payroll/employees/new')} data-testid="add-employee">Add employee</Button> : undefined} />
      <div style={{ marginBottom: 12 }}>
        <Tabs key={tab} value={tab} onChange={(v) => set({ tab: v === 'active' ? null : v })} items={[{ value: 'active', label: 'Active' }, { value: 'left', label: 'Left' }]} />
      </div>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Employees" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(`/payroll/employees/${r.id}`), mobileColumns: ['name', 'designation', 'gross'], badgeKey: 'status', empty }}
        toolbar={<div style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <Input icon="search" placeholder="Search name, code, mobile or designation" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        </div>}>
        <DataTable columns={columns} rows={rows} loading={list.isPending} emptyState={empty} onRowClick={(r: { id: number }) => navigate(`/payroll/employees/${r.id}`)} />
      </ListCard>
    </>
  )
}

export function EmployeeForm({ mode }: { mode: 'add' | 'edit' }) {
  const { can } = useSession()
  const id = Number(useParams().id)
  const existing = useEmployee(mode === 'edit' ? id : 0)
  if (!can('payroll.view')) return <Forbidden permission="payroll.view" what="employees" />
  if (mode === 'add' && !can('payroll.create')) return <Forbidden permission="payroll.create" what="adding employees" />
  if (mode === 'edit') {
    if (existing.error instanceof ApiError && existing.error.status === 404) return <NotFound what="this employee" back="/payroll/employees" backLabel="Employees" />
    if (existing.error) return <ProblemBanner error={existing.error} onRetry={() => void existing.refetch()} />
    if (!existing.data) return <PageSkeleton template="form" />
  }
  return <Form key={mode === 'edit' ? `${id}` : 'add'} employee={existing.data ?? null} />
}

function Form({ employee }: { employee: Employee | null }) {
  const { Card, Field, Input, Select, Button, PageHeader, Badge } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const save = useSaveEmployee(employee?.id ?? null)
  const idem = useIdempotencyKey()
  const editable = employee ? can('payroll.edit') : can('payroll.create')
  const [version, setVersion] = useState(employee?.version ?? 0)
  const [conflict, setConflict] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [leaving, setLeaving] = useState(false)
  const [leftOn, setLeftOn] = useState('')
  const defaults = useMemo(() => employeeToForm(employee), [employee])
  const { register, handleSubmit, setError, reset, watch, formState: { errors, isDirty, isSubmitting, submitCount } } =
    useForm<EmployeeFormValues, unknown, EmployeeFormParsed>({ resolver: zodResolver(employeeSchema), defaultValues: defaults })
  useEffect(() => { reset(defaults) }, [defaults]) // eslint-disable-line react-hooks/exhaustive-deps
  const guard = useUnsavedChangesBlocker(isDirty, 'This employee has unsaved changes.')
  const method = watch('pay_method')
  const err = (k: keyof EmployeeFormValues) => errors[k]?.message as string | undefined

  async function onValid(v: EmployeeFormParsed, extra: { status?: 'active' | 'left'; left_on?: string | null } = {}) {
    setFormError(null); setUnmatched([]); setConflict(false)
    try {
      const saved = await save.mutateAsync({ input: { ...toEmployeeInput(v), ...extra }, version, idempotencyKey: idem.key })
      if (!employee) idem.reset()
      setVersion(saved.version)
      reset(employeeToForm(saved))
      guard.allowNavigation()
      toast({ tone: 'positive', title: employee ? 'Changes saved' : `${saved.name} added as ${saved.code}`, description: `Gross salary ${formatTaka(saved.gross_salary, { symbol: true })} a month.` })
      navigate(employee ? '/payroll/employees' : `/payroll/employees/${saved.id}`)
    } catch (e) {
      const placed = applyProblemToForm(e, setError)
      if (placed) setUnmatched(placed.unmatched)
      else if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else setFormError(e)
    }
  }

  return (
    <form onSubmit={handleSubmit((v) => onValid(v))} noValidate>
      <PageHeader title={employee ? employee.name : 'Add employee'} description={employee ? `${employee.code}${employee.designation ? ` · ${employee.designation}` : ''}` : 'The code (EMP-…) is given when you save.'}
        actions={employee ? <Badge tone={employee.status === 'active' ? 'positive' : 'neutral'} dot>{employee.status === 'active' ? 'Active' : `Left ${employee.left_on ?? ''}`}</Badge> : undefined} />
      {conflict && <ConflictBanner onReload={() => window.location.reload()} />}
      <ProblemBanner error={formError} />
      <FormErrorSummary count={submitCount > 0 ? Object.keys(errors).length : 0} noun="employee" messages={unmatched} />
      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <Card title="Person">
            <div className="lf-grid">
              <div className="lf-c6"><Field label="Name" htmlFor="em-name" error={err('name')}><Input id="em-name" {...register('name')} disabled={!editable} /></Field></div>
              <div className="lf-c6"><Field label="Joining date" htmlFor="em-join" error={err('joining_date')}><Input id="em-join" type="date" {...register('joining_date')} disabled={!editable} /></Field></div>
              <div className="lf-c6"><Field label="Designation" htmlFor="em-des" error={err('designation')}><Input id="em-des" {...register('designation')} disabled={!editable} placeholder="Salesman" /></Field></div>
              <div className="lf-c6"><Field label="Department" htmlFor="em-dep" error={err('department')}><Input id="em-dep" {...register('department')} disabled={!editable} placeholder="Sales" /></Field></div>
              <div className="lf-c6"><Field label="Mobile" htmlFor="em-mob" error={err('mobile')}><Input id="em-mob" {...register('mobile')} disabled={!editable} inputMode="tel" /></Field></div>
              <div className="lf-c6"><Field label="E-mail" htmlFor="em-mail" hint="For payslips" error={err('email')}><Input id="em-mail" type="email" {...register('email')} disabled={!editable} /></Field></div>
              <div className="lf-c6"><Field label="National ID" htmlFor="em-nid" error={err('national_id')}><Input id="em-nid" {...register('national_id')} disabled={!editable} /></Field></div>
            </div>
          </Card>
          <Card title="Monthly salary">
            <div className="lf-grid">
              <div className="lf-c6"><Field label="Basic (৳)" htmlFor="em-basic" error={err('basic_salary')}><Input id="em-basic" inputMode="decimal" {...register('basic_salary')} disabled={!editable} /></Field></div>
              <div className="lf-c6"><Field label="House rent (৳)" htmlFor="em-hr" error={err('house_rent')}><Input id="em-hr" inputMode="decimal" {...register('house_rent')} disabled={!editable} placeholder="0" /></Field></div>
              <div className="lf-c6"><Field label="Medical (৳)" htmlFor="em-med" error={err('medical')}><Input id="em-med" inputMode="decimal" {...register('medical')} disabled={!editable} placeholder="0" /></Field></div>
              <div className="lf-c6"><Field label="Conveyance (৳)" htmlFor="em-conv" error={err('conveyance')}><Input id="em-conv" inputMode="decimal" {...register('conveyance')} disabled={!editable} placeholder="0" /></Field></div>
            </div>
          </Card>
          <Card title="How you pay them">
            <div className="lf-grid">
              <div className="lf-c6"><Field label="Pay method" htmlFor="em-pay"><Select id="em-pay" {...register('pay_method')} disabled={!editable} options={[...PAY_METHODS]} /></Field></div>
              {method === 'bank' && <div className="lf-c6"><Field label="Bank" htmlFor="em-bank" error={err('bank_name')}><Input id="em-bank" {...register('bank_name')} disabled={!editable} /></Field></div>}
              {method !== 'cash' && <div className="lf-c6"><Field label={method === 'bank' ? 'Account number' : 'Wallet number'} htmlFor="em-acc" error={err('account_no')}><Input id="em-acc" {...register('account_no')} disabled={!editable} /></Field></div>}
              <div className="lf-c12"><Field label="Notes" htmlFor="em-notes" error={err('notes')}><Input id="em-notes" {...register('notes')} disabled={!editable} /></Field></div>
            </div>
          </Card>
        </div>
        <aside className="lf-c4 lf-form-aside">
          <Card title="Gross a month">
            {employee
              ? <p style={{ margin: 0, font: '500 28px/34px var(--font-serif)' }} data-testid="employee-gross">{formatTaka(employee.gross_salary, { symbol: true })}</p>
              : <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Basic + house rent + medical + conveyance, worked out when you save.</p>}
            {employee && isDirty && <p style={{ margin: '8px 0 0', color: 'var(--ink-muted)', fontSize: 13 }}>Save to see the new gross.</p>}
          </Card>
        </aside>
      </div>
      <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, margin: '16px -24px -48px', padding: '12px 24px', background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <Button variant="ghost" type="button" onClick={() => navigate('/payroll/employees')}>Cancel</Button>
        <span style={{ flex: 1 }} />
        {employee && can('payroll.edit') && (employee.status === 'active'
          ? <Button variant="secondary" type="button" onClick={() => setLeaving(true)} data-testid="mark-left">Mark as left</Button>
          : <Button variant="secondary" type="button" onClick={handleSubmit((v) => onValid(v, { status: 'active', left_on: null }))}>Mark as working again</Button>)}
        {editable && <Button variant="primary" type="submit" loading={isSubmitting} disabled={isSubmitting} data-testid="save-employee">Save</Button>}
      </div>
      {leaving && (
        <ConfirmDialog title={`${employee?.name} has left?`} tone="warning" confirmLabel="Mark as left" loading={save.isPending} onClose={() => setLeaving(false)}
          description="They stay in past salary sheets; new sheets leave them out."
          onConfirm={handleSubmit(async (v) => { await onValid(v, { status: 'left', left_on: leftOn || null }); setLeaving(false) })}>
          <Field label="Last working day" htmlFor="em-left"><Input id="em-left" type="date" value={leftOn} onChange={(e) => setLeftOn(e.target.value)} /></Field>
        </ConfirmDialog>
      )}
      {guard.dialog}
    </form>
  )
}
