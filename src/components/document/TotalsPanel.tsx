import type { DocumentCalculation } from '../../api/contract.gen'
import { ds } from '../../ds'
import { ProblemBanner } from '../ProblemBanner'
import { totalsRows } from './totals'

/**
 * Document totals (F3/E3 aside; backlog P4.4-FE-02): subtotal, discount, tax, rounding, total, amount in words and the
 * "When you save" effects — all from the calculate response (DEC-09). While a new calculation runs, each figure is a
 * skeleton; a failed calculation shows a small banner and keeps the last figures out of sight.
 */
export function TotalsPanel({ result, pending, error, empty = 'Add a supplier and at least one line to see the totals.' }: {
  result: DocumentCalculation | null; pending: boolean; error: unknown; empty?: string
}) {
  const { Skeleton } = ds()
  const panel = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', padding: '18px 20px',
    display: 'flex', flexDirection: 'column', gap: 10 } as const
  if (error) return <section style={panel} aria-label="Totals"><ProblemBanner error={error} /></section>
  if (!result) {
    return (
      <section style={panel} aria-label="Totals" data-testid="totals-panel">
        <span className="lf-label">Totals</span>
        {pending ? [0, 1, 2].map((i) => <Skeleton key={i} height={18} />) : <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{empty}</span>}
      </section>
    )
  }
  const rows = totalsRows(result)
  return (
    <section style={panel} aria-label="Totals" aria-busy={pending} data-testid="totals-panel">
      <span className="lf-label">Totals</span>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline',
          ...(r.strong ? { borderTop: '1px solid var(--line)', paddingTop: 10, font: '600 18px/24px var(--font-sans)' } : {}) }}>
          <span style={{ color: r.strong ? 'var(--ink)' : 'var(--ink-muted)' }}>{r.label}</span>
          {pending ? <Skeleton width={90} height={r.strong ? 22 : 16} /> : <span className="lf-num" data-testid={`total-${r.key}`}>{r.value}</span>}
        </div>
      ))}
      {!pending && <span style={{ fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic' }} data-testid="amount-in-words">{result.amount_in_words}</span>}
      {!!result.effects?.length && (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="effects">
          <span className="lf-label">When you save</span>
          {pending ? <Skeleton height={32} /> : result.effects.map((e) => <span key={e} style={{ fontSize: 13, lineHeight: '18px' }}>{e}</span>)}
        </div>
      )}
    </section>
  )
}
