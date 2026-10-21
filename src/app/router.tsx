import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { PageSkeleton } from '../components/PageSkeleton'
import { NotFound, NotInRelease } from '../components/states'
import { useSession } from '../auth/session'
import { RequireAuth, RequirePermission } from './guards'
import { allLinks, landingPath, NAV } from './nav'
import { Shell } from './Shell'
import { SignIn } from '../pages/SignIn'

/**
 * Routes (08 §3). Each module folder is one lazy chunk (NFR-004); every route names its breadcrumbs in
 * `handle.crumbs` (the design's three-level rule). Pages that are in the navigation registry but not built yet get
 * a real route showing "not in this release" behind the page's permission.
 */
export interface RouteHandle { crumbs: string[] }

const customers = () => import('../pages/customers')
const CustomerList = lazy(() => customers().then((m) => ({ default: m.CustomerList })))
const CustomerForm = lazy(() => customers().then((m) => ({ default: m.CustomerForm })))
const CustomerDetails = lazy(() => customers().then((m) => ({ default: m.CustomerDetails })))
const Security = lazy(() => import('../pages/settings').then((m) => ({ default: m.Security })))
// Dev-only (P1.2-FE-07): created only in development builds, so production ships no chunk for it.
const PickersDemo = import.meta.env.DEV ? lazy(() => import('../pages/dev/PickersDemo').then((m) => ({ default: m.PickersDemo }))) : null

const lazyPage = (el: ReactNode, template: 'list' | 'form' | 'detail' | 'report') => <Suspense fallback={<PageSkeleton template={template} />}>{el}</Suspense>
const guarded = (permission: string | null, el: ReactNode) => (permission ? <RequirePermission permission={permission}>{el}</RequirePermission> : el)

/** `/` → the role's landing page (R-35): a Store keeper goes to Inventory, not to a 403. */
function Landing() {
  const { can } = useSession()
  return <Navigate to={landingPath(can)} replace />
}

/** Unbuilt registry pages: the parent module label in the message, both levels in the breadcrumb. */
function unbuiltRoutes(): RouteObject[] {
  const parentOf = new Map<string, string>()
  for (const s of NAV) for (const i of s.items) for (const c of i.children ?? []) if (c.path !== i.path) parentOf.set(c.path, i.label)
  return allLinks().filter((l) => !l.built).map((l) => {
    const parent = parentOf.get(l.path)
    const label = parent ? `${parent} › ${l.label}` : l.label
    return { path: l.path.slice(1), element: guarded(l.permission, <NotInRelease label={label} />), handle: { crumbs: parent ? [parent, l.label] : [l.label] } satisfies RouteHandle }
  })
}

const crumbs = (...c: string[]) => ({ crumbs: c }) satisfies RouteHandle

export const router = createBrowserRouter([
  { path: '/sign-in', element: <SignIn /> },
  {
    element: <RequireAuth><Shell /></RequireAuth>,
    children: [
      { index: true, element: <Landing /> },
      { path: 'customers', handle: crumbs('Customers'), element: guarded('parties.view', lazyPage(<CustomerList />, 'list')) },
      { path: 'customers/new', handle: crumbs('Customers', 'New customer'), element: guarded('parties.view', lazyPage(<CustomerForm mode="add" />, 'form')) },
      { path: 'customers/:id', handle: crumbs('Customers', 'Customer'), element: guarded('parties.view', lazyPage(<CustomerDetails />, 'detail')) },
      { path: 'customers/:id/edit', handle: crumbs('Customers', 'Edit customer'), element: guarded('parties.view', lazyPage(<CustomerForm mode="edit" />, 'form')) },
      { path: 'settings', element: <Navigate to="/settings/security" replace /> },
      { path: 'settings/security', handle: crumbs('Settings', 'Security'), element: lazyPage(<Security />, 'form') },
      ...unbuiltRoutes(),
      { path: 'not-in-release', handle: crumbs('LedgerFlow'), element: <NotInRelease /> },
      // Development-only demo of the async pickers (P1.2-FE-07); not part of production builds.
      ...(PickersDemo ? [{ path: 'dev/pickers', handle: crumbs('Development', 'Pickers'), element: lazyPage(<PickersDemo />, 'form') }] : []),
      { path: '*', handle: crumbs('Not found'), element: <NotFound /> },
    ],
  },
])
