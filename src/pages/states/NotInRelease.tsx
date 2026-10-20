import { useLocation, useNavigate } from 'react-router-dom'
import { lf } from '../../ds'

/** Modules outside the first vertical slice: shown honestly instead of a mock screen. */
export function NotInRelease() {
  const { EmptyState, Button } = lf()
  const navigate = useNavigate()
  const label = (useLocation().state as { label?: string } | null)?.label ?? 'This module'
  return (
    <div data-testid="state-not-in-release" style={{ marginTop: 48 }}>
      <EmptyState icon="file-text" title={`${label} is not in this release yet`}
        description="The first release covers sign-in, roles and customers. Other modules follow the development roadmap."
        action={<Button variant="secondary" icon="users" onClick={() => navigate('/customers')}>Go to customers</Button>} />
    </div>
  )
}
