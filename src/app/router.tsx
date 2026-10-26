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
const PaymentForm = lazy(() => purchases().then((m) => ({ default: m.PaymentForm })))
const PaymentList = lazy(() => purchases().then((m) => ({ default: m.PaymentList })))
const PaymentDetails = lazy(() => purchases().then((m) => ({ default: m.PaymentDetails })))
const partyAccounts = () => import('../pages/partyAccounts')
const PartyLedger = lazy(() => partyAccounts().then((m) => ({ default: m.PartyLedger })))
const PartyHistory = lazy(() => partyAccounts().then((m) => ({ default: m.PartyHistory })))
const PartyOutstanding = lazy(() => partyAccounts().then((m) => ({ default: m.PartyOutstanding })))
const PartyStatement = lazy(() => partyAccounts().then((m) => ({ default: m.PartyStatement })))
const banking = () => import('../pages/banking')
const MoneyAccountList = lazy(() => banking().then((m) => ({ default: m.MoneyAccountList })))
const MoneyAccountForm = lazy(() => banking().then((m) => ({ default: m.MoneyAccountForm })))
const sales = () => import('../pages/sales')
const InvoiceList = lazy(() => sales().then((m) => ({ default: m.InvoiceList })))
const InvoiceDetails = lazy(() => sales().then((m) => ({ default: m.InvoiceDetails })))
const InvoiceEditor = lazy(() => sales().then((m) => ({ default: m.InvoiceEditor })))
const InvoicePreview = lazy(() => sales().then((m) => ({ default: m.InvoicePreview })))
const ReceiptForm = lazy(() => sales().then((m) => ({ default: m.ReceiptForm })))
const ReceiptList = lazy(() => sales().then((m) => ({ default: m.ReceiptList })))
const ReceiptDetails = lazy(() => sales().then((m) => ({ default: m.ReceiptDetails })))
const Security = lazy(() => import('../pages/settings').then((m) => ({ default: m.Security })))
const FinancialYears = lazy(() => import('../pages/settings').then((m) => ({ default: m.FinancialYears })))
const AccountingDefaults = lazy(() => import('../pages/settings').then((m) => ({ default: m.AccountingDefaults })))
const accounting = () => import('../pages/accounting')
const AccountingOverview = lazy(() => accounting().then((m) => ({ default: m.AccountingOverview })))
const ChartOfAccounts = lazy(() => accounting().then((m) => ({ default: m.ChartOfAccounts })))
const GroupDetails = lazy(() => accounting().then((m) => ({ default: m.GroupDetails })))
const LedgerList = lazy(() => accounting().then((m) => ({ default: m.LedgerList })))
const LedgerForm = lazy(() => accounting().then((m) => ({ default: m.LedgerForm })))
const LedgerDetails = lazy(() => accounting().then((m) => ({ default: m.LedgerDetails })))
const VoucherList = lazy(() => accounting().then((m) => ({ default: m.VoucherList })))
const VoucherDetails = lazy(() => accounting().then((m) => ({ default: m.VoucherDetails })))
const VoucherNew = lazy(() => accounting().then((m) => ({ default: m.VoucherNew })))
const VoucherEdit = lazy(() => accounting().then((m) => ({ default: m.VoucherEdit })))
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
      { path: 'customers/outstanding', handle: crumbs('Customers', 'Outstanding'), element: guarded('parties.view', lazyPage(<PartyOutstanding type="customer" />, 'report')) },
      { path: 'customers/:id/history', handle: crumbs('Customers', 'History'), element: guarded('parties.view', lazyPage(<PartyHistory type="customer" />, 'list')) },
      { path: 'customers/:id/ledger', handle: crumbs('Customers', 'Ledger'), element: guarded('parties.view', lazyPage(<PartyLedger type="customer" />, 'report')) },
      { path: 'customers/:id/statement', handle: crumbs('Customers', 'Statement'), element: guarded('parties.view', lazyPage(<PartyStatement type="customer" />, 'report')) },
      { path: 'customers/:id', handle: crumbs('Customers', 'Customer'), element: guarded('parties.view', lazyPage(<CustomerDetails />, 'detail')) },
      { path: 'customers/:id/edit', handle: crumbs('Customers', 'Edit customer'), element: guarded('parties.view', lazyPage(<CustomerForm mode="edit" />, 'form')) },
      { path: 'suppliers', handle: crumbs('Suppliers'), element: guarded('parties.view', lazyPage(<SupplierList />, 'list')) },
      { path: 'suppliers/new', handle: crumbs('Suppliers', 'New supplier'), element: guarded('parties.create', lazyPage(<SupplierForm mode="add" />, 'form')) },
      { path: 'suppliers/outstanding', handle: crumbs('Suppliers', 'Outstanding'), element: guarded('parties.view', lazyPage(<PartyOutstanding type="supplier" />, 'report')) },
      { path: 'suppliers/:id/history', handle: crumbs('Suppliers', 'History'), element: guarded('parties.view', lazyPage(<PartyHistory type="supplier" />, 'list')) },
      { path: 'suppliers/:id/ledger', handle: crumbs('Suppliers', 'Ledger'), element: guarded('parties.view', lazyPage(<PartyLedger type="supplier" />, 'report')) },
      { path: 'suppliers/:id/statement', handle: crumbs('Suppliers', 'Statement'), element: guarded('parties.view', lazyPage(<PartyStatement type="supplier" />, 'report')) },
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
      { path: 'banking/accounts', handle: crumbs('Cash and bank', 'Accounts'), element: guarded('banking.view', lazyPage(<MoneyAccountList />, 'list')) },
      { path: 'banking/accounts/new', handle: crumbs('Cash and bank', 'Add account'), element: guarded('banking.create', lazyPage(<MoneyAccountForm />, 'form')) },
      { path: 'sales/payments', handle: crumbs('Sales', 'Payments received'), element: guarded('sales.view', lazyPage(<ReceiptList />, 'list')) },
      { path: 'sales/payments/new', handle: crumbs('Sales', 'Customer payment'), element: guarded('sales.create', lazyPage(<ReceiptForm />, 'form')) },
      { path: 'sales/payments/:id', handle: crumbs('Sales', 'Payment'), element: guarded('sales.view', lazyPage(<ReceiptDetails />, 'detail')) },
      { path: 'sales/invoices', handle: crumbs('Sales', 'Invoices'), element: guarded('sales.view', lazyPage(<InvoiceList />, 'list')) },
      { path: 'sales/invoices/new', handle: crumbs('Sales', 'New invoice'), element: guarded('sales.create', lazyPage(<InvoiceEditor mode="new" />, 'form')) },
      { path: 'sales/invoices/:id', handle: crumbs('Sales', 'Invoice'), element: guarded('sales.view', lazyPage(<InvoiceDetails />, 'detail')) },
      { path: 'sales/invoices/:id/edit', handle: crumbs('Sales', 'Edit invoice'), element: guarded('sales.edit', lazyPage(<InvoiceEditor mode="edit" />, 'form')) },
      { path: 'sales/invoices/:id/preview', handle: crumbs('Sales', 'Invoice preview'), element: guarded('sales.view', lazyPage(<InvoicePreview />, 'detail')) },
      { path: 'purchases/bills', handle: crumbs('Purchases', 'Bills'), element: guarded('purchases.view', lazyPage(<BillList />, 'list')) },
      { path: 'purchases/bills/new', handle: crumbs('Purchases', 'New bill'), element: guarded('purchases.create', lazyPage(<BillEditor mode="new" />, 'form')) },
      { path: 'purchases/bills/:id', handle: crumbs('Purchases', 'Bill'), element: guarded('purchases.view', lazyPage(<BillDetails />, 'detail')) },
      { path: 'purchases/bills/:id/edit', handle: crumbs('Purchases', 'Edit bill'), element: guarded('purchases.edit', lazyPage(<BillEditor mode="edit" />, 'form')) },
      { path: 'purchases/payments', handle: crumbs('Purchases', 'Payments made'), element: guarded('purchases.view', lazyPage(<PaymentList />, 'list')) },
      { path: 'purchases/payments/new', handle: crumbs('Purchases', 'Supplier payment'), element: guarded('purchases.create', lazyPage(<PaymentForm />, 'form')) },
      { path: 'purchases/payments/:id', handle: crumbs('Purchases', 'Payment'), element: guarded('purchases.view', lazyPage(<PaymentDetails />, 'detail')) },
      { path: 'inventory/movements', handle: crumbs('Inventory', 'Movements'), element: guarded('inventory.view', lazyPage(<MovementList />, 'list')) },
      { path: 'settings', element: <Navigate to="/settings/security" replace /> },
      { path: 'settings/security', handle: crumbs('Settings', 'Security'), element: lazyPage(<Security />, 'form') },
      { path: 'settings/financial-years', handle: crumbs('Settings', 'Financial years'), element: lazyPage(<FinancialYears />, 'form') },
      { path: 'settings/accounting', handle: crumbs('Settings', 'Accounting defaults'), element: guarded('accounting.view', lazyPage(<AccountingDefaults />, 'form')) },
      // Accounting (P7.2). Voucher pages check the type-specific permission themselves (R-09: cash vouchers allow banking.*).
      { path: 'accounting', handle: crumbs('Accounting'), element: guarded('accounting.view', lazyPage(<AccountingOverview />, 'report')) },
      { path: 'accounting/chart', handle: crumbs('Accounting', 'Chart of accounts'), element: guarded('accounting.view', lazyPage(<ChartOfAccounts />, 'list')) },
      { path: 'accounting/groups/:id', handle: crumbs('Accounting', 'Account group'), element: guarded('accounting.view', lazyPage(<GroupDetails />, 'detail')) },
      { path: 'accounting/ledgers', handle: crumbs('Accounting', 'Ledgers'), element: guarded('accounting.view', lazyPage(<LedgerList />, 'list')) },
      { path: 'accounting/ledgers/new', handle: crumbs('Accounting', 'Add ledger'), element: guarded('accounting.create', lazyPage(<LedgerForm mode="add" />, 'form')) },
      { path: 'accounting/ledgers/:id', handle: crumbs('Accounting', 'Ledger'), element: guarded('accounting.view', lazyPage(<LedgerDetails />, 'report')) },
      { path: 'accounting/ledgers/:id/edit', handle: crumbs('Accounting', 'Edit ledger'), element: guarded('accounting.edit', lazyPage(<LedgerForm mode="edit" />, 'form')) },
      { path: 'accounting/vouchers', handle: crumbs('Accounting', 'Vouchers'), element: guarded('accounting.view', lazyPage(<VoucherList />, 'list')) },
      { path: 'accounting/vouchers/new/:type', handle: crumbs('Accounting', 'New voucher'), element: lazyPage(<VoucherNew />, 'form') },
      { path: 'accounting/vouchers/:id', handle: crumbs('Accounting', 'Voucher'), element: guarded('accounting.view', lazyPage(<VoucherDetails />, 'detail')) },
      { path: 'accounting/vouchers/:id/edit', handle: crumbs('Accounting', 'Edit voucher'), element: lazyPage(<VoucherEdit />, 'form') },
      ...unbuiltRoutes(),
      { path: 'not-in-release', handle: crumbs('Pluto'), element: <NotInRelease /> },
      // Development-only demo of the async pickers (P1.2-FE-07); not part of production builds.
      ...(PickersDemo ? [{ path: 'dev/pickers', handle: crumbs('Development', 'Pickers'), element: lazyPage(<PickersDemo />, 'form') }] : []),
      ...(DocumentDemo ? [{ path: 'dev/document', handle: crumbs('Development', 'Document editor'), element: lazyPage(<DocumentDemo />, 'form') }] : []),
      { path: '*', handle: crumbs('Not found'), element: <NotFound /> },
    ],
  },
])
