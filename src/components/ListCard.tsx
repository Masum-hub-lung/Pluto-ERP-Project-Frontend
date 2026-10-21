import { useState, type ReactNode } from 'react'
import type { PageMeta } from '../api/contract.gen'
import { ds, type DataColumn } from '../ds'
import { PHONE, useMediaQuery } from '../lib/useMediaQuery'
import { BottomSheet } from './BottomSheet'
import './listcard.css'

/** Phone card layout for a list (P1.5-FE-03): the page's own columns and rows, shown as one card per row below 640 px. */
export interface ListCards {
  columns: DataColumn[]
  rows: Array<Record<string, unknown>>
  /** Columns on each card: the first is the card title, the rest label/value lines. Default: the first 3 columns. */
  mobileColumns?: string[]
  /** Column shown as a badge in the card's top-right corner (e.g. status). */
  badgeKey?: string
  onOpen?: (row: any) => void
  loading?: boolean
  /** Shown instead of the table/cards when there are no rows, centred in the card at every width. */
  empty?: ReactNode
}

/**
 * B1-style list card (Parties.dc.html list view): white card with a toolbar row (search, filters, sort), the table
 * and pagination from the API's `meta`. Responsive (P1.5-FE-03): below 640 px the rows become stacked cards (pass
 * `cards`), `filters` (sort and extra filters) move into a "Filters" bottom sheet and pagination is compact; between
 * 640 and 1199 px the table scrolls inside the card with its first column sticky; never a page-level sideways scroll.
 */
export function ListCard({ toolbar, filters, meta, onPage, children, label, cards }: {
  toolbar?: ReactNode; filters?: ReactNode; meta?: PageMeta; onPage?: (page: number) => void; children: ReactNode; label?: string; cards?: ListCards
}) {
  const { Pagination, Button, IconButton, Skeleton } = ds()
  const phone = useMediaQuery(PHONE)
  const [sheet, setSheet] = useState(false)
  const empty = cards && !cards.loading && cards.rows.length === 0 ? cards.empty : undefined

  let body: ReactNode = children
  if (empty) body = <div className="lf-listcard-empty">{empty}</div>
  else if (phone && cards) body = cards.loading ? <CardSkeletons Skeleton={Skeleton} /> : <CardList {...cards} />

  return (
    <section aria-label={label} className="lf-listcard">
      {(toolbar || filters) && (
        <div className="lf-listcard-toolbar">
          {toolbar}
          {filters && (phone
            ? <Button variant="secondary" icon="sliders-horizontal" onClick={() => setSheet(true)} data-testid="list-filters">Filters</Button>
            : <><span className="lf-listcard-spacer" />{filters}</>)}
        </div>
      )}
      <div className="lf-listcard-scroll">{body}</div>
      {meta && meta.total > 0 && onPage && (phone
        ? <nav className="lf-pager lf-pager-compact" aria-label="Pagination">
            <IconButton icon="chevron-left" label="Previous page" onClick={() => meta.current_page > 1 && onPage(meta.current_page - 1)} />
            <span>Page {meta.current_page} of {meta.last_page}</span>
            <IconButton icon="chevron-right" label="Next page" onClick={() => meta.current_page < meta.last_page && onPage(meta.current_page + 1)} />
          </nav>
        : <Pagination key={`${meta.current_page}-${meta.last_page}`} page={meta.current_page} pageCount={meta.last_page} total={meta.total} pageSize={meta.per_page}
            onChange={onPage} />)}
      {sheet && filters && (
        <BottomSheet title="Filters" onClose={() => setSheet(false)} testId="filters-sheet"
          footer={<Button variant="primary" block onClick={() => setSheet(false)}>Show results</Button>}>
          <div className="lf-listcard-sheet-filters">{filters}</div>
        </BottomSheet>
      )}
    </section>
  )
}

function CardList({ columns, rows, mobileColumns, badgeKey, onOpen }: ListCards) {
  const keys = mobileColumns ?? columns.slice(0, 3).map((c) => c.key)
  const byKey = new Map(columns.map((c) => [c.key, c]))
  const [titleCol, ...lineCols] = keys.map((k) => byKey.get(k)).filter((c): c is DataColumn => !!c && c.key !== badgeKey)
  const badgeCol = badgeKey ? byKey.get(badgeKey) : undefined
  return (
    <ul className="lf-cardlist">
      {rows.map((r, i) => (
        <li key={String(r.id ?? i)}>
          <div className="lf-cardrow" role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen ? () => onOpen(r) : undefined}
            onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r) } } : undefined}>
            <div className="lf-cardrow-top">
              {titleCol && <div className="lf-cardrow-title"><Cell col={titleCol} row={r} /></div>}
              {badgeCol && <div className="lf-cardrow-badge"><Cell col={badgeCol} row={r} /></div>}
            </div>
            {lineCols.length > 0 && (
              <dl className="lf-cardrow-lines">
                {lineCols.map((c) => (
                  <div key={c.key}><dt>{c.label}</dt><dd className={c.type === 'amount' ? 'is-amount' : undefined}><Cell col={c} row={r} /></dd></div>
                ))}
              </dl>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function Cell({ col, row }: { col: DataColumn; row: Record<string, unknown> }) {
  const { Amount } = ds()
  const v = row[col.key]
  if (col.render) return <>{col.render(v, row)}</>
  if (col.type === 'amount') return v == null ? null : <Amount value={v as string} decimals={2} />
  return <>{v as ReactNode}</>
}

function CardSkeletons({ Skeleton }: { Skeleton: ReturnType<typeof ds>['Skeleton'] }) {
  return (
    <ul className="lf-cardlist" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <li key={i}><div className="lf-cardrow"><Skeleton width="60%" height={16} /><div style={{ height: 10 }} /><Skeleton width="85%" /><div style={{ height: 6 }} /><Skeleton width="45%" /></div></li>
      ))}
    </ul>
  )
}
