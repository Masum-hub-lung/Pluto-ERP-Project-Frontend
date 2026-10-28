/**
 * Pluto logo (backlog P1.7-FE-01): the brand mark and word come from public/brand/* through the .lf-logo rules in
 * public/lf-theme.css, which also restyle the bundle's own Logo inside its Sidebar. Owned by the app so the product
 * name never depends on the prebuilt bundle; "Pluto" stays as text for screen readers.
 */
export function Logo({ compact = false, reversed = true }: { compact?: boolean; reversed?: boolean }) {
  return (
    <span className={reversed ? 'lf-logo is-reversed' : 'lf-logo'} aria-label={compact ? 'Pluto' : undefined} role={compact ? 'img' : undefined}>
      {!compact && <span className="lf-logo-word">Pluto</span>}
    </span>
  )
}
