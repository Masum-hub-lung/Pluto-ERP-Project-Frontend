import { useLocation, useNavigate } from 'react-router-dom'
import { ds } from '../../ds'

/** Modules outside the first vertical slice: shown honestly instead of a mock screen. */
export function NotInRelease({ label: fixed }: { label?: string }) {
  const { EmptyState, Button } = ds()
  const navigate = useNavigate()
  const label = fixed ?? (useLocation().state as { label?: string } | null)?.label ?? 'This module'
  return (
    <div data-testid="state-not-in-release" style={{ marginTop: 48 }}>
      <EmptyState icon="file-text" title={`${label} is not in this release yet`}
        description="The first release covers sign-in, roles and customers. Other modules follow the development roadmap."
        action={<Button variant="secondary" icon="layout-dashboard" onClick={() => navigate('/')}>Go to your start page</Button>} />
    </div>
  )
}
