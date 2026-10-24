import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { Lookup, LookupInput } from '../../api/contract.gen'
import { useTree, useTreeMutations, useUnits, type TreeKind } from '../../api/inventory'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { DeleteDialog } from '../../components/DeleteDialog'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'

/**
 * The two inventory trees (backlog P3.2-FE-03/04): D5 product categories (two levels, code prefix, default unit) and
 * D6 stock groups (any depth). The API returns the tree flattened parent-first; rows are indented by depth. Add and
 * edit share one dialog; delete asks for the name (L7) and shows the server's reason when the node is still used.
 */
export interface TreeConfig {
  kind: TreeKind
  title: string
  description: string
  noun: string // "category"
  icon: string
  emptyText: string
  /** D5: top-level parents only, code prefix and default unit. */
  categories?: boolean
}

export function TreePage({ config }: { config: TreeConfig }) {
  const { PageHeader, Button, DataTable, EmptyState, IconButton } = ds()
  const { can } = useSession()
  const tree = useTree(config.kind)
  const [editing, setEditing] = useState<Lookup | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Lookup | null>(null)
  const nodes = tree.data ?? []
  const depth = depths(nodes)
  const costs = can('inventory.view_costs')

  const rows = nodes.map((n) => ({ id: n.id, name: n.name, depth: depth.get(n.id) ?? 0, prefix: n.code_prefix ?? '—', items: n.items_count ?? 0,
    value: n.stock_value ? formatTaka(n.stock_value) : '—', node: n }))
  const columns: DataColumn[] = [
    { key: 'name', label: config.noun === 'category' ? 'Category' : 'Stock group', render: (_v, r) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: r.depth * 24, fontWeight: r.depth === 0 ? 600 : 450 }}>
        {r.depth > 0 && <span aria-hidden style={{ color: 'var(--ink-faint)' }}>└</span>}{r.name}
      </span>) },
    ...(config.categories ? [{ key: 'prefix', label: 'Code prefix', mono: true }] : []),
    { key: 'items', label: 'Items', align: 'right' as const },
    ...(costs ? [{ key: 'value', label: 'Stock value (৳)', align: 'right' as const, mono: true }] : []),
  ]
  const addButton = (testId: string) => can('inventory.create')
    ? <Button variant="primary" icon="plus" onClick={() => setEditing('new')} data-testid={testId}>New {config.noun}</Button> : undefined
  const add = addButton(`new-${config.kind}`)
  const empty = <EmptyState icon={config.icon} title={`No ${config.noun === 'category' ? 'categories' : 'stock groups'} yet`} description={config.emptyText}
    action={addButton(`empty-new-${config.kind}`)} />
  const rowActions = can('inventory.edit') || can('inventory.delete') ? (r: { node: Lookup; name: string }) => (
    <span style={{ display: 'flex', gap: 4 }}>
      {can('inventory.edit') && <IconButton icon="pencil" label={`Edit ${r.name}`} size="sm" onClick={(e) => { e.stopPropagation(); setEditing(r.node) }} />}
      {can('inventory.delete') && <IconButton icon="trash-2" label={`Delete ${r.name}`} size="sm" onClick={(e) => { e.stopPropagation(); setDeleting(r.node) }} />}
    </span>) : undefined

  return (
    <>
      <PageHeader title={config.title} description={config.description} actions={add} />
      <ProblemBanner error={tree.error} onRetry={() => void tree.refetch()} />
      <ListCard label={config.title} cards={{ columns, rows, loading: tree.isPending, mobileColumns: ['name', 'items'],
        onOpen: can('inventory.edit') ? (r) => setEditing(r.node) : undefined, empty }}>
        <DataTable caption={config.title} columns={columns} rows={rows} loading={tree.isPending} rowActions={rowActions}
          onRowClick={can('inventory.edit') ? (r) => setEditing(r.node) : undefined} />
      </ListCard>
      {editing && <NodeDialog config={config} node={editing === 'new' ? null : editing} nodes={nodes} onClose={() => setEditing(null)} />}
      {deleting && <DeleteNode config={config} node={deleting} onClose={() => setDeleting(null)} />}
    </>
  )
}

/** Depth of each node from parent_id (the list is parent-first, so parents are seen before children). */
function depths(nodes: Lookup[]): Map<number, number> {
  const d = new Map<number, number>()
  for (const n of nodes) d.set(n.id, n.parent_id ? (d.get(n.parent_id) ?? 0) + 1 : 0)
  return d
}

/** Ids of the node and everything under it: they cannot become its parent. */
function subtree(nodes: Lookup[], id: number): Set<number> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const n of nodes) if (n.parent_id && out.has(n.parent_id) && !out.has(n.id)) { out.add(n.id); grew = true }
  }
  return out
}

function NodeDialog({ config, node, nodes, onClose }: { config: TreeConfig; node: Lookup | null; nodes: Lookup[]; onClose: () => void }) {
  const { Field, Input, Select, Button } = ds()
  const toast = useToast()
  const units = useUnits()
  const { create, update } = useTreeMutations(config.kind)
  const [name, setName] = useState(node?.name ?? '')
  const [parent, setParent] = useState(node?.parent_id ? String(node.parent_id) : '')
  const [prefix, setPrefix] = useState(node?.code_prefix ?? '')
  const [unit, setUnit] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<unknown>(null)
  const saving = create.isPending || update.isPending

  // Categories: only top-level ones can be parents (two levels). Stock groups: anything outside the node's subtree.
  const blocked = node ? subtree(nodes, node.id) : new Set<number>()
  const parents = nodes.filter((n) => !blocked.has(n.id) && (!config.categories || !n.parent_id))
  const parentOptions = [{ value: '', label: 'None (top level)' }, ...parents.map((n) => ({ value: String(n.id), label: n.name }))]

  async function save() {
    const local: Record<string, string> = {}
    if (!name.trim()) local.name = `Enter a ${config.noun} name`
    if (prefix.trim() && !/^[A-Za-z0-9]{2,10}$/.test(prefix.trim())) local.code_prefix = 'Use 2 to 10 letters or digits, e.g. OIL'
    setErrors(local)
    if (Object.keys(local).length) return
    setFormError(null)
    const input: LookupInput = { name: name.trim(), parent_id: parent ? Number(parent) : null }
    if (config.categories) {
      input.code_prefix = prefix.trim() ? prefix.trim().toUpperCase() : null
      if (!node || unit) input.default_unit_id = unit ? Number(unit) : null
    }
    try {
      const saved = node ? await update.mutateAsync({ id: node.id, input }) : await create.mutateAsync(input)
      toast({ tone: 'positive', title: node ? 'Changes saved' : `${saved.name} added` })
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && Object.keys(e.fieldErrors).length) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0] ?? 'Check this value'])))
      } else setFormError(e)
    }
  }

  const Noun = config.noun[0].toUpperCase() + config.noun.slice(1)
  return (
    <ResponsiveDialog title={node ? `Edit ${node.name}` : `New ${config.noun}`} width={480} onClose={onClose} testId="tree-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={saving} onClick={() => void save()} data-testid="save-node">{node ? 'Save changes' : `Add ${config.noun}`}</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ProblemBanner error={formError} />
        <Field label={`${Noun} name`} required error={errors.name} htmlFor="n-name">
          <Input id="n-name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save() } }} />
        </Field>
        <Field label={`Parent ${config.noun}`} error={errors.parent_id} hint={config.categories ? 'Top level if empty; categories have two levels' : 'Top level if empty'} htmlFor="n-parent">
          <Select id="n-parent" options={parentOptions} value={parent} onChange={(e) => setParent(e.target.value)} />
        </Field>
        {config.categories && <>
          <Field label="Code prefix" error={errors.code_prefix} hint="New product codes start with it, e.g. OIL-0001" htmlFor="n-prefix">
            <Input id="n-prefix" mono value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} invalid={!!errors.code_prefix} placeholder="OIL" />
          </Field>
          <Field label="Default unit" error={errors.default_unit_id} hint={node ? 'Leave as is to keep the current default' : 'Suggested for new products in this category'} htmlFor="n-unit">
            <Select id="n-unit" value={unit} onChange={(e) => setUnit(e.target.value)}
              options={[{ value: '', label: node ? 'Keep current' : 'None' }, ...(units.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))]} />
          </Field>
        </>}
      </div>
    </ResponsiveDialog>
  )
}

function DeleteNode({ config, node, onClose }: { config: TreeConfig; node: Lookup; onClose: () => void }) {
  const { Banner, Button } = ds()
  const toast = useToast()
  const { remove } = useTreeMutations(config.kind)
  const [blocked, setBlocked] = useState<string | null>(null)

  async function run() {
    try {
      await remove.mutateAsync(node.id)
      toast({ tone: 'positive', title: `${node.name} deleted` })
      onClose()
    } catch (e) {
      // 409 has_history: the server says what still uses it (products or sub-nodes).
      if (e instanceof ApiError && e.code === 'has_history') setBlocked(e.problem.detail ?? e.problem.title)
      else setBlocked(e instanceof ApiError ? e.problem.title : 'It could not be deleted.')
    }
  }

  if (blocked) {
    return (
      <ResponsiveDialog title={`${node.name} cannot be deleted`} tone="warning" onClose={onClose} testId="delete-blocked"
        footer={<Button variant="primary" onClick={onClose}>OK</Button>}>
        <Banner tone="warning" title="Still in use">{blocked}</Banner>
      </ResponsiveDialog>
    )
  }
  return <DeleteDialog name={node.name} what={config.noun} description={`Only an unused ${config.noun} can be deleted: no products and no sub-${config.noun === 'category' ? 'categories' : 'groups'}.`}
    loading={remove.isPending} onConfirm={() => void run()} onClose={onClose} />
}
