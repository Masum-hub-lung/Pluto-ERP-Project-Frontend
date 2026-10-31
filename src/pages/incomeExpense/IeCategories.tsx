import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { IeCategory, Ledger } from '../../api/contract.gen'
import { useIeCategories, useIeOverview, useSaveCategory, type IeKind, type IePeriod } from '../../api/incomeExpense'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'
import { LedgerPicker } from '../../components/pickers/LedgerPicker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { SummaryTile } from '../../components/SummaryTile'

/**
 * I7 Categories and budgets (Exp-Cats.dc.html; backlog P13.2-FE-05): each category with its ledger, monthly budget,
 * spent, used % and status for this month or the financial year to date — all from GET /ie-categories — and the
 * totals from the overview. New and Edit open a drawer: a new ledger (under Operating expenses / Other income) or an
 * existing one of the same nature, the monthly budget and "Warn me at 90%".
 */
const STATUS: Record<string, [string, 'positive' | 'warning' | 'negative' | 'neutral']> = {
  on_track: ['On track', 'positive'], near_limit: ['Near the limit', 'warning'], over_budget: ['Over budget', 'negative'], not_used: ['Not used yet', 'neutral'], no_budget: ['No budget', 'neutral'],
}

export function IeCategories({ kind }: { kind: IeKind }) {
  const { PageHeader, Segmented, Card, Button, DataTable, EmptyState, Badge } = ds()
  const { can } = useSession()
  const { get, set } = useListParams()
  const income = kind === 'income'
  const period = (get('period') || 'this_month') as IePeriod
  const list = useIeCategories(kind, period)
  const totals = useIeOverview(kind, period)
  const t = (totals.data?.totals ?? {}) as Record<string, string | number | null>
  const [editing, setEditing] = useState<IeCategory | 'new' | null>(null)
  const canAdd = can('banking.create')
  const canEdit = can('banking.edit')
  const rows = (list.data ?? []).map((c) => ({ id: c.id, c, name: c.name, ledger: c.ledger_code, budget: c.monthly_budget ? formatTaka(c.monthly_budget) : '—', spent: c.spent,
    used: c.used_pct, status: c.status }))
  const columns: DataColumn[] = [
    { key: 'name', label: 'Category' }, { key: 'ledger', label: 'Ledger', mono: true }, { key: 'budget', label: 'Monthly budget (৳)', align: 'right', mono: true },
    { key: 'spent', label: income ? 'Received (৳)' : 'Spent (৳)', type: 'amount' },
    { key: 'used', label: 'Used', render: (v) => (v === null || v === undefined ? '—' : (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
        <span style={{ flex: 1, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }} aria-hidden>
          <span style={{ display: 'block', width: `${Math.min(100, Number(v))}%`, height: '100%', background: 'var(--accent, var(--ink))' }} />
        </span>
        <span className="lf-num">{String(v)} %</span>
      </span>)) },
    { key: 'status', label: 'Status', render: (v) => <Badge tone={STATUS[String(v)]?.[1] ?? 'neutral'} dot>{STATUS[String(v)]?.[0] ?? String(v)}</Badge> },
  ]

  return (
    <>
      <PageHeader title={income ? 'Income categories' : 'Expense categories and budgets'}
        description="Each category posts to its own ledger. Budgets are monthly and only warn; nothing is blocked."
        actions={canAdd ? <Button variant="primary" icon="plus" onClick={() => setEditing('new')} data-testid="new-category">New category</Button> : undefined} />
      <div style={{ marginBottom: 16, overflowX: 'auto' }}>
        <Segmented options={[{ value: 'this_month', label: 'This month' }, { value: 'this_year', label: 'FY to date' }]} value={period}
          onChange={(v: string) => set({ period: v === 'this_month' ? null : v })} />
      </div>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      {totals.data && (
        <div className="lf-grid" style={{ marginBottom: 16 }}>
          <SummaryTile label={income ? 'Received' : 'Spent'} value={formatTaka(String(t.value ?? '0'), { symbol: true })} testId="cat-total" />
          {!income && <SummaryTile label="Budget for the period" value={t.budget ? formatTaka(String(t.budget), { symbol: true }) : 'No budget'} sub={t.used_pct ? `${String(t.used_pct)} % used` : undefined} />}
          <SummaryTile label="Categories" value={String((list.data ?? []).length)} sub={`${(list.data ?? []).filter((c) => c.status === 'over_budget').length} over budget`} />
        </div>
      )}
      <Card padding="none">
        <div style={{ overflowX: 'auto' }} data-testid="category-table">
          <DataTable caption="Categories" columns={columns} rows={rows} loading={list.isPending} onRowClick={canEdit ? (r: { c: IeCategory }) => setEditing(r.c) : undefined}
            emptyState={<EmptyState icon="tags" title={`No ${kind} categories yet`} description="Rent, salaries, utilities, transport… each gets its own ledger."
              action={canAdd ? <Button variant="primary" onClick={() => setEditing('new')}>New category</Button> : undefined} />} />
        </div>
      </Card>
      {editing && <CategoryDrawer kind={kind} category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function CategoryDrawer({ kind, category, onClose }: { kind: IeKind; category: IeCategory | null; onClose: () => void }) {
  const { Field, Input, Segmented, Switch, Button } = ds()
  const toast = useToast()
  const save = useSaveCategory(category?.id)
  const idem = useIdempotencyKey()
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [ledgerMode, setLedgerMode] = useState<'new' | 'existing'>('new')
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [budget, setBudget] = useState(category?.monthly_budget ?? '')
  const [warn, setWarn] = useState(category ? category.warn_at_percent !== '100.0000' : true)
  const [error, setError] = useState<unknown>(null)
  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {}
  const fe = (k: string) => fieldErrors[k]?.[0]

  const submit = async () => {
    setError(null)
    try {
      const c = await save.mutateAsync({ idempotencyKey: category ? undefined : idem.key, input: {
        kind, name: name.trim(), description: description.trim() || null, monthly_budget: budget.replace(/,/g, '').trim() || null, warn_at_percent: warn ? '90' : '100',
        ...(category ? {} : ledgerMode === 'existing' ? { ledger_id: ledger?.id ?? null, create_ledger: false } : { create_ledger: true }) } })
      idem.reset()
      toast({ tone: 'positive', title: category ? `${c.name} saved` : `${c.name} added`, description: `Ledger ${c.ledger_code}` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <ResponsiveDialog title={category ? `Edit ${category.name}` : 'New category'} onClose={onClose} testId="category-drawer"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!name.trim() || (!category && ledgerMode === 'existing' && !ledger)} onClick={() => void submit()} data-testid="save-category">
          {category ? 'Save' : 'Add category'}</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={Object.keys(fieldErrors).length ? null : error} />
        <Field label="Name" required error={fe('name')} htmlFor="cat-name"><Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!fe('name')} autoFocus /></Field>
        <Field label="Description" error={fe('description')} htmlFor="cat-desc"><Input id="cat-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {category ? (
          <Field label="Ledger account"><Input value={category.ledger_code} readOnly aria-label="Ledger account" /></Field>
        ) : (
          <Field label="Ledger account" error={fe('ledger_id')}>
            <div style={{ display: 'grid', gap: 8 }}>
              <Segmented options={[{ value: 'new', label: 'New ledger' }, { value: 'existing', label: 'Existing ledger' }]} value={ledgerMode} onChange={(v: string) => setLedgerMode(v as 'new' | 'existing')} />
              {ledgerMode === 'existing'
                ? <LedgerPicker purpose="category" nature={kind} value={ledger} onChange={setLedger} invalid={!!fe('ledger_id')} aria-label="Existing ledger" />
                : <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>A ledger named after the category is made under {kind === 'expense' ? 'Operating expenses (61)' : 'Other income (42)'}.</span>}
            </div>
          </Field>
        )}
        <Field label="Monthly budget (৳)" hint="Optional; it only warns" error={fe('monthly_budget')} htmlFor="cat-budget">
          <Input id="cat-budget" mono align="right" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} invalid={!!fe('monthly_budget')} placeholder="0.00" />
        </Field>
        <Switch label="Warn me at 90%" checked={warn} onChange={setWarn} />
      </div>
    </ResponsiveDialog>
  )
}
