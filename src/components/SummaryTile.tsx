/**
 * Stat tile above lists and on detail pages (Parties.dc.html summary): label, big value, one line of context.
 * Styles: `.lf-tile*` in design/pluto.css; the value shrinks with the tile's own width (container query), so a long
 * amount never spills out of a narrow tile (four across inside a card, PEP-481).
 */
export function SummaryTile({ label, value, sub, tone, testId, className = 'lf-c3' }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'negative'; testId?: string; className?: string
}) {
  return (
    <div className={`lf-tile ${className}`}>
      <span className="lf-tile-label">{label}</span>
      <span className={`lf-num lf-tile-value${tone === 'negative' ? ' is-negative' : ''}`} data-testid={testId}>{value}</span>
      <span className="lf-tile-sub">{sub ?? ' '}</span>
    </div>
  )
}
