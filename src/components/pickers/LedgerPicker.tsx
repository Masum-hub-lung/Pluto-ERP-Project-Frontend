import { api } from '../../api/client'
import type { Ledger, PageMeta } from '../../api/contract.gen'
import { AsyncSelect } from '../AsyncSelect'

export type LedgerPurpose = 'income_for_product' | 'expense_for_product' | 'purchase_for_supplier' | 'tax' | 'category'

/**
 * Choose a posting ledger by code or name (GET /ledgers). Pass the form's `purpose`: callers without
 * accounting.view must send one (R-26) and then never see balances. `nature` narrows the list further.
 */
export function LedgerPicker({ purpose, nature, value, onChange, ...rest }: {
  purpose?: LedgerPurpose; nature?: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  value: Ledger | null; onChange: (l: Ledger | null) => void; invalid?: boolean; disabled?: boolean; id?: string; 'aria-label'?: string
}) {
  return (
    <AsyncSelect<Ledger> {...rest} value={value} onChange={onChange} placeholder="Search ledgers by code or name"
      search={async (q, signal) => (await api.request<{ data: Ledger[]; meta: PageMeta }>('GET', '/ledgers',
        { query: { q, purpose, nature, per_page: 20 }, signal })).data.data}
      itemKey={(l) => l.id} itemLabel={(l) => `${l.code} · ${l.name}`}
      renderItem={(l) => (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px', minWidth: 0 }}>
          <span><span className="lf-code">{l.code}</span> · {l.name}</span>
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{l.group_path.join(' › ')}</span>
        </span>
      )} />
  )
}
