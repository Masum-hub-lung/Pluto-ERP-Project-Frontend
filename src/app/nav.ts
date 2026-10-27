/**
 * Navigation registry (02 S0 sidebar, 08 §3 routes): every module and page from the design, its view permission and
 * whether it is built. The sidebar, the landing route, unbuilt-page routes and quick-create all read this file —
 * when a page is built, flip `built` and add its route in router.tsx.
 */
export interface NavLink { label: string; path: string; permission: string | null; built: boolean }
export interface NavItem extends NavLink { icon: string; children?: NavLink[] }
export interface NavSection { label?: string; items: NavItem[] }

const page = (label: string, path: string, permission: string | null, built = false): NavLink => ({ label, path, permission, built })

export const NAV: NavSection[] = [
  { items: [{ ...page('Dashboard', '/dashboard', 'dashboard.view'), icon: 'layout-dashboard' }] },
  {
    label: 'Operations',
    items: [
      { ...page('Sales', '/sales', 'sales.view'), icon: 'receipt-text', children: [
        page('Overview', '/sales', 'sales.view'), page('Invoices', '/sales/invoices', 'sales.view', true), page('Quotations', '/sales/quotations', 'sales.view'),
        page('Payments received', '/sales/payments', 'sales.view', true), page('Returns and credit notes', '/sales/returns', 'sales.view'),
        page('Reports', '/reports/sales', 'reports.view'),
      ] },
      { ...page('Purchases', '/purchases', 'purchases.view'), icon: 'shopping-cart', children: [
        page('Overview', '/purchases', 'purchases.view'), page('Bills', '/purchases/bills', 'purchases.view', true), page('Purchase orders', '/purchases/orders', 'purchases.view'),
        page('Payments made', '/purchases/payments', 'purchases.view', true), page('Returns and debit notes', '/purchases/returns', 'purchases.view'),
        page('Reports', '/reports/purchases', 'reports.view'),
      ] },
      { ...page('LC Management', '/lc', 'lc.view'), icon: 'file-text' },
      { ...page('Customers', '/customers', 'parties.view', true), icon: 'users', children: [
        page('All customers', '/customers', 'parties.view', true), page('Add customer', '/customers/new', 'parties.create', true),
        page('Outstanding', '/customers/outstanding', 'parties.view', true),
      ] },
      { ...page('Suppliers', '/suppliers', 'parties.view', true), icon: 'truck', children: [
        page('All suppliers', '/suppliers', 'parties.view', true), page('Add supplier', '/suppliers/new', 'parties.create', true),
        page('Outstanding', '/suppliers/outstanding', 'parties.view', true),
      ] },
      { ...page('Inventory', '/inventory', 'inventory.view', true), icon: 'package', children: [
        page('Products', '/inventory/products', 'inventory.view', true), page('Categories', '/inventory/categories', 'inventory.view', true),
        page('Stock groups', '/inventory/stock-groups', 'inventory.view', true), page('Warehouses', '/inventory/warehouses', 'inventory.view', true),
        page('Movements', '/inventory/movements', 'inventory.view', true), page('Adjustments', '/inventory/adjustments', 'inventory.view'),
        page('Transfers', '/inventory/transfers', 'inventory.view'), page('Low stock', '/inventory/low-stock', 'inventory.view'),
        page('Valuation', '/inventory/valuation', 'inventory.view'),
      ] },
    ],
  },
  {
    label: 'Money',
    items: [
      { ...page('Cash and bank', '/banking', 'banking.view'), icon: 'landmark', children: [
        page('Overview', '/banking', 'banking.view'), page('Accounts', '/banking/accounts', 'banking.view', true),
      ] },
      { ...page('Income', '/income', 'banking.view'), icon: 'hand-coins' },
      { ...page('Expenses', '/expenses', 'banking.view'), icon: 'banknote' },
    ],
  },
  {
    label: 'Books',
    items: [
      { ...page('Accounting', '/accounting', 'accounting.view', true), icon: 'book-open-text', children: [
        page('Overview', '/accounting', 'accounting.view', true), page('Chart of accounts', '/accounting/chart', 'accounting.view', true),
        page('Ledgers', '/accounting/ledgers', 'accounting.view', true), page('Vouchers', '/accounting/vouchers', 'accounting.view', true),
      ] },
      { ...page('Reports', '/reports', 'reports.view', true), icon: 'scale', children: [
        page('All reports', '/reports', 'reports.view', true), page('Trial balance', '/reports/trial-balance', 'reports.financial', true),
        page('Profit and loss', '/reports/profit-and-loss', 'reports.financial', true), page('Balance sheet', '/reports/balance-sheet', 'reports.financial', true),
        page('Cash flow', '/reports/cash-flow', 'reports.financial', true), page('General ledger', '/reports/general-ledger', 'reports.financial', true),
        page('Receivables aging', '/reports/receivables-aging', 'reports.financial', true), page('Payables aging', '/reports/payables-aging', 'reports.financial', true),
      ] },
    ],
  },
  // Settings is open to everyone: Security (2-step) is personal; other sections check their own permission.
  { label: 'Admin', items: [{ ...page('Settings', '/settings/security', null, true), icon: 'settings' }] },
]

type Can = (permission: string) => boolean
const allowed = (can: Can, l: NavLink) => l.permission === null || can(l.permission)

/** The sidebar for one role: items and sub-items it may view; sections with nothing left are dropped. */
export function visibleNav(can: Can, nav: NavSection[] = NAV): NavSection[] {
  return nav
    .map((s) => ({ ...s, items: s.items.filter((i) => allowed(can, i)).map((i) => (i.children ? { ...i, children: i.children.filter((c) => allowed(can, c)) } : i)) }))
    .filter((s) => s.items.length > 0)
}

/** Every page in the registry (items and sub-items), each once by path. */
export function allLinks(nav: NavSection[] = NAV): NavLink[] {
  const seen = new Map<string, NavLink>()
  for (const s of nav) for (const i of s.items) for (const l of [i, ...(i.children ?? [])]) if (!seen.has(l.path)) seen.set(l.path, l)
  return [...seen.values()]
}

/** The registry path that best matches the current URL (longest prefix on segment boundaries), or null. */
export function activePath(pathname: string, links: NavLink[] = allLinks()): string | null {
  let best: string | null = null
  for (const l of links) {
    const hit = pathname === l.path || pathname.startsWith(l.path.endsWith('/') ? l.path : `${l.path}/`)
    if (hit && (!best || l.path.length > best.length)) best = l.path
  }
  return best
}

/**
 * R-35 landing page: the first permitted built module, else Customers, else the first permitted module (unbuilt pages
 * say so). Inventory comes before Purchases because R-35 also says "a Store keeper lands on /inventory" and that role
 * can view purchases; no other role is affected (they all have Dashboard or Sales first).
 */
const LANDING = ['/dashboard', '/sales', '/inventory', '/purchases', '/banking', '/accounting', '/reports', '/lc']
export function landingPath(can: Can, links: NavLink[] = allLinks()): string {
  const byPath = new Map(links.map((l) => [l.path, l]))
  const permitted = LANDING.map((p) => byPath.get(p)).filter((l): l is NavLink => !!l && allowed(can, l))
  // Inventory is the Store keeper's home (R-35); roles that see parties keep Customers until Dashboard or Sales exist
  // (Accounting and Reports too, so the Owner and Accountant still land on Customers now that they are built).
  const home = permitted.find((l) => l.built && (!['/inventory', '/accounting', '/reports'].includes(l.path) || !can('parties.view')))
  return home?.path ?? (can('parties.view') ? '/customers' : permitted[0]?.path ?? '/settings/security')
}

/** Topbar quick-create labels (02 L5) → the page that creates it; unbuilt ones answer "not in this release yet". */
export const QUICK_CREATE: Record<string, { path: string; built: boolean }> = {
  'Customer or supplier': { path: '/customers/new', built: true },
  Customer: { path: '/customers/new', built: true },
  Supplier: { path: '/suppliers/new', built: true },
  Product: { path: '/inventory/products/new', built: true },
  'Sales invoice': { path: '/sales/invoices/new', built: true },
  'Purchase bill': { path: '/purchases/bills/new', built: true },
  Receipt: { path: '/sales/payments/new', built: true },
  Payment: { path: '/purchases/payments/new', built: true },
  Journal: { path: '/accounting/vouchers/new/journal', built: true },
}
