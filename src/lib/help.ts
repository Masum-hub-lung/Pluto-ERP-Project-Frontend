/**
 * PEP-510 page help: a short "how to" for each part of Pluto, found by the current path (the longest matching prefix
 * wins), and the support contacts. Plain words, a few steps each; one place to edit (and to translate to Bangla later).
 */
export interface HelpTopic { title: string; steps: string[]; tip?: string }

/** Support contacts shown in the help panel. Fill in before customers use Pluto; an empty value hides that button. */
export const SUPPORT = {
  whatsapp: '', // international format without + or spaces, e.g. 8801711000000
  email: '', // e.g. support@yourbusiness.com
}

const TOPICS: Array<[string, HelpTopic]> = [
  ['/dashboard', { title: 'Your dashboard', steps: [
    'The tiles show this period’s sales, purchases, what customers owe and your cash and bank. Change the period at the top right.',
    'Click any tile, bar or row to open the details behind it.',
    'Use the tabs (Financial, Sales, Expenses…) for a closer look at one area.',
    'A new company sees a setup checklist here until its first steps are done.'] }],
  ['/sales/invoices/new', { title: 'Write a sales invoice', steps: [
    'Choose the customer: their balance, credit limit and overdue amount appear on the right.',
    'Add items: search by name, code or barcode; pick the unit (pcs, box…) and change the price if needed.',
    'Totals, VAT and “Checks before posting” update as you type: fix anything marked red.',
    'Save draft to finish later, or Save and post: stock goes out and the books update at once.'],
    tip: 'Ctrl S saves, Ctrl Enter posts. Alt S opens a new invoice from anywhere.' }],
  ['/sales', { title: 'Sales', steps: [
    'Invoices: open one to see its payments, PDF and history; filter by status or customer.',
    'Quotations become invoices with one click once the customer accepts.',
    'Payments received: record what a customer pays and choose which invoices it settles.',
    'Returns and credit notes take goods back and reduce what the customer owes.',
    'Repeat an invoice you send regularly (rent, contracts): Pluto writes a draft on each date in Repeating invoices; you post it.'] }],
  ['/purchases/bills/new', { title: 'Enter a purchase bill', steps: [
    'Choose the supplier, the warehouse the goods go to and the supplier’s bill number.',
    'Add the items, quantities and costs; from a purchase order the lines fill themselves.',
    'For an import, switch on import mode and pick the LC: its items and currency fill in.',
    'Post it: stock comes in at this cost and the supplier’s balance goes up.'],
    tip: 'Alt P opens a new bill from anywhere.' }],
  ['/purchases', { title: 'Purchases', steps: [
    'Purchase orders: send them to suppliers, then turn them into bills as goods arrive (part deliveries are fine).',
    'Bills: open one to pay it, see its PDF and attachments.',
    'Payments made: pay suppliers from bank or cash and settle their bills.',
    'Returns and debit notes send goods back and reduce what you owe.'] }],
  ['/customers', { title: 'Customers', steps: [
    'Add a customer with their mobile number; set a credit limit and payment terms if you sell on credit.',
    'Open a customer for their ledger, outstanding invoices, payments and statement.',
    'Send a statement from the customer’s page; print or download it as PDF.',
    'Send payment reminder e-mails the overdue invoices with the statement (at most once a week); Settings › Preferences can send them automatically.'] }],
  ['/suppliers', { title: 'Suppliers', steps: [
    'Add local or international suppliers; international ones can have a currency.',
    'Open a supplier for their ledger, open bills, payments and statement.'] }],
  ['/inventory', { title: 'Inventory', steps: [
    'Items: add products (stocked) or services; give each its units (e.g. 1 box = 12 pcs) and reorder level.',
    'Warehouses: each has its own stock and its own inventory ledger.',
    'Adjustments correct counted stock; transfers move stock between warehouses.',
    'Low stock and valuation show what to reorder and what your stock is worth.'] }],
  ['/banking', { title: 'Cash and bank', steps: [
    'Accounts: add each bank account, cash box and mobile wallet with its opening balance.',
    'Received / paid list every money movement; transfers move money between your accounts.',
    'Reconcile: import the bank’s statement and match each line to Pluto; the difference must reach zero.'] }],
  ['/accounting', { title: 'Accounting', steps: [
    'Vouchers: payment, receipt, contra and journal entries; debits must equal credits before you can post.',
    'Chart of accounts: add ledgers under the right group; opening balances go in once.',
    'Financial years and periods: lock a finished month so nobody changes it by mistake.'],
    tip: 'Alt J journal, Alt Y payment, Alt R receipt, Alt C contra.' }],
  ['/reports', { title: 'Reports', steps: [
    'Pick a report, then the dates or period at the top; the green checks show it agrees with the books.',
    'Click a figure to see the entries behind it.',
    'Print, or export to Excel, PDF or CSV (large reports are prepared in the background).'] }],
  ['/lc/new', { title: 'Open a letter of credit', steps: [
    'Choose the supplier (beneficiary), the bank, currency, amount and expiry.',
    'Enter the items the LC covers: quantity and unit cost. Bills from this LC will fill themselves.',
    'Submit to the bank, then mark it opened with the bank’s reference.'] }],
  ['/lc', { title: 'Letters of credit', steps: [
    'Each LC moves from draft → submitted → opened → shipped → closed; deadlines are flagged 7 days ahead.',
    'Add charges (margin, commission, insurance…), shipments and documents on the LC’s page.',
    'Receive goods: a bill from the LC brings in only its items; landed cost spreads the charges onto the stock.',
    'Banks and limits, loans (PAD/LTR) and FX revaluation are in the LC menu if your plan includes LC finance.'] }],
  ['/settings/users', { title: 'Users and roles', steps: [
    'Invite people by e-mail and give each a role (Owner, Accountant, Store keeper, Sales staff, Viewer).',
    'Roles decide what each person can see and do; copy a role to make your own.',
    'Deactivate someone who leaves: their history stays, they can no longer sign in.'] }],
  ['/settings', { title: 'Settings', steps: [
    'Company profile: address, BIN/TIN, logo and brand colour (used on invoices).',
    'Tax: your VAT rules; Invoice design: what your invoices look like.',
    'Backup and export: automatic backups, the month-end pack, and Export all my data (Owner).'] }],
  ['/platform', { title: 'Platform console', steps: [
    'Companies: create one for a new customer, change its plan, record payments, open it read-only or as Owner.',
    'Plans: users, branches and modules each plan includes.',
    'Announcements: a banner every company sees until they close it.'] }],
]

const GENERAL: HelpTopic = { title: 'Using Pluto', steps: [
  'Ctrl K opens the search: find any customer, item, invoice or page by typing.',
  'The + Create button (top right) starts a new invoice, bill, receipt, payment or voucher.',
  'Every list can be filtered and exported; every record has a History tab showing who changed what.'] }

/** The help for a path: the topic with the longest matching prefix, or the general one. */
export function helpFor(path: string): HelpTopic {
  const p = path.split(/[?#]/)[0] ?? '/'
  let best: [string, HelpTopic] | null = null
  for (const t of TOPICS) {
    if ((p === t[0] || p.startsWith(`${t[0]}/`)) && (!best || t[0].length > best[0].length)) best = t
  }
  return best ? best[1] : GENERAL
}

/** WhatsApp link with the company and page filled in; null when no support number is set. */
export function whatsappLink(company: string | undefined, page: string, number: string = SUPPORT.whatsapp): string | null {
  const n = number.replace(/\D/g, '')
  if (!n) return null
  const text = `Hello Pluto support. Company: ${company ?? '-'}. Page: ${page}. My question: `
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`
}
