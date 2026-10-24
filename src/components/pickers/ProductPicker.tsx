import { api } from '../../api/client'
import type { PageMeta, Product } from '../../api/contract.gen'
import { AsyncSelect } from '../AsyncSelect'

/** Choose an active product or service by name, code or barcode (GET /products?q=&active=true, 20 at a time), with unit and on hand. */
export function ProductPicker({ value, onChange, ...rest }: {
  value: Product | null; onChange: (p: Product | null) => void; invalid?: boolean; disabled?: boolean; id?: string; 'aria-label'?: string
}) {
  return (
    <AsyncSelect<Product> {...rest} value={value} onChange={onChange} placeholder="Search items by name, code or barcode"
      search={async (q, signal) => (await api.request<{ data: Product[]; meta: PageMeta }>('GET', '/products', { query: { q, active: 'true', per_page: 20 }, signal })).data.data}
      itemKey={(p) => p.id} itemLabel={(p) => `${p.name} · ${p.code}`}
      renderItem={(p) => (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '18px', minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>{p.name}</span>
          <span style={{ font: '450 12px/16px var(--font-mono)', color: 'var(--ink-muted)' }}>
            {p.code} · {p.unit}{p.track_stock ? ` · ${p.on_hand ?? '0.000'} on hand` : ' · service'}
          </span>
        </span>
      )} />
  )
}
