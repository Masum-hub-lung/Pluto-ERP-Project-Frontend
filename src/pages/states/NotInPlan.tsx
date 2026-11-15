import { useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { MODULE_LABELS, type ModuleKey } from '../../lib/modules'

/** PEP-498: a part of Pluto the company's plan leaves out. Nothing is deleted; it comes back when the plan includes it. */
export function NotInPlan({ module }: { module: ModuleKey }) {
  const { Icon, Button } = ds()
  const navigate = useNavigate()
  const { me } = useSession()
  const label = MODULE_LABELS[module]
  return (
    <section role="alert" data-testid="state-not-in-plan" style={{ maxWidth: 560, margin: '64px auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <span style={{ color: 'var(--brand-ink)' }}><Icon name="lock" size={28} /></span>
      <h1 style={{ margin: 0, font: '500 26px/32px var(--font-serif)' }}>{label} is not in your plan</h1>
      <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
        {me?.plan_name ? <>Your company is on the <strong>{me.plan_name}</strong> plan. </> : null}
        Ask Pluto to add {label}. Anything your company entered before is kept and comes back when it is added.
      </p>
      <Button variant="ghost" icon="arrow-left" onClick={() => navigate(-1)}>Go back</Button>
    </section>
  )
}
