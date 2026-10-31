import { useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { useListParams } from '../../lib/useListParams'

/**
 * J1 Reports centre (backlog P9.2-FE-06; 02 #page-j1): find any report. Statements, books, receivables/payables and
 * operations as cards with their module tag; J2–J18 reuse the module pages, and reports not built yet say "Not in
 * this release". A card shows only when the user may open it (financial statements need reports.financial, DEC-13).
 */
interface ReportLink { label: string; description: string; path: string; permission: string; module: string; built: boolean }

export const REPORT_SECTIONS: Array<{ title: string; reports: ReportLink[] }> = [
  { title: 'Financial statements', reports: [
    { label: 'Trial balance', description: 'Closing debit and credit of every ledger as of a date.', path: '/reports/trial-balance', permission: 'reports.financial', module: 'Accounting', built: true },
    { label: 'Profit and loss', description: 'Revenue, cost of sales, expenses and net profit for a period.', path: '/reports/profit-and-loss', permission: 'reports.financial', module: 'Accounting', built: true },
    { label: 'Balance sheet', description: 'Assets, liabilities and equity as of a date.', path: '/reports/balance-sheet', permission: 'reports.financial', module: 'Accounting', built: true },
    { label: 'Cash flow statement', description: 'Where cash came from and went, reconciled to cash and bank.', path: '/reports/cash-flow', permission: 'reports.financial', module: 'Accounting', built: true },
  ] },
  { title: 'Books', reports: [
    { label: 'General ledger', description: 'Opening, entries and closing of the ledgers you choose.', path: '/reports/general-ledger', permission: 'reports.financial', module: 'Accounting', built: true },
    { label: 'Ledgers', description: 'Any ledger’s statement with a running balance.', path: '/accounting/ledgers', permission: 'accounting.view', module: 'Accounting', built: true },
    { label: 'Day book', description: 'Every voucher in date order.', path: '/accounting/vouchers', permission: 'accounting.view', module: 'Accounting', built: true },
    { label: 'Cash book', description: 'Receipts and payments of a cash account.', path: '/banking/cash-book', permission: 'banking.view', module: 'Cash and bank', built: false },
    { label: 'Bank book', description: 'Deposits and withdrawals of a bank account.', path: '/banking/bank-book', permission: 'banking.view', module: 'Cash and bank', built: false },
  ] },
  { title: 'Receivables and payables', reports: [
    { label: 'Receivables aging', description: 'What customers owe by days past due.', path: '/reports/receivables-aging', permission: 'reports.financial', module: 'Customers', built: true },
    { label: 'Payables aging', description: 'What suppliers are owed by days past due.', path: '/reports/payables-aging', permission: 'reports.financial', module: 'Suppliers', built: true },
    { label: 'Customer outstanding', description: 'Open balances per customer, with statements to send.', path: '/customers/outstanding', permission: 'parties.view', module: 'Customers', built: true },
    { label: 'Supplier outstanding', description: 'What you owe each supplier.', path: '/suppliers/outstanding', permission: 'parties.view', module: 'Suppliers', built: true },
  ] },
  { title: 'Operations', reports: [
    { label: 'Sales report', description: 'Sales by customer, category or month.', path: '/reports/sales', permission: 'reports.view', module: 'Sales', built: true },
    { label: 'Sales return report', description: 'Every return from customers and its credit note.', path: '/reports/sales-returns', permission: 'reports.view', module: 'Sales', built: true },
    { label: 'Purchase report', description: 'Purchases by supplier, category or month.', path: '/reports/purchases', permission: 'reports.view', module: 'Purchases', built: true },
    { label: 'Purchase return report', description: 'Every return to suppliers and its debit note.', path: '/reports/purchase-returns', permission: 'reports.view', module: 'Purchases', built: true },
    { label: 'Income report', description: 'Income by category and month.', path: '/income/report', permission: 'reports.view', module: 'Income', built: false },
    { label: 'Expense report', description: 'Expenses by category and month.', path: '/expenses/report', permission: 'reports.view', module: 'Expenses', built: false },
    { label: 'Stock valuation', description: 'Stock value at weighted average cost.', path: '/inventory/valuation', permission: 'inventory.view_costs', module: 'Inventory', built: false },
    { label: 'Stock movements', description: 'Every stock in and out.', path: '/inventory/movements', permission: 'inventory.view', module: 'Inventory', built: true },
  ] },
]

export function ReportsCentre() {
  const { PageHeader, Input, Badge, EmptyState, Icon } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const { search, setSearch } = useListParams()
  const term = search.trim().toLowerCase()
  const sections = REPORT_SECTIONS.map((s) => ({ ...s, reports: s.reports.filter((r) => can(r.permission)
    && (!term || `${r.label} ${r.description} ${r.module}`.toLowerCase().includes(term))) })).filter((s) => s.reports.length > 0)

  return (
    <>
      <PageHeader title="Reports" description="Find any report: statements, books, receivables and payables, operations. Reports read posted vouchers only." />
      <div style={{ maxWidth: 420, marginBottom: 16 }}>
        <Input icon="search" placeholder="Find a report" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a report" />
      </div>
      {sections.length === 0 && <EmptyState icon="search" title="No report matches" description={term ? `Nothing called “${search.trim()}”. Try another word.` : 'Your role does not include any reports.'} />}
      {sections.map((s) => (
        <section key={s.title} style={{ marginBottom: 24 }} aria-label={s.title}>
          <h2 style={{ font: '600 15px/22px var(--font-sans)', margin: '0 0 8px', color: 'var(--ink)' }}>{s.title}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 16,width: '100%',boxSizing: 'border-box',alignItems: 'stretch', }}>
            {s.reports.map((r) => (
              <button key={r.path} type="button" className="lf-report-card" data-testid={`report-${r.path}`} onClick={() => navigate(r.built ? r.path : '/not-in-release')}
                style={{ textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 16, minHeight: 150,
                  cursor: 'pointer', display: 'grid', gap: 8, alignContent: 'start', minWidth: 0, overflowWrap: 'anywhere', font: 'inherit', color: 'var(--ink)' }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{r.label}</strong><Icon name="arrow-right" size={16} />
                </span>
                <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{r.description}</span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Badge tone="neutral">{r.module}</Badge>{!r.built && <Badge tone="warning">Not in this release</Badge>}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
