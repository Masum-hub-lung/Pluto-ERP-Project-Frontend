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
const ProductDetails = lazy(() => inventory().then((m) => ({ default: m.ProductDetails })))
const WarehouseDetails = lazy(() => inventory().then((m) => ({ default: m.WarehouseDetails })))
const AdjustmentList = lazy(() => inventory().then((m) => ({ default: m.AdjustmentList })))
const AdjustmentForm = lazy(() => inventory().then((m) => ({ default: m.AdjustmentForm })))
const TransferList = lazy(() => inventory().then((m) => ({ default: m.TransferList })))
const TransferForm = lazy(() => inventory().then((m) => ({ default: m.TransferForm })))
const LowStock = lazy(() => inventory().then((m) => ({ default: m.LowStock })))
const Valuation = lazy(() => inventory().then((m) => ({ default: m.Valuation })))
const InventorySummary = lazy(() => inventory().then((m) => ({ default: m.InventorySummary })))
const purchases = () => import('../pages/purchases')
const BillList = lazy(() => purchases().then((m) => ({ default: m.BillList })))
const BillDetails = lazy(() => purchases().then((m) => ({ default: m.BillDetails })))
const BillEditor = lazy(() => purchases().then((m) => ({ default: m.BillEditor })))
const PaymentForm = lazy(() => purchases().then((m) => ({ default: m.PaymentForm })))
const PaymentList = lazy(() => purchases().then((m) => ({ default: m.PaymentList })))
const PaymentDetails = lazy(() => purchases().then((m) => ({ default: m.PaymentDetails })))
const PurchaseOrderList = lazy(() => purchases().then((m) => ({ default: m.PurchaseOrderList })))
const PurchaseOrderEditor = lazy(() => purchases().then((m) => ({ default: m.PurchaseOrderEditor })))
const PurchaseReturnsList = lazy(() => purchases().then((m) => ({ default: m.ReturnsList })))
const PurchaseReturnForm = lazy(() => purchases().then((m) => ({ default: m.ReturnForm })))
const DebitNoteForm = lazy(() => purchases().then((m) => ({ default: m.NoteForm })))
const partyAccounts = () => import('../pages/partyAccounts')
const PartyLedger = lazy(() => partyAccounts().then((m) => ({ default: m.PartyLedger })))
const PartyHistory = lazy(() => partyAccounts().then((m) => ({ default: m.PartyHistory })))
const PartyOutstanding = lazy(() => partyAccounts().then((m) => ({ default: m.PartyOutstanding })))
const PartyStatement = lazy(() => partyAccounts().then((m) => ({ default: m.PartyStatement })))
const banking = () => import('../pages/banking')
const MoneyAccountList = lazy(() => banking().then((m) => ({ default: m.MoneyAccountList })))
const MoneyAccountForm = lazy(() => banking().then((m) => ({ default: m.MoneyAccountForm })))
const BankingOverview = lazy(() => banking().then((m) => ({ default: m.BankingOverview })))
const AccountDetails = lazy(() => banking().then((m) => ({ default: m.AccountDetails })))
const MoneyForm = lazy(() => banking().then((m) => ({ default: m.MoneyForm })))
const MoneyBookPage = lazy(() => banking().then((m) => ({ default: m.MoneyBookPage })))
const MoneyTransactions = lazy(() => banking().then((m) => ({ default: m.MoneyTransactions })))
const Reconcile = lazy(() => banking().then((m) => ({ default: m.Reconcile })))
const incomeExpense = () => import('../pages/incomeExpense')
const IeOverview = lazy(() => incomeExpense().then((m) => ({ default: m.IeOverview })))
const IeList = lazy(() => incomeExpense().then((m) => ({ default: m.IeList })))
const IeForm = lazy(() => incomeExpense().then((m) => ({ default: m.IeForm })))
const IeCategories = lazy(() => incomeExpense().then((m) => ({ default: m.IeCategories })))
const IeReport = lazy(() => incomeExpense().then((m) => ({ default: m.IeReport })))
const RecurringList = lazy(() => incomeExpense().then((m) => ({ default: m.RecurringList })))
const sales = () => import('../pages/sales')
const InvoiceList = lazy(() => sales().then((m) => ({ default: m.InvoiceList })))
const InvoiceDetails = lazy(() => sales().then((m) => ({ default: m.InvoiceDetails })))
const InvoiceEditor = lazy(() => sales().then((m) => ({ default: m.InvoiceEditor })))
const InvoicePreview = lazy(() => sales().then((m) => ({ default: m.InvoicePreview })))
const ReceiptForm = lazy(() => sales().then((m) => ({ default: m.ReceiptForm })))
const ReceiptList = lazy(() => sales().then((m) => ({ default: m.ReceiptList })))
const ReceiptDetails = lazy(() => sales().then((m) => ({ default: m.ReceiptDetails })))
const QuotationList = lazy(() => sales().then((m) => ({ default: m.QuotationList })))
const QuotationEditor = lazy(() => sales().then((m) => ({ default: m.QuotationEditor })))
const SalesReturnsList = lazy(() => sales().then((m) => ({ default: m.ReturnsList })))
const SalesReturnForm = lazy(() => sales().then((m) => ({ default: m.ReturnForm })))
const CreditNoteForm = lazy(() => sales().then((m) => ({ default: m.NoteForm })))
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
const reports = () => import('../pages/reports')
const ReportsCentre = lazy(() => reports().then((m) => ({ default: m.ReportsCentre })))
const TrialBalance = lazy(() => reports().then((m) => ({ default: m.TrialBalance })))
const ProfitAndLoss = lazy(() => reports().then((m) => ({ default: m.ProfitAndLoss })))
const BalanceSheet = lazy(() => reports().then((m) => ({ default: m.BalanceSheet })))
const CashFlow = lazy(() => reports().then((m) => ({ default: m.CashFlow })))
const GeneralLedger = lazy(() => reports().then((m) => ({ default: m.GeneralLedger })))
const Aging = lazy(() => reports().then((m) => ({ default: m.Aging })))
const TradeReport = lazy(() => reports().then((m) => ({ default: m.TradeReport })))
const ReturnReport = lazy(() => reports().then((m) => ({ default: m.ReturnReport })))
const TradeOverview = lazy(() => reports().then((m) => ({ default: m.TradeOverview })))
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
      { path: 'inventory/products/:id', handle: crumbs('Inventory', 'Item'), element: guarded('inventory.view', lazyPage(<ProductDetails />, 'detail')) },
      { path: 'inventory/categories', handle: crumbs('Inventory', 'Categories'), element: guarded('inventory.view', lazyPage(<CategoryList />, 'list')) },
      { path: 'inventory/stock-groups', handle: crumbs('Inventory', 'Stock groups'), element: guarded('inventory.view', lazyPage(<StockGroupList />, 'list')) },
      { path: 'inventory/warehouses', handle: crumbs('Inventory', 'Warehouses'), element: guarded('inventory.view', lazyPage(<WarehouseList />, 'list')) },
      { path: 'inventory/warehouses/:id', handle: crumbs('Inventory', 'Warehouse'), element: guarded('inventory.view', lazyPage(<WarehouseDetails />, 'detail')) },
      // Inventory completion (P11): adjustments, transfers and the inventory reports.
      { path: 'inventory/adjustments', handle: crumbs('Inventory', 'Adjustments'), element: guarded('inventory.view', lazyPage(<AdjustmentList />, 'list')) },
      { path: 'inventory/adjustments/new', handle: crumbs('Inventory', 'New adjustment'), element: guarded('inventory.create', lazyPage(<AdjustmentForm key="new" mode="new" />, 'form')) },
      { path: 'inventory/adjustments/:id', handle: crumbs('Inventory', 'Adjustment'), element: guarded('inventory.view', lazyPage(<AdjustmentForm mode="edit" />, 'form')) },
      { path: 'inventory/transfers', handle: crumbs('Inventory', 'Transfers'), element: guarded('inventory.view', lazyPage(<TransferList />, 'list')) },
      { path: 'inventory/transfers/new', handle: crumbs('Inventory', 'New transfer'), element: guarded('inventory.create', lazyPage(<TransferForm key="new" mode="new" />, 'form')) },
      { path: 'inventory/transfers/:id', handle: crumbs('Inventory', 'Transfer'), element: guarded('inventory.view', lazyPage(<TransferForm mode="edit" />, 'form')) },
      { path: 'inventory/low-stock', handle: crumbs('Inventory', 'Low stock'), element: guarded('inventory.view', lazyPage(<LowStock />, 'report')) },
      { path: 'inventory/valuation', handle: crumbs('Inventory', 'Valuation'), element: guarded('inventory.view_costs', lazyPage(<Valuation />, 'report')) },
      { path: 'inventory/summary', handle: crumbs('Inventory', 'Summary'), element: guarded('inventory.view', lazyPage(<InventorySummary />, 'report')) },
      { path: 'banking/accounts', handle: crumbs('Cash and bank', 'Accounts'), element: guarded('banking.view', lazyPage(<MoneyAccountList />, 'list')) },
      { path: 'banking/accounts/new', handle: crumbs('Cash and bank', 'Add account'), element: guarded('banking.create', lazyPage(<MoneyAccountForm />, 'form')) },
      // Cash and bank (P12)
      { path: 'banking', handle: crumbs('Cash and bank', 'Overview'), element: guarded('banking.view', lazyPage(<BankingOverview />, 'detail')) },
      { path: 'banking/accounts/:id', handle: crumbs('Cash and bank', 'Account'), element: guarded('banking.view', lazyPage(<AccountDetails />, 'detail')) },
      { path: 'banking/received', handle: crumbs('Cash and bank', 'Money received'), element: guarded('banking.create', lazyPage(<MoneyForm key="received" kind="received" />, 'form')) },
      { path: 'banking/paid', handle: crumbs('Cash and bank', 'Money paid'), element: guarded('banking.create', lazyPage(<MoneyForm key="paid" kind="paid" />, 'form')) },
      { path: 'banking/cash-transfer', handle: crumbs('Cash and bank', 'Cash transfer'), element: guarded('banking.create', lazyPage(<MoneyForm key="ct" kind="cash-transfer" />, 'form')) },
      { path: 'banking/bank-transfer', handle: crumbs('Cash and bank', 'Bank transfer'), element: guarded('banking.create', lazyPage(<MoneyForm key="bt" kind="bank-transfer" />, 'form')) },
      { path: 'banking/cash-book', handle: crumbs('Cash and bank', 'Cash book'), element: guarded('banking.view', lazyPage(<MoneyBookPage key="cash" kind="cash" />, 'report')) },
      { path: 'banking/bank-book', handle: crumbs('Cash and bank', 'Bank book'), element: guarded('banking.view', lazyPage(<MoneyBookPage key="bank" kind="bank" />, 'report')) },
      { path: 'banking/reconcile/:id', handle: crumbs('Cash and bank', 'Reconciliation'), element: guarded('banking.reconcile', lazyPage(<Reconcile />, 'detail')) },
      { path: 'income', handle: crumbs('Income', 'Overview'), element: guarded('banking.view', lazyPage(<IeOverview key="income" kind="income" />, 'detail')) },
      { path: 'income/list', handle: crumbs('Income', 'Transactions'), element: guarded('banking.view', lazyPage(<IeList key="income" kind="income" />, 'list')) },
      { path: 'income/new', handle: crumbs('Income', 'Add income'), element: guarded('banking.create', lazyPage(<IeForm key="income" kind="income" />, 'form')) },
      { path: 'income/categories', handle: crumbs('Income', 'Categories'), element: guarded('banking.view', lazyPage(<IeCategories key="income" kind="income" />, 'list')) },
      { path: 'income/report', handle: crumbs('Income', 'Report'), element: guarded('reports.financial', lazyPage(<IeReport key="income" kind="income" />, 'report')) },
      { path: 'expenses', handle: crumbs('Expenses', 'Overview'), element: guarded('banking.view', lazyPage(<IeOverview key="expense" kind="expense" />, 'detail')) },
      { path: 'expenses/list', handle: crumbs('Expenses', 'Transactions'), element: guarded('banking.view', lazyPage(<IeList key="expense" kind="expense" />, 'list')) },
      { path: 'expenses/new', handle: crumbs('Expenses', 'Add expense'), element: guarded('banking.create', lazyPage(<IeForm key="expense" kind="expense" />, 'form')) },
      { path: 'expenses/categories', handle: crumbs('Expenses', 'Categories'), element: guarded('banking.view', lazyPage(<IeCategories key="expense" kind="expense" />, 'list')) },
      { path: 'expenses/report', handle: crumbs('Expenses', 'Report'), element: guarded('reports.financial', lazyPage(<IeReport key="expense" kind="expense" />, 'report')) },
      { path: 'expenses/recurring', handle: crumbs('Expenses', 'Recurring entries'), element: guarded('banking.view', lazyPage(<RecurringList />, 'list')) },
      { path: 'banking/transactions', handle: crumbs('Cash and bank', 'Transactions'), element: guarded('banking.view', lazyPage(<MoneyTransactions />, 'list')) },
      { path: 'sales/payments', handle: crumbs('Sales', 'Payments received'), element: guarded('sales.view', lazyPage(<ReceiptList />, 'list')) },
      { path: 'sales/payments/new', handle: crumbs('Sales', 'Customer payment'), element: guarded('sales.create', lazyPage(<ReceiptForm />, 'form')) },
      { path: 'sales/payments/:id', handle: crumbs('Sales', 'Payment'), element: guarded('sales.view', lazyPage(<ReceiptDetails />, 'detail')) },
      // Trade completion (P10): overviews, quotations, returns and notes.
      { path: 'sales', handle: crumbs('Sales', 'Overview'), element: guarded('sales.view', lazyPage(<TradeOverview key="sales" side="sales" />, 'detail')) },
      { path: 'sales/quotations', handle: crumbs('Sales', 'Quotations'), element: guarded('sales.view', lazyPage(<QuotationList />, 'list')) },
      { path: 'sales/quotations/new', handle: crumbs('Sales', 'New quotation'), element: guarded('sales.create', lazyPage(<QuotationEditor mode="new" />, 'form')) },
      { path: 'sales/quotations/:id', handle: crumbs('Sales', 'Quotation'), element: guarded('sales.view', lazyPage(<QuotationEditor mode="edit" />, 'form')) },
      { path: 'sales/returns', handle: crumbs('Sales', 'Returns and credit notes'), element: guarded('sales.view', lazyPage(<SalesReturnsList key="sales" side="sales" />, 'list')) },
      { path: 'sales/returns/new', handle: crumbs('Sales', 'New return'), element: guarded('sales.create', lazyPage(<SalesReturnForm key="new" side="sales" mode="new" />, 'form')) },
      { path: 'sales/returns/:id', handle: crumbs('Sales', 'Return'), element: guarded('sales.view', lazyPage(<SalesReturnForm side="sales" mode="edit" />, 'form')) },
      { path: 'sales/credit-notes/new', handle: crumbs('Sales', 'New credit note'), element: guarded('sales.create', lazyPage(<CreditNoteForm key="new" side="sales" mode="new" />, 'form')) },
      { path: 'sales/credit-notes/:id', handle: crumbs('Sales', 'Credit note'), element: guarded('sales.view', lazyPage(<CreditNoteForm side="sales" mode="edit" />, 'form')) },
      { path: 'sales/invoices', handle: crumbs('Sales', 'Invoices'), element: guarded('sales.view', lazyPage(<InvoiceList />, 'list')) },
      { path: 'sales/invoices/new', handle: crumbs('Sales', 'New invoice'), element: guarded('sales.create', lazyPage(<InvoiceEditor mode="new" />, 'form')) },
      { path: 'sales/invoices/:id', handle: crumbs('Sales', 'Invoice'), element: guarded('sales.view', lazyPage(<InvoiceDetails />, 'detail')) },
      { path: 'sales/invoices/:id/edit', handle: crumbs('Sales', 'Edit invoice'), element: guarded('sales.edit', lazyPage(<InvoiceEditor mode="edit" />, 'form')) },
      { path: 'sales/invoices/:id/preview', handle: crumbs('Sales', 'Invoice preview'), element: guarded('sales.view', lazyPage(<InvoicePreview />, 'detail')) },
      { path: 'purchases', handle: crumbs('Purchases', 'Overview'), element: guarded('purchases.view', lazyPage(<TradeOverview key="purchases" side="purchases" />, 'detail')) },
      { path: 'purchases/orders', handle: crumbs('Purchases', 'Purchase orders'), element: guarded('purchases.view', lazyPage(<PurchaseOrderList />, 'list')) },
      { path: 'purchases/orders/new', handle: crumbs('Purchases', 'New purchase order'), element: guarded('purchases.create', lazyPage(<PurchaseOrderEditor mode="new" />, 'form')) },
      { path: 'purchases/orders/:id', handle: crumbs('Purchases', 'Purchase order'), element: guarded('purchases.view', lazyPage(<PurchaseOrderEditor mode="edit" />, 'form')) },
      { path: 'purchases/returns', handle: crumbs('Purchases', 'Returns and debit notes'), element: guarded('purchases.view', lazyPage(<PurchaseReturnsList key="purchases" side="purchases" />, 'list')) },
      { path: 'purchases/returns/new', handle: crumbs('Purchases', 'New return'), element: guarded('purchases.create', lazyPage(<PurchaseReturnForm key="new" side="purchases" mode="new" />, 'form')) },
      { path: 'purchases/returns/:id', handle: crumbs('Purchases', 'Return'), element: guarded('purchases.view', lazyPage(<PurchaseReturnForm side="purchases" mode="edit" />, 'form')) },
      { path: 'purchases/debit-notes/new', handle: crumbs('Purchases', 'New debit note'), element: guarded('purchases.create', lazyPage(<DebitNoteForm key="new" side="purchases" mode="new" />, 'form')) },
      { path: 'purchases/debit-notes/:id', handle: crumbs('Purchases', 'Debit note'), element: guarded('purchases.view', lazyPage(<DebitNoteForm side="purchases" mode="edit" />, 'form')) },
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
      // Reports (P9.2): the hub for reports.view; financial statements need reports.financial (DEC-13).
      { path: 'reports', handle: crumbs('Reports'), element: guarded('reports.view', lazyPage(<ReportsCentre />, 'list')) },
      { path: 'reports/trial-balance', handle: crumbs('Reports', 'Trial balance'), element: guarded('reports.financial', lazyPage(<TrialBalance />, 'report')) },
      { path: 'reports/profit-and-loss', handle: crumbs('Reports', 'Profit and loss'), element: guarded('reports.financial', lazyPage(<ProfitAndLoss />, 'report')) },
      { path: 'reports/balance-sheet', handle: crumbs('Reports', 'Balance sheet'), element: guarded('reports.financial', lazyPage(<BalanceSheet />, 'report')) },
      { path: 'reports/cash-flow', handle: crumbs('Reports', 'Cash flow'), element: guarded('reports.financial', lazyPage(<CashFlow />, 'report')) },
      { path: 'reports/general-ledger', handle: crumbs('Reports', 'General ledger'), element: guarded('reports.financial', lazyPage(<GeneralLedger />, 'report')) },
      { path: 'reports/receivables-aging', handle: crumbs('Reports', 'Receivables aging'), element: guarded('reports.financial', lazyPage(<Aging key="customer" type="customer" />, 'report')) },
      { path: 'reports/payables-aging', handle: crumbs('Reports', 'Payables aging'), element: guarded('reports.financial', lazyPage(<Aging key="supplier" type="supplier" />, 'report')) },
      { path: 'reports/sales', handle: crumbs('Reports', 'Sales report'), element: guarded('reports.view', lazyPage(<TradeReport key="sales" side="sales" />, 'report')) },
      { path: 'reports/sales-returns', handle: crumbs('Reports', 'Sales return report'), element: guarded('reports.view', lazyPage(<ReturnReport key="sales" side="sales" />, 'report')) },
      { path: 'reports/purchases', handle: crumbs('Reports', 'Purchase report'), element: guarded('reports.view', lazyPage(<TradeReport key="purchases" side="purchases" />, 'report')) },
      { path: 'reports/purchase-returns', handle: crumbs('Reports', 'Purchase return report'), element: guarded('reports.view', lazyPage(<ReturnReport key="purchases" side="purchases" />, 'report')) },
      { path: 'not-in-release', handle: crumbs('Pluto'), element: <NotInRelease /> },
      // Development-only demo of the async pickers (P1.2-FE-07); not part of production builds.
      ...(PickersDemo ? [{ path: 'dev/pickers', handle: crumbs('Development', 'Pickers'), element: lazyPage(<PickersDemo />, 'form') }] : []),
      ...(DocumentDemo ? [{ path: 'dev/document', handle: crumbs('Development', 'Document editor'), element: lazyPage(<DocumentDemo />, 'form') }] : []),
      { path: '*', handle: crumbs('Not found'), element: <NotFound /> },
    ],
  },
])
