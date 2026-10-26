import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { AccountNode } from '../../api/contract.gen'
import { useAccountTree, useCreateGroup } from '../../api/accounting'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { DrCr, natureLabel } from './common'

/**
 * H2 Chart of accounts (Acc-COA.dc.html; backlog P7.2-FE-02): the five primary groups with their groups and ledgers,
 * each with its balance from the API, expand/collapse, groups only, zero balances, a search that keeps the path to a
 * match, and the trial-balance check in the footer. New group opens a dialog; New ledger goes to H4.
 */
export function ChartOfAccounts() {
  const { PageHeader, Button, Card, Input, Switch, Banner, Badge, Skeleton, EmptyState } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const [zero, setZero] = useState(true)
  const [groupsOnly, setGroupsOnly] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [all, setAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const tree = useAccountTree({ zero: zero ? 'true' : 'false', with_ledgers: groupsOnly ? 'false' : 'true' })
  const nodes = useMemo(() => filterTree(tree.data?.nodes ?? [], q.trim().toLowerCase()), [tree.data, q])
  const searching = q.trim() !== ''
  const key = (n: AccountNode) => `${n.kind}-${n.id}`
  const toggle = (n: AccountNode) => setOpen((s) => { const c = new Set(s); if (c.has(key(n))) c.delete(key(n)); else c.add(key(n)); return c })

  const rows: Array<{ n: AccountNode; depth: number }> = []
  const walk = (list: AccountNode[], depth: number) => {
    for (const n of list) {
      rows.push({ n, depth })
      if (n.children?.length && (all || searching || open.has(key(n)))) walk(n.children, depth + 1)
    }
  }
  walk(nodes, 0)

  return (
    <>
      <PageHeader eyebrow="Accounting" title="Chart of accounts" description="Groups and ledgers with their balances in the books."
        actions={<>
          {can('accounting.create') && <Button variant="secondary" icon="plus" onClick={() => setAdding(true)} data-testid="new-group">New group</Button>}
          {can('accounting.create') && <Button variant="primary" icon="plus" onClick={() => navigate('/accounting/ledgers/new')} data-testid="new-ledger">New ledger</Button>}
        </>} />
      <ProblemBanner error={tree.error} onRetry={() => void tree.refetch()} />
      <Card padding="none">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: '1 1 220px', maxWidth: 360 }}><Input icon="search" placeholder="Find account by code or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find account" /></div>
          <Button variant="ghost" size="sm" icon="chevrons-up-down" onClick={() => setAll((a) => !a)} data-testid="expand-all">{all ? 'Collapse all' : 'Expand all'}</Button>
          <Switch label="Groups only" checked={groupsOnly} onChange={setGroupsOnly} />
          <Switch label="Show zero balances" checked={zero} onChange={setZero} />
        </div>
        <div role="tree" aria-label="Chart of accounts" data-testid="coa-tree" style={{ overflowX: 'auto' }}>
          {tree.isPending && Array.from({ length: 8 }, (_, i) => <div key={i} style={{ padding: '10px 16px' }}><Skeleton height={18} /></div>)}
          {!tree.isPending && rows.length === 0 && <EmptyState icon="search" title="No accounts match" description="Try another code or name." />}
          {rows.map(({ n, depth }) => (
            <div key={key(n)} role="treeitem" aria-level={depth + 1} aria-expanded={n.children?.length ? all || searching || open.has(key(n)) : undefined}
              data-testid={`coa-${n.code}`}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 90px 100px 160px', alignItems: 'center', gap: 8, minWidth: 600,
                padding: '8px 16px', borderBottom: '1px solid var(--line)', background: n.kind === 'primary' ? 'var(--surface-sunken, var(--surface))' : undefined }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: depth * 20, minWidth: 0 }}>
                {n.children?.length
                  ? <button type="button" onClick={() => toggle(n)} aria-label={`${open.has(key(n)) ? 'Collapse' : 'Expand'} ${n.name}`}
                    style={{ border: 0, background: 'transparent', cursor: 'pointer', width: 24, height: 24, color: 'var(--ink-muted)' }}>{all || searching || open.has(key(n)) ? '▾' : '▸'}</button>
                  : <span style={{ width: 24 }} />}
                <span className="lf-code" style={{ color: 'var(--ink-muted)' }}>{n.code}</span>
                <a href={n.kind === 'ledger' ? `/accounting/ledgers/${n.id}` : `/accounting/groups/${n.id}`}
                  onClick={(e) => { e.preventDefault(); navigate(n.kind === 'ledger' ? `/accounting/ledgers/${n.id}` : `/accounting/groups/${n.id}`) }}
                  style={{ fontWeight: n.kind === 'ledger' ? 400 : 600, color: 'var(--ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</a>
                {n.note && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>· {n.note}</span>}
              </span>
              <span><Badge tone={n.kind === 'ledger' ? 'neutral' : n.kind === 'primary' ? 'brand' : 'info'}>{n.kind === 'primary' ? 'Primary' : n.kind === 'group' ? 'Group' : 'Ledger'}</Badge></span>
              <span style={{ color: 'var(--ink-muted)' }}>{natureLabel(n.nature)}</span>
              <span style={{ textAlign: 'right' }}><DrCr amount={n.balance} side={n.balance_side} /></span>
            </div>
          ))}
        </div>
        {tree.data && (
          <div style={{ padding: '12px 16px' }} data-testid="coa-check">
            <Banner tone={tree.data.balanced ? 'positive' : 'negative'} title={tree.data.balanced ? 'The books balance' : 'The books do not balance'}>
              Debit balances {formatTaka(tree.data.total_debit, { symbol: true })} · credit balances {formatTaka(tree.data.total_credit, { symbol: true })} as of {tree.data.as_of}
            </Banner>
          </div>
        )}
      </Card>
      {adding && <GroupDialog onClose={() => setAdding(false)} groups={flattenGroups(tree.data?.nodes ?? [])} />}
    </>
  )
}

/** Keeps nodes whose code or name matches, and the groups on the way to them. */
function filterTree(nodes: AccountNode[], q: string): AccountNode[] {
  if (!q) return nodes
  const out: AccountNode[] = []
  for (const n of nodes) {
    const kids = filterTree(n.children ?? [], q)
    if (n.code.toLowerCase().includes(q) || n.name.toLowerCase().includes(q) || kids.length) out.push({ ...n, children: kids.length ? kids : n.children?.filter(() => false) })
  }
  return out
}

export function flattenGroups(nodes: AccountNode[], depth = 0): Array<{ id: number; label: string; nature: string }> {
  return nodes.filter((n) => n.kind !== 'ledger').flatMap((n) => [
    { id: n.id, label: `${'  '.repeat(depth)}${n.code} · ${n.name}`, nature: n.nature }, ...flattenGroups(n.children ?? [], depth + 1)])
}

/** "New group" (H2): code, name and the parent; nature comes from the parent. */
function GroupDialog({ onClose, groups }: { onClose: () => void; groups: Array<{ id: number; label: string; nature: string }> }) {
  const { Field, Input, Select, Button, Switch } = ds()
  const toast = useToast()
  const create = useCreateGroup()
  const [v, setV] = useState({ code: '', name: '', parent_id: '', used_in_cash_vouchers: false })
  const [error, setError] = useState<unknown>(null)
  const fe = error instanceof ApiError && error.status === 422 ? error.fieldErrors : {}
  const parent = groups.find((g) => String(g.id) === v.parent_id)
  const save = async () => {
    setError(null)
    try {
      const g = await create.mutateAsync({ code: v.code.trim(), name: v.name.trim(), parent_id: Number(v.parent_id), used_in_cash_vouchers: v.used_in_cash_vouchers })
      toast({ tone: 'positive', title: `Group ${g.code} · ${g.name} added`, description: `${natureLabel(g.nature)} group` })
      onClose()
    } catch (e) { setError(e) }
  }
  return (
    <ResponsiveDialog title="New group" description="A group collects ledgers of one nature. Its nature follows the group it sits under." onClose={onClose} testId="group-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} onClick={() => void save()} data-testid="save-group">Add group</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!(error instanceof ApiError && error.status === 422) && <ProblemBanner error={error} />}
        <Field label="Under" required error={fe.parent_id?.[0]} htmlFor="g-parent">
          <Select id="g-parent" value={v.parent_id} onChange={(e) => setV({ ...v, parent_id: e.target.value })}
            options={[{ value: '', label: 'Choose the parent group' }, ...groups.map((g) => ({ value: String(g.id), label: g.label }))]} />
        </Field>
        <Field label="Code" required hint="Up to 20 letters or digits, unique" error={fe.code?.[0]} htmlFor="g-code"><Input id="g-code" mono value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label="Name" required error={fe.name?.[0]} htmlFor="g-name"><Input id="g-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Nature"><Input value={parent ? natureLabel(parent.nature) : '—'} readOnly aria-label="Nature" /></Field>
        <Switch label="Its ledgers appear in payment and receipt vouchers" checked={v.used_in_cash_vouchers} onChange={(c) => setV({ ...v, used_in_cash_vouchers: c })} />
      </div>
    </ResponsiveDialog>
  )
}
