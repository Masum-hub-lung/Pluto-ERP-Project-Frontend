import { api } from '../../api/client'
import type { PageMeta, Party } from '../../api/contract.gen'
import { AsyncSelect } from '../AsyncSelect'

/**
 * Choose an active customer or supplier by name, code or mobile (GET /parties?type=&q=&status=active, 20 at a time).
 * `prospects` also offers customers saved as prospects (quotations, E10): every status is fetched and inactive ones dropped.
 */
export function PartyPicker({ type, value, onChange, prospects = false, ...rest }: {
  type: 'customer' | 'supplier'; prospects?: boolean; value: Party | null; onChange: (p: Party | null) => void; invalid?: boolean; disabled?: boolean; id?: string; 'aria-label'?: string
}) {
  return (
    <AsyncSelect<Party> {...rest} value={value} onChange={onChange} placeholder={`Search ${type}s by name, code or mobile`}
      search={async (q, signal) => (await api.request<{ data: Party[]; meta: PageMeta }>('GET', '/parties',
        { query: { type, q, status: prospects ? undefined : 'active', per_page: 20, sort: 'name' }, signal })).data.data.filter((p) => p.status !== 'inactive')}
      itemKey={(p) => p.id} itemLabel={(p) => `${p.name} · ${p.code}`}
      renderItem={(p) => (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px', minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>{p.name}{p.status === 'prospect' ? ' (prospect)' : ''}</span>
          <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>{[p.code, p.mobile].filter(Boolean).join(' · ')}</span>
        </span>
      )} />
  )
}
