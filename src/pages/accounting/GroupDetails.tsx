import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { AccountGroup } from '../../api/contract.gen'
import { useAccountGroup, useAccountTree, useUpdateGroup } from '../../api/accounting'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { ConflictBanner } from '../../components/ConflictBanner'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { SummaryTile } from '../../components/SummaryTile'
import { NotFound } from '../../components/states'
import { flattenGroups } from './ChartOfAccounts'
import { DrCr, drCrText, natureLabel } from './common'

/**
 * H3 Account group (Acc-Group.dc.html; backlog P7.2-FE-02): the group's balance, its sub-groups and ledgers with
 * their balances, and its settings. Built-in groups are read-only; groups you added can be renamed, given another
 * code or moved under another group of the same nature (BR-027).
 */
export function GroupDetails() {
  const id = Number(useParams().id)
  const q = useAccountGroup(id)
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this group" back="/accounting/chart" backLabel="Chart of accounts" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  return <Details g={q.data} />
}

function Details({ g }: { g: AccountGroup }) {
  const { PageHeader, Button, Card, DataTable, Badge, EmptyState } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const [editing, setEditing] = useState(false)
  const children = g.children ?? []
  const ledgers = children.filter((c) => c.kind === 'ledger')
  const cols: DataColumn[] = [
    { key: 'code', label: 'Code', mono: true },
    { key: 'name', label: 'Account' },
    { key: 'kind', label: 'Kind', render: (v) => <Badge tone={v === 'ledger' ? 'neutral' : 'info'}>{v === 'ledger' ? 'Ledger' : 'Group'}</Badge> },
    { key: 'balance', label: 'Balance (৳)', align: 'right', render: (_v, r) => <DrCr amount={r.amount} side={r.side} /> },
  ]
  const rows = children.map((c) => ({ id: `${c.kind}-${c.id}`, nodeId: c.id, kind: c.kind, code: c.code, name: c.name, amount: c.balance, side: c.balance_side }))
  const open = (r: { kind: string; nodeId: number }) => navigate(r.kind === 'ledger' ? `/accounting/ledgers/${r.nodeId}` : `/accounting/groups/${r.nodeId}`)

  return (
    <>
      <PageHeader eyebrow={`Account group · ${natureLabel(g.nature)}`} title={<span data-testid="group-title">{g.code} · {g.name}</span>}
        description={g.is_system ? 'A built-in group. Add sub-groups or ledgers under it.' : 'A group you added.'}
        actions={<>
          <Button variant="ghost" icon="chevron-left" onClick={() => navigate('/accounting/chart')}>Chart of accounts</Button>
          {can('accounting.create') && <Button variant="secondary" icon="plus" onClick={() => navigate(`/accounting/ledgers/new?group=${g.id}`)}>New ledger here</Button>}
          {can('accounting.edit') && !g.is_system && <Button variant="primary" icon="pencil" onClick={() => setEditing(true)} data-testid="edit-group">Edit group</Button>}
        </>} />
      <div className="lf-grid">
        <SummaryTile label="Balance" testId="group-balance" value={drCrText(g.balance, g.balance_side ?? 'dr')} sub={`Normal balance: ${g.normal_balance}`} />
        <SummaryTile label="Ledgers" value={String(ledgers.length)} sub={`${children.length - ledgers.length} sub-groups`} />
        <SummaryTile label="Report" value={g.report_section === 'profit_and_loss' ? 'Profit and loss' : 'Balance sheet'} sub={g.cash_flow_category ? `Cash flow: ${g.cash_flow_category}` : 'No cash-flow class'} />
        <SummaryTile label="Cash vouchers" value={g.used_in_cash_vouchers ? 'Shown' : 'Hidden'} sub="In payment and receipt vouchers" />
      </div>
      <div style={{ height: 16 }} />
      <Card title="Accounts in this group" padding="none">
        {rows.length
          ? <div style={{ overflowX: 'auto' }}><DataTable caption="Accounts in this group" columns={cols} rows={rows} onRowClick={open} /></div>
          : <EmptyState icon="list-tree" title="Nothing in this group yet" description="Add a ledger or a sub-group under it." />}
      </Card>
      {editing && <EditGroupDialog g={g} onClose={() => setEditing(false)} />}
    </>
  )
}

function EditGroupDialog({ g, onClose }: { g: AccountGroup; onClose: () => void }) {
  const { Field, Input, Select, Button, Switch } = ds()
  const toast = useToast()
  const tree = useAccountTree({ with_ledgers: 'false' })
  const update = useUpdateGroup(g.id)
  const [v, setV] = useState({ code: g.code, name: g.name, parent_id: String(g.parent_id ?? ''), sort_order: String(g.sort_order ?? 0), used_in_cash_vouchers: !!g.used_in_cash_vouchers })
  const [error, setError] = useState<unknown>(null)
  const fe = error instanceof ApiError && error.status === 422 ? error.fieldErrors : {}
  const parents = flattenGroups(tree.data?.nodes ?? []).filter((p) => p.nature === g.nature && p.id !== g.id)
  const conflict = error instanceof ApiError && error.status === 409
  const save = async () => {
    setError(null)
    try {
      await update.mutateAsync({ version: g.version, input: { code: v.code.trim(), name: v.name.trim(), parent_id: Number(v.parent_id), sort_order: Number(v.sort_order) || 0,
        used_in_cash_vouchers: v.used_in_cash_vouchers } })
      toast({ tone: 'positive', title: `${v.name.trim()} saved` })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title={`Edit ${g.name}`} description={`It stays a ${g.nature} group; it can move only under another ${g.nature} group.`} onClose={onClose} testId="edit-group-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={update.isPending} onClick={() => void save()} data-testid="save-group">Save</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {conflict && <ConflictBanner onReload={onClose} />}
        {!conflict && !(error instanceof ApiError && error.status === 422 && Object.keys(fe).length) && <ProblemBanner error={error} />}
        <Field label="Code" required error={fe.code?.[0]} htmlFor="eg-code"><Input id="eg-code" mono value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label="Name" required error={fe.name?.[0]} htmlFor="eg-name"><Input id="eg-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Under" error={fe.parent_id?.[0]} htmlFor="eg-parent">
          <Select id="eg-parent" value={v.parent_id} onChange={(e) => setV({ ...v, parent_id: e.target.value })} options={parents.map((p) => ({ value: String(p.id), label: p.label }))} />
        </Field>
        <Field label="Order" hint="Lower numbers come first" error={fe.sort_order?.[0]} htmlFor="eg-order"><Input id="eg-order" inputMode="numeric" value={v.sort_order} onChange={(e) => setV({ ...v, sort_order: e.target.value })} /></Field>
        <Switch label="Its ledgers appear in payment and receipt vouchers" checked={v.used_in_cash_vouchers} onChange={(c) => setV({ ...v, used_in_cash_vouchers: c })} />
      </div>
    </ResponsiveDialog>
  )
}
