/**
 * Pluto logo (backlog P1.7-FE-01): the design system's mark and word styles (.lf-logo* in bundle.css), owned by the
 * app so the product name never depends on the prebuilt bundle. The bundle's Sidebar draws the bundle's own Logo,
 * whose word is patched to "Pluto" (public/ds/README.md).
 */
export function Logo({ compact = false, reversed = true }: { compact?: boolean; reversed?: boolean }) {
  return (
    <span className={reversed ? 'lf-logo is-reversed' : 'lf-logo'} aria-label={compact ? 'Pluto' : undefined} role={compact ? 'img' : undefined}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="lf-logo-mark">
        <rect width="32" height="32" rx="8" className="lf-logo-tile" />
        <rect x="7" y="8" width="10" height="3.2" rx="1.6" className="lf-logo-bar" />
        <rect x="7" y="13.6" width="15" height="3.2" rx="1.6" className="lf-logo-bar" />
        <rect x="7" y="20.4" width="18" height="1.6" rx="0.8" className="lf-logo-rule" />
        <rect x="7" y="23.6" width="18" height="1.6" rx="0.8" className="lf-logo-rule" />
      </svg>
      {!compact && <span className="lf-logo-word">Pluto</span>}
    </span>
  )
}
