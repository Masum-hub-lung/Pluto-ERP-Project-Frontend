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
const suppliers = () => import('../pages/suppliers')
const SupplierList = lazy(() => suppliers().then((m) => ({ default: m.SupplierList })))
const SupplierForm = lazy(() => suppliers().then((m) => ({ default: m.SupplierForm })))
const SupplierDetails = lazy(() => suppliers().then((m) => ({ default: m.SupplierDetails })))
const inventory = () => import('../pages/inventory')
const ProductList = lazy(() => inventory().then((m) => ({ default: m.ProductList })))
const ProductForm = lazy(() => inventory().then((m) => ({ default: m.ProductForm })))
const WarehouseList = lazy(() => inventory().then((m) => ({ default: m.WarehouseList })))
const CategoryList = lazy(() => inventory().then((m) => ({ default: m.CategoryList })))
const MovementList = lazy(() => inventory().then((m) => ({ default: m.MovementList })))
const StockGroupList = lazy(() => inventory().then((m) => ({ default: m.StockGroupList })))
const purchases = () => import('../pages/purchases')
const BillList = lazy(() => purchases().then((m) => ({ default: m.BillList })))
const BillDetails = lazy(() => purchases().then((m) => ({ default: m.BillDetails })))
const BillEditor = lazy(() => purchases().then((m) => ({ default: m.BillEditor })))
const sales = () => import('../pages/sales')
const InvoiceList = lazy(() => sales().then((m) => ({ default: m.InvoiceList })))
const InvoiceDetails = lazy(() => sales().then((m) => ({ default: m.InvoiceDetails })))
const InvoiceEditor = lazy(() => sales().then((m) => ({ default: m.InvoiceEditor })))
const InvoicePreview = lazy(() => sales().then((m) => ({ default: m.InvoicePreview })))
const Security = lazy(() => import('../pages/settings').then((m) => ({ default: m.Security })))
// Dev-only (P1.2-FE-07): created only in development builds, so production ships no chunk for it.
const PickersDemo = import.meta.env.DEV ? lazy(() => import('../pages/dev/PickersDemo').then((m) => ({ default: m.PickersDemo }))) : null
const DocumentDemo = import.meta.env.DEV ? lazy(() => import('../pages/dev/DocumentDemo').then((m) => ({ default: m.DocumentDemo }))) : null

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
      { path: 'suppliers', handle: crumbs('Suppliers'), element: guarded('parties.view', lazyPage(<SupplierList />, 'list')) },
      { path: 'suppliers/new', handle: crumbs('Suppliers', 'New supplier'), element: guarded('parties.create', lazyPage(<SupplierForm mode="add" />, 'form')) },
      { path: 'suppliers/:id', handle: crumbs('Suppliers', 'Supplier'), element: guarded('parties.view', lazyPage(<SupplierDetails />, 'detail')) },
      { path: 'suppliers/:id/edit', handle: crumbs('Suppliers', 'Edit supplier'), element: guarded('parties.edit', lazyPage(<SupplierForm mode="edit" />, 'form')) },
      // Products is the module's main page until the Inventory summary (D14) arrives in P11.
      { path: 'inventory', element: <Navigate to="/inventory/products" replace /> },
      { path: 'inventory/products', handle: crumbs('Inventory', 'Products'), element: guarded('inventory.view', lazyPage(<ProductList />, 'list')) },
      { path: 'inventory/products/new', handle: crumbs('Inventory', 'New item'), element: guarded('inventory.create', lazyPage(<ProductForm mode="add" />, 'form')) },
      { path: 'inventory/products/:id/edit', handle: crumbs('Inventory', 'Edit item'), element: guarded('inventory.edit', lazyPage(<ProductForm mode="edit" />, 'form')) },
      { path: 'inventory/categories', handle: crumbs('Inventory', 'Categories'), element: guarded('inventory.view', lazyPage(<CategoryList />, 'list')) },
      { path: 'inventory/stock-groups', handle: crumbs('Inventory', 'Stock groups'), element: guarded('inventory.view', lazyPage(<StockGroupList />, 'list')) },
      { path: 'inventory/warehouses', handle: crumbs('Inventory', 'Warehouses'), element: guarded('inventory.view', lazyPage(<WarehouseList />, 'list')) },
      { path: 'sales/invoices', handle: crumbs('Sales', 'Invoices'), element: guarded('sales.view', lazyPage(<InvoiceList />, 'list')) },
      { path: 'sales/invoices/new', handle: crumbs('Sales', 'New invoice'), element: guarded('sales.create', lazyPage(<InvoiceEditor mode="new" />, 'form')) },
      { path: 'sales/invoices/:id', handle: crumbs('Sales', 'Invoice'), element: guarded('sales.view', lazyPage(<InvoiceDetails />, 'detail')) },
      { path: 'sales/invoices/:id/edit', handle: crumbs('Sales', 'Edit invoice'), element: guarded('sales.edit', lazyPage(<InvoiceEditor mode="edit" />, 'form')) },
      { path: 'sales/invoices/:id/preview', handle: crumbs('Sales', 'Invoice preview'), element: guarded('sales.view', lazyPage(<InvoicePreview />, 'detail')) },
      { path: 'purchases/bills', handle: crumbs('Purchases', 'Bills'), element: guarded('purchases.view', lazyPage(<BillList />, 'list')) },
      { path: 'purchases/bills/new', handle: crumbs('Purchases', 'New bill'), element: guarded('purchases.create', lazyPage(<BillEditor mode="new" />, 'form')) },
      { path: 'purchases/bills/:id', handle: crumbs('Purchases', 'Bill'), element: guarded('purchases.view', lazyPage(<BillDetails />, 'detail')) },
      { path: 'purchases/bills/:id/edit', handle: crumbs('Purchases', 'Edit bill'), element: guarded('purchases.edit', lazyPage(<BillEditor mode="edit" />, 'form')) },
      { path: 'inventory/movements', handle: crumbs('Inventory', 'Movements'), element: guarded('inventory.view', lazyPage(<MovementList />, 'list')) },
      { path: 'settings', element: <Navigate to="/settings/security" replace /> },
      { path: 'settings/security', handle: crumbs('Settings', 'Security'), element: lazyPage(<Security />, 'form') },
      ...unbuiltRoutes(),
      { path: 'not-in-release', handle: crumbs('Pluto'), element: <NotInRelease /> },
      // Development-only demo of the async pickers (P1.2-FE-07); not part of production builds.
      ...(PickersDemo ? [{ path: 'dev/pickers', handle: crumbs('Development', 'Pickers'), element: lazyPage(<PickersDemo />, 'form') }] : []),
      ...(DocumentDemo ? [{ path: 'dev/document', handle: crumbs('Development', 'Document editor'), element: lazyPage(<DocumentDemo />, 'form') }] : []),
      { path: '*', handle: crumbs('Not found'), element: <NotFound /> },
    ],
  },
])
