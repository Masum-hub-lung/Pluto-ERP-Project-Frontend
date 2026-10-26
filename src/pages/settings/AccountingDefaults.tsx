import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import type { AccountMapping } from '../../api/contract.gen'
import { useAccountMappings, useAccountTree, useLedgerList, useSaveMappings } from '../../api/accounting'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden } from '../../components/states'
import { flattenGroups } from '../accounting/ChartOfAccounts'
import { SettingsLayout } from './SettingsLayout'

/**
 * K16 Accounting defaults (backlog P7.2-FE-10; 06 §3): which ledger or group each automatic posting uses — cost of
 * goods sold, rounding, bank charges, the parents of new customer and supplier ledgers… Each picker lists only
 * accounts of the nature the role needs; the server checks again (TC-ACC-024) and names the row it refuses.
 */
const label = (k: string) => k.replace(/_group$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export function AccountingDefaults() {
  const { can } = useSession()
  if (!can('accounting.view')) return <Forbidden permission="accounting.view" what="accounting defaults" />
  return <Defaults />
}

function Defaults() {
  const { Card, Select, Button, Skeleton, Banner } = ds()
  const { can } = useSession()
  const toast = useToast()
  const q = useAccountMappings()
  const tree = useAccountTree({ with_ledgers: 'false' })
  const ledgers = useLedgerList({ per_page: 100, sort: 'code' })
  const save = useSaveMappings()
  const [rows, setRows] = useState<AccountMapping[]>([])
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (q.data) setRows(q.data) }, [q.data])
  const dirty = !!q.data && JSON.stringify(rows) !== JSON.stringify(q.data)
  const guard = useUnsavedChangesBlocker(dirty, 'Your changes to the accounting defaults are not saved.')
  const editable = can('settings.edit')
  const groups = flattenGroups(tree.data?.nodes ?? [])
  const fe = error instanceof ApiError && error.status === 422 ? error.fieldErrors : {}
  const rowError = (i: number) => fe[`mappings.${i}.ledger_id`]?.[0] ?? fe[`mappings.${i}.account_group_id`]?.[0] ?? fe[`mappings.${i}.mapping_key`]?.[0]

  const submit = async () => {
    setError(null)
    try {
      const changed = rows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(q.data?.[i]))
      await save.mutateAsync(rows) // every row, so 422 `mappings.N` matches the row on screen; unchanged roles are not touched or audited
      toast({ tone: 'positive', title: 'Accounting defaults saved', description: `${changed.length} posting ${changed.length === 1 ? 'role' : 'roles'} changed` })
    } catch (e) { setError(e) }
  }

  return (
    <SettingsLayout current="Accounting defaults" eyebrow="Settings · Business" title="Accounting defaults" description="The ledgers and groups automatic postings use.">
      {!(error instanceof ApiError && error.status === 422 && Object.keys(fe).length) && <ProblemBanner error={error} />}
      <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
      {!editable && <Banner tone="info">Only roles with settings.edit can change these.</Banner>}
      <Card padding="none">
        {q.isPending && <div style={{ padding: 16 }}><Skeleton height={240} /></div>}
        {rows.map((r, i) => {
          const isGroup = r.required_nature.endsWith(' group')
          const natures = r.required_nature.replace(/ group$/, '').split(' or ')
          const options = isGroup
            ? groups.filter((g) => natures.includes(g.nature)).map((g) => ({ value: String(g.id), label: g.label }))
            : (ledgers.data?.data ?? []).filter((l) => natures.includes(l.nature)).map((l) => ({ value: String(l.id), label: `${l.code} · ${l.name}` }))
          const value = String((isGroup ? r.account_group_id : r.ledger_id) ?? '')
          return (
            <div key={r.mapping_key} data-testid={`mapping-${r.mapping_key}`}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) minmax(240px, 1.2fr)', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px' }}>
                <strong>{label(r.mapping_key)}</strong>
                <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{r.description} · needs {r.required_nature}</span>
              </span>
              <span>
                <Select aria-label={label(r.mapping_key)} value={value} disabled={!editable} invalid={!!rowError(i)}
                  onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, [isGroup ? 'account_group_id' : 'ledger_id']: e.target.value ? Number(e.target.value) : null } : x)))}
                  options={[{ value: '', label: isGroup ? 'Choose a group' : 'Choose a ledger' }, ...options]} />
                {rowError(i) && <span role="alert" style={{ color: 'var(--negative)', fontSize: 13 }}>{rowError(i)}</span>}
              </span>
            </div>
          )
        })}
      </Card>
      {editable && dirty && (
        <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, padding: '12px 0', background: 'var(--surface)', borderTop: '1px solid var(--line)',
          display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => { setRows(q.data ?? []); setError(null) }}>Discard</Button>
          <Button variant="primary" icon="check" loading={save.isPending} onClick={() => void submit()} data-testid="save-mappings">Save changes</Button>
        </div>
      )}
      {guard.dialog}
    </SettingsLayout>
  )
}
