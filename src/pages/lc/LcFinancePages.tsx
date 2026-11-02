import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { BankFacility, FxRevaluation, LcLoan, LcLoanRepayment } from '../../api/contract.gen'
import {
  LOAN_KIND, LOAN_STATUS, useBankFacilities, useConvertLoan, useFxRevaluation, useFxRevaluations, useLcLoan, useLcLoans, useLoanInterest, useRepayLoan,
  useReverseRepayment, useSaveBankFacility, type FxLine,
} from '../../api/lcFinance'
import { useMoneyAccounts } from '../../api/money'
import { dhakaToday } from '../../api/platform'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { compareDecimal } from '../../lib/decimal'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'
import { ConflictBanner } from '../../components/ConflictBanner'
import { ListCard } from '../../components/ListCard'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { NotFound } from '../../components/states'
import { SummaryTile } from '../../components/SummaryTile'
import { ReasonDialog } from '../../components/trade/TradeParts'
import { panel } from '../inventory/parts'
import { shortDate } from '../purchases/BillList'
import { LcNav } from './LcPages'

/**
 * LC finance inside the LC portal (P16.5-FE; 06 §12.11–12.13; BR-066–BR-068): Banks and limits, PAD/LTR loans (list,
 * details, repay, PAD → LTR, reverse) and period-end FX revaluation. Utilisation, interest, outstanding principal and
 * revaluation differences are the API's; this page only shows them and sends what the user typed.
 */
const card = { ...panel, padding: '16px 20px' } as const
const h2 = { margin: '0 0 8px', font: '650 16px/24px var(--font-sans)' } as const
const DEC = /^\d{1,13}(\.\d{1,6})?$/
const taka = (v: string | null | undefined) => (v == null ? '—' : formatTaka(v, { symbol: true }))

type Errors = Record<string, string | undefined>
function fieldErrors(e: unknown): Errors {
  if (!(e instanceof ApiError) || e.status !== 422) return {}
  return Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0]]))
}
const conflictOf = (e: unknown) => e instanceof ApiError && e.status === 409 && e.problem.code === 'version_conflict'

// ---------------------------------------------------------------- Banks and limits

/** LC portal: each bank's LC and loan limits, what is used and what is left (BR-066). */
export function LcBanks() {
  const { PageHeader, Button, DataTable, EmptyState, Badge } = ds()
  const { can } = useSession()
  const q = useBankFacilities()
  const [editing, setEditing] = useState<BankFacility | 'new' | null>(null)
  const over = (avail: string | null | undefined) => avail != null && compareDecimal(avail, '0') < 0
  const columns: DataColumn[] = [
    { key: 'bank_name', label: 'Bank' },
    { key: 'lc_limit', label: 'LC limit (৳)', type: 'amount' }, { key: 'lc_utilised', label: 'LC used (৳)', type: 'amount' },
    { key: 'lc_available', label: 'LC available (৳)', align: 'right', render: (v: string | null) => v == null ? 'No limit' : <span className="lf-num" style={over(v) ? { color: 'var(--negative)' } : undefined}>{formatTaka(v)}</span> },
    { key: 'loan_limit', label: 'Loan limit (৳)', type: 'amount' }, { key: 'loans_outstanding', label: 'Loans (৳)', type: 'amount' },
    { key: 'loan_available', label: 'Loan available (৳)', align: 'right', render: (v: string | null) => v == null ? 'No limit' : <span className="lf-num" style={over(v) ? { color: 'var(--negative)' } : undefined}>{formatTaka(v)}</span> },
    { key: 'terms', label: 'Loan terms' },
    { key: 'limit_action', label: 'Over the limit', render: (v: string, r: BankFacility) => <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      <Badge tone={v === 'block' ? 'negative' : 'warning'}>{v === 'block' ? 'Blocks' : 'Warns'}</Badge>
      {(over(r.lc_available) || over(r.loan_available)) && <Badge tone="negative">Over limit</Badge>}
      {!r.is_active && <Badge tone="neutral">Inactive</Badge>}
    </span> },
  ]
  return (
    <>
      <PageHeader title="Banks and limits" description="The credit lines each bank gives you for imports: LC limit, PAD/LTR loan limit and the default loan terms."
        actions={can('lc.edit') ? <Button variant="primary" icon="plus" onClick={() => setEditing('new')} data-testid="add-facility">Add bank limits</Button> : undefined} />
      <LcNav current="/lc/banks" />
      <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
      <section style={{ ...panel, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }} data-testid="facilities">
          <DataTable caption="Bank facilities" columns={columns} loading={q.isPending}
            rows={(q.data ?? []).map((f) => ({ ...f, terms: `${f.interest_rate_pct} % · ${f.loan_tenor_days} days · actual/${f.day_count}` }))}
            onRowClick={can('lc.edit') ? (r: BankFacility) => setEditing(r) : undefined}
            emptyState={<EmptyState icon="landmark" title="No bank limits yet" description="Add a bank's LC and loan limits to see how much of them is used." />} />
        </div>
      </section>
      <p style={{ color: 'var(--ink-muted)', fontSize: 13 }}>LC used = what is still to be paid on the bank's open LCs at their planning rates, plus open acceptances. Loans = PAD/LTR principal still owed.</p>
      {editing && <FacilityDialog facility={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function FacilityDialog({ facility, onClose }: { facility: BankFacility | null; onClose: () => void }) {
  const { Field, Input, Select, Segmented, Switch, Button } = ds()
  const toast = useToast()
  const save = useSaveBankFacility()
  const banks = useMoneyAccounts({ purpose: 'payments' })
  const facilities = useBankFacilities()
  const [v, setV] = useState({
    money_account_id: facility ? String(facility.money_account_id) : '', lc_limit: facility?.lc_limit ?? '', loan_limit: facility?.loan_limit ?? '',
    limit_action: (facility?.limit_action ?? 'warn') as 'warn' | 'block', interest_rate_pct: facility?.interest_rate_pct ?? '', day_count: (facility?.day_count ?? '360') as '360' | '365',
    loan_tenor_days: facility ? String(facility.loan_tenor_days) : '90', notes: facility?.notes ?? '', is_active: facility?.is_active ?? true,
  })
  const [version, setVersion] = useState(facility?.version ?? 0)
  const [error, setError] = useState<unknown>(null)
  const errs = fieldErrors(error)
  const set = (k: keyof typeof v, val: string | boolean) => setV((o) => ({ ...o, [k]: val }))
  const go = async () => {
    setError(null)
    try {
      const f = await save.mutateAsync({ id: facility?.id, version, input: {
        money_account_id: Number(v.money_account_id) || 0, lc_limit: v.lc_limit.trim() || '0', loan_limit: v.loan_limit.trim() || '0', limit_action: v.limit_action,
        interest_rate_pct: v.interest_rate_pct.trim() || '0', day_count: v.day_count, loan_tenor_days: Number(v.loan_tenor_days) || 0, notes: v.notes.trim() || null, is_active: v.is_active,
      } })
      toast({ tone: 'positive', title: `${f.bank_name}: limits saved`, description: `LC available ${f.lc_available == null ? 'without a limit' : taka(f.lc_available)}` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  const reload = async () => {
    const latest = (await facilities.refetch()).data?.find((f) => f.id === facility?.id)
    if (latest) { setVersion(latest.version); setError(null) }
  }
  const taken = new Set((facilities.data ?? []).filter((f) => f.id !== facility?.id).map((f) => f.money_account_id))
  return (
    <ResponsiveDialog title={facility ? `Limits — ${facility.bank_name}` : 'Add bank limits'} onClose={onClose} testId="facility-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => void go()} data-testid="save-facility">Save</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        {conflictOf(error) ? <ConflictBanner onReload={() => void reload()} loading={facilities.isFetching} /> : <ProblemBanner error={Object.keys(errs).length ? null : error} />}
        <Field label="Bank" htmlFor="fac-bank" required error={errs.money_account_id}>
          <Select id="fac-bank" value={v.money_account_id} onChange={(e) => set('money_account_id', e.target.value)} disabled={!!facility} invalid={!!errs.money_account_id}
            options={[{ value: '', label: 'Choose a bank account' }, ...(banks.data ?? []).filter((a) => ['bank', 'cash_credit'].includes(a.account_type) && !taken.has(a.id))
              .map((a) => ({ value: String(a.id), label: a.name }))]} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Field label="LC limit (৳)" htmlFor="fac-lc" error={errs.lc_limit} hint="0 = no limit">
            <Input id="fac-lc" inputMode="decimal" align="right" mono value={v.lc_limit} onChange={(e) => set('lc_limit', e.target.value)} placeholder="0.00" invalid={!!errs.lc_limit} />
          </Field>
          <Field label="PAD/LTR loan limit (৳)" htmlFor="fac-loan" error={errs.loan_limit} hint="0 = no limit">
            <Input id="fac-loan" inputMode="decimal" align="right" mono value={v.loan_limit} onChange={(e) => set('loan_limit', e.target.value)} placeholder="0.00" invalid={!!errs.loan_limit} />
          </Field>
        </div>
        <Field label="When a limit would be exceeded">
          <Segmented value={v.limit_action} onChange={(x) => set('limit_action', x)} options={[{ value: 'warn', label: 'Warn' }, { value: 'block', label: 'Block' }]} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Field label="Loan interest (% a year)" htmlFor="fac-rate" error={errs.interest_rate_pct}>
            <Input id="fac-rate" inputMode="decimal" align="right" mono value={v.interest_rate_pct} onChange={(e) => set('interest_rate_pct', e.target.value)} invalid={!!errs.interest_rate_pct} />
          </Field>
          <Field label="Loan tenor (days)" htmlFor="fac-tenor" error={errs.loan_tenor_days}>
            <Input id="fac-tenor" inputMode="numeric" align="right" mono value={v.loan_tenor_days} onChange={(e) => set('loan_tenor_days', e.target.value.replace(/\D/g, ''))} invalid={!!errs.loan_tenor_days} />
          </Field>
          <Field label="Day count"><Segmented value={v.day_count} onChange={(x) => set('day_count', x)} options={[{ value: '360', label: 'Actual/360' }, { value: '365', label: 'Actual/365' }]} /></Field>
        </div>
        <Field label="Notes" htmlFor="fac-notes" error={errs.notes}><Input id="fac-notes" value={v.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" /></Field>
        {facility && <Switch label="Active" checked={v.is_active} onChange={(c) => set('is_active', c)} />}
      </div>
    </ResponsiveDialog>
  )
}

// ---------------------------------------------------------------- PAD/LTR loans

const dueText = (l: LcLoan) => l.days_to_due == null ? shortDate(l.due_date) : `${shortDate(l.due_date)} · ${l.days_to_due < 0 ? `${-l.days_to_due} d overdue` : `${l.days_to_due} d`}`

/** LC portal: the bank's PAD/LTR loans on LC payments, with the interest due today (BR-067). */
export function LcLoans() {
  const { PageHeader, Segmented, DataTable, EmptyState, Badge, Input } = ds()
  const navigate = useNavigate()
  const { get, set, search, setSearch, page } = useListParams()
  const status = get('status', 'open')
  const list = useLcLoans({ status: status === 'all' ? undefined : status, q: search || undefined, page, per_page: 25 })
  const rows = (list.data?.data ?? []).map((l) => ({ ...l, kind: LOAN_KIND[l.loan_kind] ?? l.loan_kind, due: dueText(l) }))
  const columns: DataColumn[] = [
    { key: 'loan_number', label: 'Loan', mono: true }, { key: 'bank_name', label: 'Bank' }, { key: 'kind', label: 'Kind' },
    { key: 'principal', label: 'Principal (৳)', type: 'amount' }, { key: 'outstanding_principal', label: 'Outstanding (৳)', type: 'amount' },
    { key: 'interest_rate_pct', label: 'Rate %', align: 'right', mono: true }, { key: 'interest_due_today', label: 'Interest due (৳)', type: 'amount' },
    { key: 'due', label: 'Due' },
    { key: 'status', label: 'Status', render: (v: string) => <Badge tone={LOAN_STATUS[v]?.tone ?? 'neutral'}>{LOAN_STATUS[v]?.label ?? v}</Badge> },
  ]
  return (
    <>
      <PageHeader title="PAD/LTR loans" description="Loans the bank made to pay your LC suppliers. A loan opens when you record an LC payment as bank finance." />
      <LcNav current="/lc/loans" />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Loans" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r: LcLoan) => navigate(`/lc/loans/${r.id}`), mobileColumns: ['loan_number', 'outstanding_principal', 'due'], badgeKey: 'status',
          empty: <EmptyState icon="landmark" title="No loans" description="Record an LC payment with “Bank finance (PAD/LTR)” to open one." /> }}
        toolbar={<>
          <div style={{ width: 260 }}><Input aria-label="Search loans" icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Loan or LC number" /></div>
          <Segmented key={status} value={status} onChange={(x: string) => set({ status: x === 'open' ? null : x })}
            options={[{ value: 'open', label: 'Open' }, { value: 'repaid', label: 'Repaid' }, { value: 'all', label: 'All' }]} />
        </>}>
        <div data-testid="loans">
          <DataTable caption="Loans" columns={columns} rows={rows} loading={list.isPending} onRowClick={(r: LcLoan) => navigate(`/lc/loans/${r.id}`)} />
        </div>
      </ListCard>
    </>
  )
}

/** One loan: what is owed today, repayments, repay / convert / reverse. */
export function LcLoanDetails() {
  const { PageHeader, Button, DataTable, EmptyState, Badge } = ds()
  const id = Number(useParams().id) || 0
  const { can } = useSession()
  const q = useLcLoan(id)
  const [dialog, setDialog] = useState<'repay' | 'convert' | LcLoanRepayment | null>(null)
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this loan" back="/lc/loans" backLabel="Loans" />
  if (q.error) return <><LcNav current="/lc/loans" /><ProblemBanner error={q.error} onRetry={() => void q.refetch()} /></>
  if (!q.data) return <PageSkeleton template="detail" />
  const l = q.data
  const open = l.status === 'open'
  const latest = [...(l.repayments ?? [])].reverse().find((r) => r.status === 'posted')
  return (
    <>
      <PageHeader eyebrow={<Link to="/lc/loans">PAD/LTR loans</Link> as unknown as string} title={<span className="lf-code" data-testid="loan-number">{l.loan_number}</span>}
        description={<>{LOAN_KIND[l.loan_kind] ?? l.loan_kind} from {l.bank_name} for <Link to={`/lc/${l.letter_of_credit_id}?tab=money`}>{l.lc_number}</Link> ·
          {' '}<Badge tone={LOAN_STATUS[l.status]?.tone ?? 'neutral'}>{LOAN_STATUS[l.status]?.label ?? l.status}</Badge></>}
        actions={open ? <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {l.loan_kind === 'pad' && can('lc.edit') && <Button variant="secondary" onClick={() => setDialog('convert')} data-testid="convert-loan">Convert to LTR</Button>}
          {can('lc.create') && <Button variant="primary" onClick={() => setDialog('repay')} data-testid="repay-loan">Repay</Button>}
        </span> : undefined} />
      <LcNav current="/lc/loans" />
      <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="loan-tiles">
        <SummaryTile label="Outstanding principal" value={taka(l.outstanding_principal)} sub={`of ${taka(l.principal)}`} testId="loan-outstanding" />
        <SummaryTile label="Interest due today" value={taka(l.interest_due_today)} sub={`Since ${shortDate(l.interest_from)}${l.accrued_unpaid !== '0.00' ? ` · ${taka(l.accrued_unpaid)} accrued` : ''}`} testId="loan-interest" />
        <SummaryTile label="Rate" value={`${l.interest_rate_pct} %`} sub={`Actual/${l.day_count}${l.converted_on ? ` · LTR since ${shortDate(l.converted_on)}` : ''}`} testId="loan-rate" />
        <SummaryTile label="Due" value={shortDate(l.due_date)} sub={l.days_to_due == null ? `Started ${shortDate(l.start_date)}` : l.days_to_due < 0 ? `${-l.days_to_due} days overdue` : `in ${l.days_to_due} days`}
          tone={l.days_to_due != null && l.days_to_due < 0 ? 'negative' : undefined} testId="loan-due" />
      </div>
      <section style={{ ...panel, overflow: 'hidden' }}>
        <h2 style={{ ...h2, padding: '12px 16px 0' }}>Repayments</h2>
        <div style={{ overflowX: 'auto' }} data-testid="repayments">
          <DataTable caption="Repayments" rows={(l.repayments ?? []).map((r) => ({ ...r, date: shortDate(r.repayment_date), period: `${shortDate(r.interest_from)} · ${r.interest_days} d` }))}
            columns={[{ key: 'date', label: 'Date' }, { key: 'principal_amount', label: 'Principal (৳)', type: 'amount' }, { key: 'interest_amount', label: 'Interest (৳)', type: 'amount' },
              { key: 'accrued_cleared', label: 'Accrued paid (৳)', type: 'amount' }, { key: 'period', label: 'Interest from' }, { key: 'reference', label: 'Reference' },
              { key: 'status', label: 'Status', render: (v: string) => <Badge tone={v === 'reversed' ? 'negative' : 'positive'}>{v}</Badge> }]}
            rowActions={(r: LcLoanRepayment) => latest && r.id === latest.id && can('lc.edit')
              ? <Button size="sm" variant="ghost" onClick={() => setDialog(r)} data-testid={`reverse-repayment-${r.id}`}>Reverse</Button> : null}
            emptyState={<EmptyState icon="banknote" title="No repayments yet" description="Repay principal with the interest due to the date." />} />
        </div>
      </section>
      {dialog === 'repay' && <RepayDialog loan={l} onClose={() => setDialog(null)} />}
      {dialog === 'convert' && <ConvertDialog loan={l} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && <ReverseRepaymentDialog loan={l} repayment={dialog} onClose={() => setDialog(null)} />}
    </>
  )
}

function RepayDialog({ loan, onClose }: { loan: LcLoan; onClose: () => void }) {
  const { Field, Input, Select, Button } = ds()
  const toast = useToast()
  const repay = useRepayLoan(loan.id)
  const idem = useIdempotencyKey()
  const accounts = useMoneyAccounts({ purpose: 'payments' })
  const [date, setDate] = useState(dhakaToday())
  const [principal, setPrincipal] = useState(loan.outstanding_principal)
  const [account, setAccount] = useState(String(loan.money_account_id))
  const [reference, setReference] = useState('')
  const [error, setError] = useState<unknown>(null)
  const errs = fieldErrors(error)
  const quote = useLoanInterest(loan.id, date)
  const go = async () => {
    setError(null)
    if (!DEC.test(principal.trim())) { setError(new ApiError({ title: 'Check the amount', status: 422, code: 'validation_failed', errors: { principal_amount: ['Enter the principal repaid (0 for interest only)'] } })); return }
    try {
      const l = await repay.mutateAsync({ idempotencyKey: idem.key, input: { repayment_date: date, principal_amount: principal.trim(), money_account_id: Number(account) || 0, reference: reference.trim() || null } })
      idem.reset()
      const r = l.repayments?.[l.repayments.length - 1]
      toast({ tone: 'positive', title: l.status === 'repaid' ? `${l.loan_number} repaid in full` : `Repayment recorded on ${l.loan_number}`,
        description: r ? `Principal ${taka(r.principal_amount)} · interest ${taka(r.interest_amount)}${r.accrued_cleared !== '0.00' ? ` + accrued ${taka(r.accrued_cleared)}` : ''}` : undefined })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ResponsiveDialog title={`Repay ${loan.loan_number}`} onClose={onClose} testId="repay-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={repay.isPending} onClick={() => void go()} data-testid="save-repayment">Record repayment</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={Object.keys(errs).length ? null : error} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Field label="Repaid on" htmlFor="rep-date" required error={errs.repayment_date}><Input id="rep-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!errs.repayment_date} /></Field>
          <Field label="Principal (৳)" htmlFor="rep-principal" required error={errs.principal_amount} hint={`Outstanding ${taka(loan.outstanding_principal)}`}>
            <Input id="rep-principal" inputMode="decimal" align="right" mono value={principal} onChange={(e) => setPrincipal(e.target.value)} invalid={!!errs.principal_amount} />
          </Field>
        </div>
        <section style={{ ...panel, padding: '10px 14px' }} aria-live="polite" data-testid="repay-quote">
          {quote.error ? <ProblemBanner error={quote.error} /> : !quote.data ? <span style={{ color: 'var(--ink-muted)' }}>Working out the interest…</span> : <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Interest {quote.data.days} days at {quote.data.interest_rate_pct} % (actual/{quote.data.day_count})</span><span className="lf-num">{taka(quote.data.interest)}</span></div>
            {quote.data.accrued_unpaid !== '0.00' && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Accrued at month end, not yet paid</span><span className="lf-num">{taka(quote.data.accrued_unpaid)}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 650 }}><span>Interest paid with this repayment</span><span className="lf-num" data-testid="quote-total">{taka(quote.data.total_interest)}</span></div>
          </>}
        </section>
        <Field label="Paid from" htmlFor="rep-account" required error={errs.money_account_id}>
          <Select id="rep-account" value={account} onChange={(e) => setAccount(e.target.value)} invalid={!!errs.money_account_id}
            options={[{ value: '', label: 'Choose an account' }, ...(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))]} />
        </Field>
        <Field label="Bank reference" htmlFor="rep-ref" error={errs.reference}><Input id="rep-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></Field>
      </div>
    </ResponsiveDialog>
  )
}

function ConvertDialog({ loan, onClose }: { loan: LcLoan; onClose: () => void }) {
  const { Field, Input, Button } = ds()
  const toast = useToast()
  const convert = useConvertLoan(loan.id)
  const q = useLcLoan(loan.id)
  const [on, setOn] = useState(dhakaToday())
  const [rate, setRate] = useState(loan.interest_rate_pct)
  const [tenor, setTenor] = useState('180')
  const [notes, setNotes] = useState('')
  const [version, setVersion] = useState(loan.version)
  const [error, setError] = useState<unknown>(null)
  const errs = fieldErrors(error)
  const go = async () => {
    setError(null)
    try {
      const l = await convert.mutateAsync({ version, input: { converted_on: on, interest_rate_pct: rate.trim(), tenor_days: Number(tenor) || 0, notes: notes.trim() || null } })
      toast({ tone: 'positive', title: `${l.loan_number} is now an LTR`, description: `${l.interest_rate_pct} %, due ${shortDate(l.due_date)}. PAD interest to ${shortDate(on)} is accrued.` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ResponsiveDialog title={`Convert ${loan.loan_number} to LTR`} onClose={onClose} testId="convert-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={convert.isPending} onClick={() => void go()} data-testid="save-convert">Convert</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        {conflictOf(error) ? <ConflictBanner onReload={() => void q.refetch().then((r) => { if (r.data) { setVersion(r.data.version); setError(null) } })} loading={q.isFetching} />
          : <ProblemBanner error={Object.keys(errs).length ? null : error} />}
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>The PAD's interest up to the day before is accrued at {loan.interest_rate_pct} %; the loan then runs at the LTR rate. No money moves.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Field label="Converted on" htmlFor="cv-date" required error={errs.converted_on}><Input id="cv-date" type="date" value={on} onChange={(e) => setOn(e.target.value)} invalid={!!errs.converted_on} /></Field>
          <Field label="LTR rate (% a year)" htmlFor="cv-rate" required error={errs.interest_rate_pct}><Input id="cv-rate" inputMode="decimal" align="right" mono value={rate} onChange={(e) => setRate(e.target.value)} invalid={!!errs.interest_rate_pct} /></Field>
          <Field label="Tenor (days)" htmlFor="cv-tenor" required error={errs.tenor_days}><Input id="cv-tenor" inputMode="numeric" align="right" mono value={tenor} onChange={(e) => setTenor(e.target.value.replace(/\D/g, ''))} invalid={!!errs.tenor_days} /></Field>
        </div>
        <Field label="Notes" htmlFor="cv-notes" error={errs.notes}><Input id="cv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. the bank's LTR reference" /></Field>
      </div>
    </ResponsiveDialog>
  )
}

function ReverseRepaymentDialog({ loan, repayment, onClose }: { loan: LcLoan; repayment: LcLoanRepayment; onClose: () => void }) {
  const toast = useToast()
  const rev = useReverseRepayment()
  const idem = useIdempotencyKey()
  return (
    <ReasonDialog title={`Reverse the ${shortDate(repayment.repayment_date)} repayment?`} confirmLabel="Reverse" loading={rev.isPending} onClose={onClose}
      description="A reversing entry is posted today. The principal, any accrued interest it paid and the interest date come back on the loan."
      onConfirm={async (reason) => {
        await rev.mutateAsync({ id: repayment.id, reason, idempotencyKey: idem.key })
        idem.reset()
        toast({ tone: 'positive', title: 'Repayment reversed', description: `${loan.loan_number} is open again.` })
        onClose()
      }} />
  )
}

// ---------------------------------------------------------------- FX revaluation

/** LC portal: restate open foreign bills and acceptances at closing rates; reversed automatically the next day (BR-068). */
export function LcFxRevaluation() {
  const { PageHeader, Button, Field, Input, DataTable, EmptyState, Badge, Banner } = ds()
  const { can } = useSession()
  const toast = useToast()
  const { preview, post, reverse } = useFxRevaluation()
  const idem = useIdempotencyKey()
  const { set, page } = useListParams()
  const history = useFxRevaluations({ page, per_page: 10 })
  const [date, setDate] = useState(dhakaToday())
  const [rates, setRates] = useState([{ currency_code: 'USD', rate: '' }])
  const [result, setResult] = useState<FxRevaluation | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [reversing, setReversing] = useState<FxRevaluation | null>(null)
  const errs = fieldErrors(error)
  const input = () => ({ revaluation_date: date, rates: rates.filter((r) => r.currency_code.trim()).map((r) => ({ currency_code: r.currency_code.trim().toUpperCase(), rate: r.rate.trim() })) })
  const run = async () => {
    setError(null); setResult(null)
    try { setResult(await preview.mutateAsync(input())) } catch (e) { setError(e) }
  }
  const doPost = async () => {
    setError(null)
    try {
      const r = await post.mutateAsync({ input: input(), idempotencyKey: idem.key })
      idem.reset()
      setResult(null)
      toast({ tone: 'positive', title: `Revaluation of ${shortDate(r.revaluation_date)} posted`, description: `Difference ${taka(r.total_difference)}; reversed on ${shortDate(r.reversal_date)}.` })
    } catch (e) {
      setError(e)
    }
  }
  const lineRows = ((result?.lines ?? []) as unknown as FxLine[]).map((l, i) => ({ ...l, id: i, what: l.source === 'purchase_bill' ? 'Bill' : 'Acceptance', fc: `${l.currency_code} ${l.foreign_outstanding}` }))
  return (
    <>
      <PageHeader title="FX revaluation" description="At a month or year end, restate open foreign-currency bills and LC acceptances at the closing rate. The unrealised gain or loss is reversed the next day." />
      <LcNav current="/lc/fx-revaluation" />
      <section style={{ ...card, marginBottom: 16 }} aria-label="Closing rates">
        <h2 style={h2}>Closing rates</h2>
        <ProblemBanner error={Object.keys(errs).length ? null : error} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ width: 180 }}><Field label="Revaluation date" htmlFor="fx-date" required error={errs.revaluation_date}><Input id="fx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!errs.revaluation_date} /></Field></div>
          {rates.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ width: 90 }}><Field label="Currency" htmlFor={`fx-cur-${i}`} error={errs[`rates.${i}.currency_code`]}>
                <Input id={`fx-cur-${i}`} maxLength={3} value={r.currency_code} onChange={(e) => setRates((o) => o.map((x, j) => j === i ? { ...x, currency_code: e.target.value } : x))} /></Field></div>
              <div style={{ width: 150 }}><Field label="Closing rate (৳)" htmlFor={`fx-rate-${i}`} error={errs[`rates.${i}.rate`]}>
                <Input id={`fx-rate-${i}`} inputMode="decimal" align="right" mono value={r.rate} onChange={(e) => setRates((o) => o.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))} /></Field></div>
            </div>
          ))}
          <Button variant="ghost" icon="plus" onClick={() => setRates((o) => [...o, { currency_code: '', rate: '' }])}>Add currency</Button>
          <Button variant="secondary" loading={preview.isPending} onClick={() => void run()} data-testid="fx-preview">Preview</Button>
        </div>
      </section>
      {result && (
        <section style={{ ...card, marginBottom: 16 }} aria-label="Preview" data-testid="fx-result">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <h2 style={{ ...h2, margin: 0 }}>Open items on {shortDate(result.revaluation_date)}</h2>
            <span>Total difference <strong className="lf-num" data-testid="fx-total">{taka(result.total_difference)}</strong> <span style={{ color: 'var(--ink-muted)' }}>(positive = loss)</span></span>
          </div>
          {(result.warnings ?? []).map((w) => <Banner key={w.code} tone="warning" title={w.message} />)}
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <DataTable caption="Revalued items" rows={lineRows}
              columns={[{ key: 'what', label: 'Item' }, { key: 'reference', label: 'Reference', mono: true }, { key: 'party_name', label: 'Supplier' }, { key: 'fc', label: 'Foreign open', align: 'right', mono: true },
                { key: 'book_rate', label: 'Book rate', align: 'right', mono: true }, { key: 'closing_rate', label: 'Closing rate', align: 'right', mono: true },
                { key: 'difference', label: 'Difference (৳)', type: 'amount' }]} />
          </div>
          {(result.journal ?? []).length > 0 && <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <DataTable caption="Journal" rows={(result.journal ?? []).map((j, i) => ({ ...j, id: i }))}
              columns={[{ key: 'ledger_code', label: 'Code', mono: true }, { key: 'ledger_name', label: 'Ledger' }, { key: 'debit', label: 'Debit (৳)', type: 'amount' }, { key: 'credit', label: 'Credit (৳)', type: 'amount' }]} />
          </div>}
          <p style={{ color: 'var(--ink-muted)', fontSize: 13 }}>Posting books this on {shortDate(result.revaluation_date)} and its reversal on {shortDate(result.reversal_date)}, so payments keep their real exchange difference.</p>
          {can('accounting.create') && (result.journal ?? []).length > 0 && <Button variant="primary" loading={post.isPending} onClick={() => void doPost()} data-testid="fx-post">Post revaluation</Button>}
        </section>
      )}
      <section style={{ ...panel, overflow: 'hidden' }} aria-label="History">
        <h2 style={{ ...h2, padding: '12px 16px 0' }}>Revaluations</h2>
        <ProblemBanner error={history.error} onRetry={() => void history.refetch()} />
        <ListCard label="Revaluations" meta={history.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
          cards={{ columns: [], rows: [], loading: history.isPending, empty: null }}>
          <div data-testid="fx-history">
            <DataTable caption="Revaluations" loading={history.isPending}
              rows={(history.data?.data ?? []).map((r) => ({ ...r, date: shortDate(r.revaluation_date), back: shortDate(r.reversal_date),
                rateText: Object.entries(r.rates as Record<string, string>).map(([k, v]) => `${k} ${v}`).join(', '), items: r.lines.length }))}
              columns={[{ key: 'date', label: 'Date' }, { key: 'rateText', label: 'Closing rates' }, { key: 'items', label: 'Items', align: 'right' },
                { key: 'total_difference', label: 'Difference (৳)', type: 'amount' }, { key: 'back', label: 'Reversed on' },
                { key: 'status', label: 'Status', render: (v: string) => <Badge tone={v === 'reversed' ? 'negative' : 'positive'}>{v}</Badge> }]}
              rowActions={(r: FxRevaluation) => r.status === 'posted' && can('accounting.edit') ? <Button size="sm" variant="ghost" onClick={() => setReversing(r)}>Reverse</Button> : null}
              emptyState={<EmptyState icon="refresh-cw" title="No revaluations yet" description="Preview one above at a month end." />} />
          </div>
        </ListCard>
      </section>
      {reversing && <ReasonDialog title={`Reverse the revaluation of ${shortDate(reversing.revaluation_date)}?`} confirmLabel="Reverse" loading={reverse.isPending}
        description="Both of its entries are cancelled on their own dates, for example when a wrong closing rate was used." onClose={() => setReversing(null)}
        onConfirm={async (reason) => {
          await reverse.mutateAsync({ id: reversing.id ?? 0, reason, idempotencyKey: idem.key })
          idem.reset()
          toast({ tone: 'positive', title: 'Revaluation reversed' })
          setReversing(null)
        }} />}
    </>
  )
}
