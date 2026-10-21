/** Stat tile above lists and on detail pages (Parties.dc.html summary): label, big value, one line of context. */
export function SummaryTile({ label, value, sub, tone, testId, className = 'lf-c3' }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'negative'; testId?: string; className?: string
}) {
  return (
    <div className={className} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ font: '600 13px/18px var(--font-sans)', color: 'var(--ink-muted)' }}>{label}</span>
      <span className="lf-num" data-testid={testId} style={{ font: '500 26px/32px var(--font-serif)', color: tone === 'negative' ? 'var(--negative)' : undefined }}>{value}</span>
      <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{sub ?? ' '}</span>
    </div>
  )
}
