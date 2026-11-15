import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useSession } from '../auth/session'
import { ds } from '../ds'
import { Forbidden } from '../pages/states/Forbidden'
import { NotInPlan } from '../pages/states/NotInPlan'
import { modulePermission, type ModuleKey } from '../lib/modules'

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

/** PEP-498: a page in a plan module; the plan leaving it out shows "not in your plan" (before any permission check). */
export function RequireModule({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { can } = useSession()
  return can(modulePermission(module)) ? <>{children}</> : <NotInPlan module={module} />
}

function Restoring() {
  const { Skeleton } = ds()
  return (
    <div role="status" aria-label="Loading" style={{ padding: 48, display: 'grid', gap: 12, maxWidth: 480 }}>
      <Skeleton width="60%" height={20} /><Skeleton height={12} /><Skeleton width="80%" height={12} />
    </div>
  )
}
