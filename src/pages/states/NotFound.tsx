import { useNavigate } from 'react-router-dom'
import { lf } from '../../ds'

/** L15 "not found" (States.dc.html). Also used for another company's record (the API answers 404, BR-037). */
export function NotFound({ what = 'this page', back = '/customers', backLabel = 'Customers' }: { what?: string; back?: string; backLabel?: string }) {
  const { Button } = lf()
  const navigate = useNavigate()
  return (
    <section data-testid="state-notfound" style={{ maxWidth: 560, margin: '64px auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <span className="lf-num" style={{ font: '500 40px/44px var(--font-serif)', color: 'var(--ink-muted)' }}>404</span>
      <h1 style={{ margin: 0, font: '500 26px/32px var(--font-serif)' }}>We couldn’t find {what}</h1>
      <p style={{ margin: 0, color: 'var(--ink-muted)' }}>It may have been deleted, or the link is mistyped.</p>
      <Button variant="secondary" icon="users" onClick={() => navigate(back)}>{backLabel}</Button>
    </section>
  )
}
