import type { DocumentCalculation } from '../../api/contract.gen'
import { ds } from '../../ds'
import { blockingChecks, CHECK_ICON as ICON, CHECK_STATUS_TEXT as STATUS_TEXT, checksSummary, sortChecks } from './checks'
import './document.css'

export { blockingChecks, checksSummary, sortChecks }

/** Scroll to a form row of the LineGrid (0-based) and put the cursor in its quantity. */
export function focusLine(row: number) {
  const el = document.querySelector<HTMLElement>(`[data-testid="line-grid"] [aria-label="Quantity, line ${row + 1}"]`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  el.focus({ preventScroll: true })
}

/**
 * "Checks before posting" (E3/F3 aside, A+ redesign; PEP-480): what the server checked for this unsaved document —
 * period open, stock, credit limit, overdue, back-dating, order quantity — as it comes back in the calculate
 * response (`checks`). Nothing is decided here: status and wording are the API's, this only orders and counts the
 * rows. `onLine` gets the check's `line_no` (1-based among the lines sent) and should take the user to that line.
 * While a newer calculation runs the last rows stay, dimmed; with no calculation yet there is a hint or a skeleton.
 */
export function ChecksPanel({ result, pending, error, onLine, empty = 'Add a customer and at least one line to see the checks.' }: {
  result: DocumentCalculation | null; pending: boolean; error?: unknown; onLine?: (lineNo: number) => void; empty?: string
}) {
  const { Icon, Skeleton } = ds()
  const title = <h2 className="lf-label lf-checks-title" id="posting-checks-title">Checks before posting</h2>
  if (error) return null // the totals panel above already says why the calculation failed
  if (!result) {
    return (
      <section className="lf-checks" aria-labelledby="posting-checks-title" aria-busy={pending} data-testid="posting-checks" data-state={pending ? 'loading' : 'empty'}>
        {title}
        {pending
          ? <div className="lf-checks-skeleton" aria-hidden="true"><Skeleton height={44} />{[0, 1, 2].map((i) => <Skeleton key={i} height={16} />)}</div>
          : <p className="lf-checks-hint">{empty}</p>}
        <span className="lf-sr" role="status" aria-live="polite">{pending ? 'Running the checks' : ''}</span>
      </section>
    )
  }
  const checks = sortChecks(result.checks ?? [])
  if (!checks.length) return null
  const summary = checksSummary(checks)
  return (
    <section className="lf-checks" aria-labelledby="posting-checks-title" aria-busy={pending} data-testid="posting-checks" data-state={summary.status}>
      {title}
      <div className={`lf-checks-summary lf-checks-${summary.status}`} role="status" aria-live="polite" data-testid="checks-summary">
        <span className="lf-checks-icon"><Icon name={ICON[summary.status]} size={20} /></span>
        <span className="lf-checks-summary-text">
          <strong className="lf-serif">{summary.text}</strong>
          <span>{summary.detail}</span>
        </span>
      </div>
      <ul className="lf-checks-list" data-pending={pending || undefined}>
        {checks.map((c, i) => (
          <li key={`${c.key}-${c.line_no ?? ''}-${i}`} className={`lf-checks-row lf-checks-${c.status}`} data-testid={`check-${c.key}`} data-status={c.status}>
            <span className="lf-checks-icon"><Icon name={ICON[c.status]} size={16} /></span>
            <span className="lf-checks-body">
              <span className={c.status === 'pass' ? 'lf-sr' : 'lf-checks-tag'}>{STATUS_TEXT[c.status]}<span className="lf-sr">: </span></span>
              <span className="lf-checks-label">{c.label}</span>
            </span>
            {c.line_no != null && (onLine
              ? <button type="button" className="lf-checks-line" onClick={() => onLine(c.line_no as number)} aria-label={`Go to line ${c.line_no}`}>Line {c.line_no}</button>
              : <span className="lf-checks-line">Line {c.line_no}</span>)}
          </li>
        ))}
      </ul>
    </section>
  )
}
