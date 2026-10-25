/**
 * End-to-end for phase 6 (backlog P6.3-VAL-01; named settlements.e2e so it runs after purchase-bill and sales-invoice,
 * whose empty states it would otherwise fill): TC-E2E-001 "Bill a customer" complete — sign in → a customer with an
 * opening balance (B2) → E3 invoice → E4 preview → post → E7 receipt applied oldest first → B6 ledger shows the
 * opening, the invoice and the receipt with a running balance that equals B4 → B8 statement and its PDF. Also: the
 * cheque fields are required, a receipt larger than the open invoices keeps the rest as an advance (server figure),
 * cancelling an invoice with a receipt applied turns the receipt into an advance, and `pluto:integrity` passes
 * (incl. opening balance adjustment = sum of openings). Navigation stays inside the app (see sales-invoice.e2e).
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { ACCOUNTANT, OWNER, apiFor, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

function artisan(args) {
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}

async function go(page, path) {
  await page.waitForLoadState('networkidle') // let the landing redirect after sign-in finish first
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

const ids = {}

test('owner sets up a warehouse, a stocked item, a service and a bank account (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const branch = (await api('GET', '/branches')).body.data[0]
  ids.warehouse = (await api('POST', '/warehouses', { code: 'WH-SYL', name: 'Sylhet depot', branch_id: branch.id })).body.data.id
  const suppliers = (await api('GET', '/parties?type=supplier&per_page=5')).body.data
  const supplier = suppliers[0]?.id ?? (await api('POST', '/parties', { party_type: 'supplier', name: 'Bengal Edible Oils', mobile: '01711000777' })).body.data.id
  const unit = (await api('GET', '/units?per_page=100')).body.data[0]
  const income = (await api('GET', '/ledgers?purpose=income_for_product&per_page=100')).body.data[0]
  ids.mustard = (await api('POST', '/products', { item_type: 'product', name: 'Radhuni mustard oil 1L', unit_id: unit.id, selling_price: '320.00', income_ledger_id: income.id })).body.data.id
  ids.trip = (await api('POST', '/products', { item_type: 'service', name: 'Van delivery', unit_id: unit.id, selling_price: '200.00', income_ledger_id: income.id })).body.data.id
  const bill = await api('POST', '/purchase-bills', { party_id: supplier, supplier_bill_no: 'BAC-E2E-1', bill_date: today, warehouse_id: ids.warehouse,
    lines: [{ product_id: ids.mustard, quantity: '200', unit_cost: '250.00' }] })
  assert.equal(bill.status, 201, JSON.stringify(bill.body))
  assert.equal((await api('POST', `/purchase-bills/${bill.body.data.id}/post`, {})).status, 200)
  const bank = await api('POST', '/money-accounts', { account_type: 'bank', bank_name: 'Dutch-Bangla Bank', account_name: 'Meghna Traders Ltd.', account_number: '1051100045219', opening_balance: '250000.00' })
  assert.equal(bank.status, 201, JSON.stringify(bank.body))
  ids.bank = bank.body.data.id
  assert.equal(bank.body.data.book_balance, '250000.00')
  await context.close()
})

test('TC-E2E-001: bill a customer — opening, invoice, preview, post, receipt, ledger, statement', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, ACCOUNTANT)

  // B2: a customer who already owed ৳ 1,85,000 when the books started (TC-ACC-014)
  await go(page, '/customers/new')
  await page.locator('#f-name').fill('Sylhet Traders')
  await page.locator('#f-mobile').fill('01715000321')
  await page.locator('#f-opening').fill('185000.00')
  await page.getByRole('button', { name: /^Save customer/ }).click()
  await page.waitForURL(/\/customers\/\d+$/)
  ids.customer = Number(/customers\/(\d+)/.exec(page.url())[1])
  await page.getByTestId('customer-balance').getByText(/1,85,000\.00 Dr/).waitFor()

  // E3 → E4 → post: 20 jars @ 320 + 1 delivery @ 200 = 6,600.00
  await go(page, '/sales/invoices/new')
  await page.getByTestId('invoice-form').waitFor()
  await page.locator('#doc-party').fill('Sylhet')
  await page.getByRole('listbox').getByRole('option', { name: /Sylhet Traders/ }).click()
  await page.getByTestId('party-balance').waitFor()
  await page.locator('#doc-warehouse').selectOption(String(ids.warehouse))
  await page.getByLabel('Item, line 1').fill('Radhuni')
  await page.getByRole('listbox').getByRole('option').first().click()
  await page.getByLabel('Quantity, line 1').fill('20')
  await page.getByTestId('add-line').click()
  await page.getByLabel('Item, line 2').fill('Van delivery')
  await page.getByRole('listbox').getByRole('option').first().click()
  await page.getByLabel('Quantity, line 2').fill('1')
  await page.getByTestId('total-total').getByText('6,600.00').waitFor()
  await page.getByTestId('save-draft').click()
  await page.waitForURL(/invoices\/\d+\/edit$/)
  ids.invoice = Number(/invoices\/(\d+)\/edit/.exec(page.url())[1])
  await page.getByRole('button', { name: 'Preview' }).click()
  await page.getByTestId('preview-pdf').waitFor()
  await page.getByTestId('preview-post').click()
  await page.getByTestId('confirm-post').click()
  await page.getByText(/INV-\d{4}-\d{4} posted/).waitFor()
  await page.getByTestId('invoice-status').getByText(/Unpaid/).waitFor()

  // E7 from E5 "Record payment": the invoice's balance is prefilled; a cheque needs its details
  await page.getByTestId('header-record-payment').click()
  await page.waitForFunction(() => document.querySelector('#rc-amount')?.value === '6600.00')
  await page.locator('#rc-account').selectOption(String(ids.bank))
  await page.locator('#rc-method').selectOption('cheque')
  await page.getByTestId('save-receipt').click()
  await page.getByText('Enter the cheque number').waitFor()
  await page.locator('#rc-chq').fill('448133')
  await page.locator('#rc-chqdate').fill(today)
  await page.locator('#rc-drawn').fill('Islami Bank, Zindabazar')
  await page.getByTestId('apply-mode').getByText('Oldest first').click()
  await page.getByTestId('save-receipt').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Save receipt' }).click()
  await page.waitForURL(/\/sales\/payments\/\d+$/)
  await page.getByTestId('receipt-unapplied').getByText('৳ 0.00').waitFor()
  await page.getByTestId(`alloc-${ids.invoice}`).click()
  await page.getByTestId('invoice-status').getByText('Paid').waitFor()

  // B6: opening, invoice and receipt with a running balance; closing = B4 balance
  await go(page, `/customers/${ids.customer}/ledger`)
  await page.getByTestId('party-ledger').getByText('Opening balance', { exact: true }).waitFor() // real rows, not the loading skeleton
  await page.getByTestId('party-ledger').getByText(/RV-\d{4}-\d{4}/).waitFor()
  const ledger = await page.getByTestId('party-ledger').innerText()
  assert.match(ledger, /Opening balance[\s\S]*1,85,000\.00 Dr/)
  assert.match(ledger, /INV-\d{4}-\d{4}[\s\S]*6,600\.00[\s\S]*1,91,600\.00 Dr/)
  assert.match(ledger, /RV-\d{4}-\d{4}[\s\S]*6,600\.00[\s\S]*1,85,000\.00 Dr/)
  await page.getByTestId('ledger-closing').getByText(/1,85,000\.00 Dr/).waitFor()
  await go(page, `/customers/${ids.customer}`)
  await page.getByTestId('customer-balance').getByText(/1,85,000\.00 Dr/).waitFor()

  // B8: statement and its PDF
  await go(page, `/customers/${ids.customer}/statement`)
  await page.getByTestId('statement-lines').getByText(/RV-\d{4}-\d{4}/).waitFor()
  await page.getByTestId('statement-closing').getByText('৳ 1,85,000.00').waitFor()
  const download = page.waitForEvent('download')
  await page.getByTestId('statement-pdf').click()
  assert.match((await download).suggestedFilename(), /^statement-CUS-\d{4}\.pdf$/)
  assert.deepEqual(errors, [])
  await context.close()
})

test('a receipt larger than the open invoices keeps the rest as an advance; cancelling an invoice frees its receipt', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, ACCOUNTANT)
  const inv = await api('POST', '/sales-invoices', { party_id: ids.customer, invoice_date: today, warehouse_id: ids.warehouse, lines: [{ product_id: ids.trip, quantity: '10' }] }) // 2,000
  assert.equal(inv.status, 201, JSON.stringify(inv.body))
  assert.equal((await api('POST', `/sales-invoices/${inv.body.data.id}/post`, {})).status, 200)

  await go(page, `/sales/payments/new?party_id=${ids.customer}`)
  await page.waitForFunction(() => document.querySelector('#rc-party')?.value?.includes('Sylhet Traders'))
  await page.locator('#rc-amount').fill('5000.00')
  await page.locator('#rc-account').selectOption(String(ids.bank))
  await page.getByTestId('save-receipt').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Save receipt' }).click()
  await page.waitForURL(/\/sales\/payments\/\d+$/)
  await page.getByTestId('receipt-unapplied').getByText('৳ 3,000.00').waitFor() // the server's figure
  ids.receipt = Number(/payments\/(\d+)/.exec(page.url())[1])

  // Cancel the invoice the receipt paid: the 2,000 is free again (BR-024, TC-SAL-012)
  await go(page, `/sales/invoices/${inv.body.data.id}`)
  await page.getByTestId('cancel-invoice').click()
  await page.locator('#cancel-reason').selectOption('customer_cancelled')
  await page.getByTestId('confirm-cancel').click()
  await page.getByTestId('invoice-status').getByText('Cancelled').waitFor()
  await go(page, `/sales/payments/${ids.receipt}`)
  await page.getByTestId('receipt-unapplied').getByText('৳ 5,000.00').waitFor()
  assert.deepEqual(sqlRows(`SELECT unapplied_amount FROM payment_details WHERE journal_entry_id=${ids.receipt}`), [['5000.00']])
  assert.deepEqual(errors, [])
  await context.close()
})

test('books integrity check passes, opening balance adjustment included', () => {
  const out = artisan(['pluto:integrity'])
  assert.match(out, /opening balance adjustment = sum of openings/)
  assert.doesNotMatch(out, /\d+ failed/, out)
})
