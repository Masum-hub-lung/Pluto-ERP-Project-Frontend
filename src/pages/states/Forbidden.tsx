import { useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'

/** L-state "denied" (States.dc.html): the page's permission is missing for this role. */
export function Forbidden({ permission, what = 'this page' }: { permission?: string; what?: string }) {
  const { Icon, Button } = ds()
  const navigate = useNavigate()
  const { me, companyId } = useSession()
  const role = me?.companies.find((c) => c.company_id === companyId)?.role
  return (
    <section role="alert" data-testid="state-denied" style={{ maxWidth: 560, margin: '64px auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <span style={{ color: 'var(--warning)' }}><Icon name="triangle-alert" size={28} /></span>
      <h1 style={{ margin: 0, font: '500 26px/32px var(--font-serif)' }}>You don’t have access to {what}</h1>
      <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
        {role ? <>Your role is <strong>{role}</strong>. </> : null}Ask an Owner to grant {permission ? <code className="lf-code">{permission}</code> : 'access'}.
      </p>
      <Button variant="ghost" icon="arrow-left" onClick={() => navigate(-1)}>Go back</Button>
      <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Error 403 · the link you opened stays valid once access is granted</span>
    </section>
  )
}
