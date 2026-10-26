import { api } from '../../api/client'
import type { Ledger, PageMeta } from '../../api/contract.gen'
import { AsyncSelect } from '../AsyncSelect'

export interface PickedLedger { id: number; label: string }

/**
 * Ledger for a voucher line (H9–H11): general ledgers and, for journals, payments and receipts, the customers' and
 * suppliers' ledgers too (GET /ledgers leaves party ledgers out unless kind=party, so both are searched). Callers
 * have accounting.view or banking.*; balances are not shown here.
 */
export function VoucherLedgerPicker({ value, onChange, parties = true, ...rest }: {
  value: PickedLedger | null; onChange: (l: PickedLedger | null) => void; parties?: boolean; invalid?: boolean; id?: string; 'aria-label'?: string
}) {
  const search = async (q: string, signal: AbortSignal) => {
    const get = (kind?: string) => api.request<{ data: Ledger[]; meta: PageMeta }>('GET', '/ledgers', { query: { q, kind, per_page: 15 }, signal }).then((r) => r.data.data)
    const [general, party] = await Promise.all([get(), parties ? get('party') : Promise.resolve([] as Ledger[])])
    return [...general, ...party].map((l) => ({ id: l.id, label: `${l.code} · ${l.name}`, path: l.group_path.join(' › ') }))
  }
  return (
    <AsyncSelect<PickedLedger & { path?: string }> {...rest} value={value} onChange={onChange} placeholder="Search ledger by code or name" search={search}
      itemKey={(l) => l.id} itemLabel={(l) => l.label}
      renderItem={(l) => (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px', minWidth: 0 }}>
          <span>{l.label}</span>{l.path && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{l.path}</span>}
        </span>
      )} />
  )
}
