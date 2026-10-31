import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { IeEntry, RecurringTemplate } from '../../api/contract.gen'
import { useIeCategories, useIeEntries, useRecurringTemplates, useUpdateTemplate, type IeKind } from '../../api/incomeExpense'
import { ApiError } from '../../api/client'
import { dhakaToday } from '../../api/platform'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useListParams } from '../../lib/useListParams'
import { AttachmentUploader } from '../../components/AttachmentUploader'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ConflictBanner } from '../../components/ConflictBanner'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { shortDate } from '../purchases/BillList'

/**
 * I2 Income transactions, I5 Expense transactions (Inc-List.dc.html, Exp-List.dc.html; backlog P13.2-FE-03): posted
 * lines on the category ledgers from any voucher (GAP-16) — search, category, dates and "Missing receipt only" in the
 * URL; the filtered total from the API; a row opens its voucher, and "Attach receipt" adds files to it.
 * I10 Recurring entries (backlog P13.2-FE-05): pause or resume, edit the schedule, end (with If-Match, BR-049).
 */
export function IeList({ kind }: { kind: IeKind }) {
  const { PageHeader, Button, Input, Select, Switch, Field, DataTable, EmptyState, Badge, IconButton } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const { get, set, search, setSearch, page } = useListParams()
  const income = kind === 'income'
  const base = income ? '/income' : '/expenses'
  const categories = useIeCategories(kind)
  const missing = get('missing_receipt') === 'true'
  const list = useIeEntries({ kind, q: get('q') || undefined, category_id: Number(get('category')) || undefined, date_from: get('date_from') || undefined,
    date_to: get('date_to') || undefined, missing_receipt: missing ? 'true' : undefined, sort: get('sort') || undefined, page, per_page: 50 })
  const [attachTo, setAttachTo] = useState<IeEntry | null>(null)
  const canAttach = can('banking.edit') || can('banking.create')
  const rows = (list.data?.data ?? []).map((e) => ({ id: e.journal_line_id, entry: e, date: shortDate(e.date), number: e.voucher_number, description: e.description,
    category: e.category, account: e.account, receipt: e.has_receipt, amount: e.amount }))
  const columns: DataColumn[] = [
    { key: 'date', label: 'Date' }, { key: 'number', label: 'Number', mono: true }, { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' },
    { key: 'account', label: income ? 'Received into' : 'Paid from' },
    { key: 'receipt', label: 'Receipt', render: (v, r) => (v ? <Badge tone="positive">Attached</Badge> : canAttach
      ? <IconButton icon="paperclip" label={`Attach a receipt to ${String(r.number)}`} onClick={(ev: React.MouseEvent) => { ev.stopPropagation(); setAttachTo(r.entry as IeEntry) }} />
      : <Badge tone="warning">Missing</Badge>) },
    { key: 'amount', label: 'Amount (৳)', type: 'amount' },
  ]
  const open = (r: { entry?: unknown }) => navigate(`/accounting/vouchers/${(r.entry as IeEntry).voucher_id}`)
  const empty = list.data && list.data.meta.total === 0 && !get('q') && !get('category') && !missing && !get('date_from') && !get('date_to')

  return (
    <>
      <PageHeader title={income ? 'Income transactions' : 'Expense transactions'}
        description={income ? 'Posted lines on your income categories, whatever voucher made them.' : 'Posted lines on your expense categories, from expense entries, bills or journals.'}
        actions={can('banking.create') ? <Button variant="primary" icon="plus" onClick={() => navigate(`${base}/new`)} data-testid="add-ie">{income ? 'Add income' : 'Add expense'}</Button> : undefined} />
      <ProblemBanner error={list.error ?? categories.error} onRetry={() => void list.refetch()} />
      <ListCard label={income ? 'Income' : 'Expenses'} meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: open, mobileColumns: ['date', 'description', 'amount'], badgeKey: 'category',
          empty: empty ? <EmptyState icon={income ? 'hand-coins' : 'banknote'} title={income ? 'No income recorded yet' : 'No expenses recorded yet'}
            description="Entries, bills and journals on your categories appear here." action={can('banking.create') ? <Button variant="primary" onClick={() => navigate(`${base}/new`)}>{income ? 'Add income' : 'Add expense'}</Button> : undefined} />
            : <EmptyState icon="search" title="No matches" description="Try other filters." action={<Button variant="secondary" onClick={() => set({ q: null, category: null, missing_receipt: null, date_from: null, date_to: null })}>Clear filters</Button>} /> }}
        toolbar={<>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}><Input icon="search" placeholder="Search number, payee or description" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" /></div>
          <div style={{ width: 220 }}><Select aria-label="Category" value={get('category')} onChange={(e) => set({ category: e.target.value || null })}
            options={[{ value: '', label: 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))]} /></div>
          <Switch label="Missing receipt only" checked={missing} onChange={(c) => set({ missing_receipt: c ? 'true' : null })} />
        </>}
        filters={<>
          <Field label="From" htmlFor="ie-from"><Input id="ie-from" type="date" value={get('date_from')} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="ie-to"><Input id="ie-to" type="date" value={get('date_to')} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
          <Field label="Sort" htmlFor="ie-sort"><Select id="ie-sort" value={get('sort') || '-date'} onChange={(e) => set({ sort: e.target.value === '-date' ? null : e.target.value })}
            options={[{ value: '-date', label: 'Newest first' }, { value: 'date', label: 'Oldest first' }, { value: '-amount', label: 'Largest first' }, { value: 'amount', label: 'Smallest first' }]} /></Field>
        </>}>
        <DataTable caption={income ? 'Income transactions' : 'Expense transactions'} columns={columns} rows={rows} loading={list.isPending} onRowClick={open} />
      </ListCard>
      {list.data && list.data.meta.total > 0 && (
        <p style={{ textAlign: 'right', margin: '8px 4px 0', fontWeight: 600 }} data-testid="ie-total">
          {list.data.meta.total} line{list.data.meta.total === 1 ? '' : 's'} · Total {formatTaka(list.data.meta.total_amount, { symbol: true })}
        </p>
      )}
      {attachTo && (
        <ResponsiveDialog title={`Receipt for ${attachTo.voucher_number}`} onClose={() => setAttachTo(null)} testId="attach-dialog"
          footer={<Button variant="primary" onClick={() => setAttachTo(null)} data-testid="attach-done">Done</Button>}>
          <p style={{ marginTop: 0, color: 'var(--ink-muted)' }}>{attachTo.description} · {formatTaka(attachTo.amount, { symbol: true })}</p>
          <AttachmentUploader type="voucher" recordId={attachTo.voucher_id} testId="attach-dialog-files" />
        </ResponsiveDialog>
      )}
    </>
  )
}

const FREQ: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }

export function RecurringList() {
  const { PageHeader, Segmented, Switch, DataTable, EmptyState, Badge, Menu, IconButton, Button } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const { get, set, page } = useListParams()
  const kind = get('kind', 'all')
  const activeOnly = get('active') === 'true'
  const list = useRecurringTemplates({ kind: kind === 'all' ? undefined : kind, active: activeOnly ? 'true' : undefined, page })
  const update = useUpdateTemplate()
  const [menu, setMenu] = useState<number | null>(null)
  const [editing, setEditing] = useState<RecurringTemplate | null>(null)
  const [ending, setEnding] = useState<RecurringTemplate | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState(false)
  const canEdit = can('banking.edit')

  const change = async (t: RecurringTemplate, input: Parameters<typeof update.mutateAsync>[0]['input'], done: string) => {
    setError(null); setConflict(false)
    try {
      await update.mutateAsync({ t, input })
      toast({ tone: 'positive', title: done })
      return true
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true)
      else setError(e)
      return false
    }
  }
  const done = (t: RecurringTemplate) => t.ends_type === 'after_count' ? `${t.occurrences_done} of ${t.ends_after_count ?? '?'}` : t.ends_type === 'on_date' ? `${t.occurrences_done} · until ${shortDate(t.ends_on ?? '')}` : `${t.occurrences_done} · no end`
  const rows = (list.data?.data ?? []).map((t) => ({ id: t.id, t, kind: t.kind, description: t.description, frequency: FREQ[t.frequency] ?? t.frequency,
    next: t.is_active ? shortDate(t.next_run_on) : '—', done: done(t), amount: String(t.payload.amount ?? ''), status: t.is_active }))
  const columns: DataColumn[] = [
    { key: 'kind', label: 'Kind', render: (v) => <Badge tone={v === 'income' ? 'positive' : 'neutral'}>{String(v)[0].toUpperCase() + String(v).slice(1)}</Badge> },
    { key: 'description', label: 'Description' }, { key: 'frequency', label: 'Frequency' }, { key: 'next', label: 'Next run' }, { key: 'done', label: 'Done / ends' },
    { key: 'amount', label: 'Amount (৳)', type: 'amount' },
    { key: 'status', label: 'Status', render: (v) => <Badge tone={v ? 'positive' : 'neutral'} dot>{v ? 'Active' : 'Paused or ended'}</Badge> },
    ...(canEdit ? [{ key: 'actions', label: '', render: (_v: unknown, r: Record<string, unknown>) => {
      const t = r.t as RecurringTemplate
      return (
        <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setMenu(null) }}>
          <IconButton icon="ellipsis" label={`Actions for ${t.description}`} onClick={() => setMenu(menu === t.id ? null : t.id)} />
          {menu === t.id && <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 180, zIndex: 20 }} items={[
            { icon: t.is_active ? 'pause' : 'play', label: t.is_active ? 'Pause' : 'Resume', onClick: () => { setMenu(null); void change(t, { is_active: !t.is_active }, t.is_active ? `${t.description} paused` : `${t.description} resumed`) } },
            { icon: 'calendar', label: 'Edit schedule', onClick: () => { setMenu(null); setEditing(t) } },
            ...(t.last_entry_id ? [{ icon: 'file-text', label: 'Open the latest entry', onClick: () => navigate(`/accounting/vouchers/${t.last_entry_id}`) }] : []),
            { icon: 'square', label: 'End', onClick: () => { setMenu(null); setEnding(t) } },
          ]} />}
        </div>
      )
    } }] : []),
  ]

  return (
    <>
      <PageHeader title="Recurring entries" description="Each time one is due, a draft is made for you to check and post. Nothing posts on its own."
        actions={can('banking.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/expenses/new')}>Add expense</Button> : undefined} />
      {conflict && <ConflictBanner onReload={() => { setConflict(false); void list.refetch() }} loading={list.isFetching} />}
      <ProblemBanner error={error ?? list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Recurring entries" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, mobileColumns: ['description', 'next', 'amount'], badgeKey: 'kind',
          empty: <EmptyState icon="repeat" title="No recurring entries" description="Switch on “Recurring” when you add an income or expense." /> }}
        toolbar={<>
          <Segmented key={kind} options={[{ value: 'all', label: 'All' }, { value: 'income', label: 'Income' }, { value: 'expense', label: 'Expense' }, { value: 'journal', label: 'Journal' }]}
            value={kind} onChange={(v: string) => set({ kind: v === 'all' ? null : v })} />
          <Switch label="Active only" checked={activeOnly} onChange={(c) => set({ active: c ? 'true' : null })} />
        </>}>
        <DataTable caption="Recurring entries" columns={columns} rows={rows} loading={list.isPending} />
      </ListCard>
      {editing && <ScheduleDialog t={editing} onClose={() => setEditing(null)} onSave={async (input) => { if (await change(editing, input, 'Schedule saved')) setEditing(null) }}
        saving={update.isPending} />}
      {ending && <ConfirmDialog title={`End ${ending.description}?`} confirmLabel="End it" tone="warning" loading={update.isPending}
        description="No more drafts will be made. Drafts already made stay as they are."
        onConfirm={() => { void change(ending, { ends_type: 'on_date', ends_on: dhakaToday(), is_active: false }, `${ending.description} ended`).then((ok) => ok && setEnding(null)) }}
        onClose={() => setEnding(null)} />}
    </>
  )
}

function ScheduleDialog({ t, onClose, onSave, saving }: {
  t: RecurringTemplate; onClose: () => void; onSave: (i: { frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'; next_run_on: string; ends_type: 'never' | 'after_count' | 'on_date'; ends_after_count: number | null; ends_on: string | null }) => Promise<void>; saving: boolean
}) {
  const { Field, Input, Select, Button } = ds()
  const [frequency, setFrequency] = useState(t.frequency as 'weekly' | 'monthly' | 'quarterly' | 'yearly')
  const [next, setNext] = useState(t.next_run_on)
  const [ends, setEnds] = useState(t.ends_type as 'never' | 'after_count' | 'on_date')
  const [count, setCount] = useState(String(t.ends_after_count ?? 12))
  const [on, setOn] = useState(t.ends_on ?? '')
  return (
    <ResponsiveDialog title={`Schedule — ${t.description}`} onClose={onClose} testId="schedule-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => void onSave({ frequency, next_run_on: next, ends_type: ends, ends_after_count: ends === 'after_count' ? Number(count) || null : null, ends_on: ends === 'on_date' ? on || null : null })}
          data-testid="save-schedule">Save</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label="Repeats" htmlFor="rt-freq"><Select id="rt-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          options={Object.entries(FREQ).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Next on" htmlFor="rt-next"><Input id="rt-next" type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Ends" htmlFor="rt-ends"><Select id="rt-ends" value={ends} onChange={(e) => setEnds(e.target.value as typeof ends)}
          options={[{ value: 'never', label: 'Never' }, { value: 'after_count', label: 'After a number of times' }, { value: 'on_date', label: 'On a date' }]} /></Field>
        {ends === 'after_count' && <Field label="Times in all" htmlFor="rt-count"><Input id="rt-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} /></Field>}
        {ends === 'on_date' && <Field label="Last date" htmlFor="rt-on"><Input id="rt-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>}
      </div>
    </ResponsiveDialog>
  )
}
