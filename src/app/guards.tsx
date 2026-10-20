import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useSession } from '../auth/session'
import { lf } from '../ds'
import { Forbidden } from '../pages/states/Forbidden'

/** Signed-in routes; while the session restores from the refresh cookie a skeleton is shown. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, twoFactorBlocked, signedOutByUser } = useSession()
  const location = useLocation()
  if (status === 'restoring') return <Restoring />
  // Session expired: come back to this page after signing in. Signed out on purpose: start fresh.
  if (status === 'signed-out') return <Navigate to="/sign-in" replace state={signedOutByUser ? null : { from: location.pathname + location.search }} />
  // The company requires 2-step and this sign-in has none: only Security (to turn it on) is reachable.
  if (twoFactorBlocked && location.pathname !== '/settings/security') return <Navigate to="/settings/security" replace />
  return <>{children}</>
}

/** Page-level permission (the page's view permission from 02); the API enforces it again. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useSession()
  return can(permission) ? <>{children}</> : <Forbidden permission={permission} />
}

function Restoring() {
  const { Skeleton } = lf()
  return (
    <div role="status" aria-label="Loading" style={{ padding: 48, display: 'grid', gap: 12, maxWidth: 480 }}>
      <Skeleton width="60%" height={20} /><Skeleton height={12} /><Skeleton width="80%" height={12} />
    </div>
  )
}
