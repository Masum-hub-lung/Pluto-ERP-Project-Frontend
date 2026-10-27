import type { ReactNode } from 'react'
import type { ReportColumn, ReportData } from '../../api/contract.gen'
import { rowsOf, type ReportRow } from '../../api/reports'
import { formatTaka } from '../../lib/format'

/**
 * The paper statement of a ReportData (backlog P9.2-FE-01): the API's columns and rows, indented by `depth`, with
 * headings, subtotals and totals in bold and the totals row last. Amount cells show the API's decimal string through
 * formatTaka (a negative stays negative, in brackets); nothing is added up here. A row with `ledger_id` drills into
 * the ledger (H7) when `onOpen` is given. The table scrolls inside its card on narrow screens.
 */
const STRONG = new Set(['heading', 'subtotal', 'total', 'closing'])

export function StatementTable({ report, onOpen, cell, totalsLabel = 'Total', testId }: {
  report: ReportData
  onOpen?: (row: ReportRow) => void
  /** Custom rendering of one cell; return undefined to fall back to the default. */
  cell?: (column: ReportColumn, row: ReportRow) => ReactNode | undefined
  totalsLabel?: string
  testId?: string
}) {
  const columns = report.columns
  const rows = rowsOf(report)
  const labelKey = columns.find((c) => c.type === 'text')?.key
  const totals = report.totals as Record<string, unknown> | null | undefined
  const showTotals = !!totals && columns.some((c, i) => i > 0 && typeof totals[c.key] === 'string')

  if (rows.length === 0) return <p className="lf-report-empty">No data for this period.</p>

  return (
    <div className="lf-report-scroll">
      <table className="lf-statement" data-testid={testId}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={numeric(c) ? 'num' : undefined} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const open = onOpen && (r.ledger_id || r.party_id) && (r.kind === 'ledger' || r.kind === 'party' || r.kind === 'heading') ? () => onOpen(r) : undefined
            return (
              <tr key={`${r.key ?? r.kind}-${r.id ?? r.ledger_id ?? ''}-${i}`} className={`k-${r.kind}${STRONG.has(r.kind) ? ' strong' : ''}${open ? ' link' : ''}`}
                onClick={open} tabIndex={open ? 0 : undefined} onKeyDown={open ? (e) => { if (e.key === 'Enter') open() } : undefined} data-kind={r.kind}>
                {columns.map((c) => {
                  const custom = cell?.(c, r)
                  const v = r[c.key]
                  return (
                    <td key={c.key} className={numeric(c) ? 'num' : undefined} style={c.key === labelKey ? { paddingLeft: 8 + 16 * (r.depth ?? 0) } : undefined}>
                      {custom !== undefined ? custom : display(c, v)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        {showTotals && (
          <tfoot>
            <tr className="strong">
              {columns.map((c, i) => <td key={c.key} className={numeric(c) ? 'num' : undefined}>{i === 0 ? totalsLabel : display(c, totals![c.key])}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

const numeric = (c: ReportColumn) => c.type === 'amount' || c.type === 'qty' || c.type === 'pct'

function display(c: ReportColumn, v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return ''
  if (c.type === 'amount') return <span className="lf-num">{formatTaka(String(v))}</span>
  if (c.type === 'date') return new Date(`${String(v)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  if (c.key === 'balance_side') return v === 'cr' ? 'Cr' : 'Dr'
  return String(v)
}
