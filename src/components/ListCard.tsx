import type { PageMeta } from '../api/contract.gen'
import { lf } from '../ds'

/**
 * B1-style list card (Parties.dc.html list view): white card with a toolbar row (search, filters, sort), the table
 * (scrolls sideways inside the card, never the page) and pagination from the API's `meta`. P1.5 adds the phone
 * card layout here, so every list gets it.
 */
export function ListCard({ toolbar, meta, onPage, children, label }: {
  toolbar?: React.ReactNode; meta?: PageMeta; onPage?: (page: number) => void; children: React.ReactNode; label?: string
}) {
  const { Pagination } = lf()
  return (
    <section aria-label={label} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {toolbar && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>{toolbar}</div>}
      <div style={{ overflowX: 'auto' }}>{children}</div>
      {meta && meta.total > 0 && onPage && (
        <Pagination key={`${meta.current_page}-${meta.last_page}`} page={meta.current_page} pageCount={meta.last_page} total={meta.total} pageSize={meta.per_page}
          onChange={onPage} />
      )}
    </section>
  )
}
