import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RequireAuth, RequirePermission } from './guards'
import { Shell } from './Shell'
import { SignIn } from '../pages/SignIn'
import { CustomerList } from '../pages/customers/CustomerList'
import { CustomerForm } from '../pages/customers/CustomerForm'
import { CustomerDetails } from '../pages/customers/CustomerDetails'
import { NotFound } from '../pages/states/NotFound'
import { NotInRelease } from '../pages/states/NotInRelease'
import { Security } from '../pages/settings/Security'
import { PickersDemo } from '../pages/dev/PickersDemo'

/** Routes of the first slice (08 §3): sign-in, the customer workflow (B1-B4) and Settings › Security (K14, 2-step only). */
export const router = createBrowserRouter([
  { path: '/sign-in', element: <SignIn /> },
  {
    element: <RequireAuth><Shell /></RequireAuth>,
    children: [
      { index: true, element: <Navigate to="/customers" replace /> },
      { path: 'customers', element: <RequirePermission permission="parties.view"><CustomerList /></RequirePermission> },
      { path: 'customers/new', element: <RequirePermission permission="parties.view"><CustomerForm mode="add" /></RequirePermission> },
      { path: 'customers/:id', element: <RequirePermission permission="parties.view"><CustomerDetails /></RequirePermission> },
      { path: 'customers/:id/edit', element: <RequirePermission permission="parties.view"><CustomerForm mode="edit" /></RequirePermission> },
      { path: 'settings', element: <Navigate to="/settings/security" replace /> },
      { path: 'settings/security', element: <Security /> },
      { path: 'not-in-release', element: <NotInRelease /> },
      // Development-only demo of the async pickers (P1.2-FE-07); not part of production builds.
      ...(import.meta.env.DEV ? [{ path: 'dev/pickers', element: <PickersDemo /> }] : []),
      { path: '*', element: <NotFound /> },
    ],
  },
])
