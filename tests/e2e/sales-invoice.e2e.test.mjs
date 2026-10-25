/**
 * End-to-end for phase 5 (backlog P5.3-VAL-01, the invoice part of TC-E2E-001 "Bill a customer"): sales invoices
 * E2–E6 against the real API and MySQL. The owner sets up a warehouse, a customer with a credit limit, two stocked
 * products and a service, and brings stock in with a posted purchase bill (API). Sales staff then invoice 2 products +
 * 1 service through the UI: the credit-limit warning shows but does not block, the draft is previewed as a PDF and
 * posted with a double click giving one journal entry; stock falls, COGS is taken at the average cost and the E5
 * ledger entries follow 06 §5. Too little stock is refused in the post dialog; bulk post names the draft that failed;
 * a cancelled invoice brings its stock back (D9). Viewer is read-only, the Store keeper gets 403, `pluto:integrity`
 * passes.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { OWNER, SALES, STORE, VIEWER, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

function artisan(args) {
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}

/**
 * In-app navigation (history.pushState + popstate, as a link click would): a full page.goto() reloads the SPA, which
 * renews the session with /auth/refresh each time; a reload that interrupts a rotation makes the next refresh present
 * the old token, which the API treats as reuse and ends the session (07 §3.2). Staying inside the app avoids that race.
 */
async function go(page, path) {
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

const ids = {}
const inv = {}
const onHand = (product) => sqlRows(`SELECT qty_on_hand FROM stock_balances WHERE product_id=${product} AND warehouse_id=${ids.warehouse}`)[0]?.[0]

test('owner sets up a customer, a warehouse, items and stock (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const branch = (await api('GET', '/branches')).body.data[0]
  const wh = await api('POST', '/warehouses', { code: 'WH-CTG', name: 'Chattogram depot', branch_id: branch.id })
  assert.equal(wh.status, 201, JSON.stringify(wh.body))
  ids.warehouse = wh.body.data.id
  const cus = await api('POST', '/parties', { party_type: 'customer', name: 'Rahman Super Shop', mobile: '01811458230', credit_limit: '50000.00' })
  assert.equal(cus.status, 201, JSON.stringify(cus.body))
  ids.customer = cus.body.data.id
  // The purchase-bill E2E (run earlier in the full suite) already made this supplier; alone, this file makes it.
  const suppliers = (await api('GET', '/parties?type=supplier&per_page=5')).body.data
  ids.supplier = suppliers[0]?.id ?? (await api('POST', '/parties', { party_type: 'supplier', name: 'Bengal Edible Oils', mobile: '01711000777' })).body.data.id
  const unit = (await api('GET', '/units?per_page=100')).body.data[0]
  const income = (await api('GET', '/ledgers?purpose=income_for_product&per_page=100')).body.data[0]
  const product = async (name, type, price) => {
    const r = await api('POST', '/products', { item_type: type, name, unit_id: unit.id, selling_price: price, income_ledger_id: income.id })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.data.id
  }
  ids.ghee = await product('Pran ghee 1kg tin', 'product', '950.00')
  ids.rice = await product('Chinigura rice 25kg', 'product', '2400.00')
  ids.trip = await product('Home delivery', 'service', '150.00')
  const bill = await api('POST', '/purchase-bills', { party_id: ids.supplier, supplier_bill_no: 'SAL-E2E-1', bill_date: today, warehouse_id: ids.warehouse,
    lines: [{ product_id: ids.ghee, quantity: '100', unit_cost: '800.00' }, { product_id: ids.rice, quantity: '20', unit_cost: '2000.00' }] })
  assert.equal(bill.status, 201, JSON.stringify(bill.body))
  assert.equal((await api('POST', `/purchase-bills/${bill.body.data.id}/post`, {})).status, 200)
  assert.deepEqual([onHand(ids.ghee), onHand(ids.rice)], ['100.000', '20.000'])
  await context.close()
})

/** A new invoice: customer, the depot, then [search, qty] lines. */
async function fillInvoice(page, lines) {
  await go(page, '/sales/invoices/new')
  await page.getByTestId('invoice-form').waitFor()
  await page.locator('#doc-party').fill('Rahman')
  await page.getByRole('listbox').getByRole('option', { name: /Rahman Super Shop/ }).click()
  await page.getByTestId('party-balance').waitFor()
  await page.locator('#doc-warehouse').selectOption(String(ids.warehouse))
  for (const [i, [search, qty]] of lines.entries()) {
    if (i > 0) await page.getByTestId('add-line').click()
    await page.getByLabel(`Item, line ${i + 1}`).fill(search)
    await page.getByRole('listbox').getByRole('option').first().click()
    await page.getByLabel(`Quantity, line ${i + 1}`).fill(qty)
  }
}

async function saveDraft(page) {
  await page.getByTestId('save-draft').click()
  await page.waitForURL(/invoices\/\d+\/edit$/)
  return Number(/invoices\/(\d+)\/edit/.exec(page.url())[1])
}

test('sales staff invoice 2 products + 1 service: warning, preview, post once, stock and ledger entries', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, SALES)

  await go(page, '/sales/invoices')
  await page.getByText('No sales invoices yet').waitFor()
  await page.getByTestId('new-invoice').click()
  await page.getByTestId('save-draft').click()
  await page.getByText('Choose the customer').first().waitFor()

  // 40 ghee @ 950 + 12 rice @ 2,400 + 2 deliveries @ 150 = 67,100.00, over the 50,000 credit limit (warning only)
  await fillInvoice(page, [['Pran ghee', '40'], ['Chinigura', '12'], ['Home delivery', '2']])
  assert.equal(await page.getByLabel('Price, line 1').inputValue(), '950.00', 'the selling price fills in')
  await page.getByTestId('total-total').getByText('67,100.00').waitFor()
  await page.getByTestId('invoice-warnings').getByText(/credit limit/).waitFor()
  inv.main = await saveDraft(page)
  await page.getByText(/Draft INV-\d{4}-0001 saved/).waitFor()

  // E4: the PDF, fetched with the token
  await page.getByRole('button', { name: 'Preview' }).click()
  await page.waitForURL(/preview$/)
  await page.getByTestId('preview-pdf').waitFor()
  assert.match(await page.getByTestId('preview-pdf').getAttribute('src'), /^blob:/)
  await page.getByRole('button', { name: 'Back to edit' }).click()
  await page.getByTestId('invoice-form').waitFor()
  await page.getByTestId('total-total').getByText('67,100.00').waitFor()

  // Post: a double click sends one request; toast; back to E2
  let posts = 0
  page.on('request', (r) => { if (r.method() === 'POST' && /\/sales-invoices\/\d+\/post$/.test(r.url())) posts++ })
  await page.getByTestId('save-post').click()
  await page.getByTestId('post-dialog').waitFor()
  await page.getByTestId('confirm-post').dblclick()
  await page.getByText(/INV-\d{4}-0001 posted/).waitFor()
  await page.waitForURL(/\/sales\/invoices$/)
  assert.equal(posts, 1, 'one post request')
  assert.deepEqual(sqlRows(`SELECT COUNT(*) FROM journal_entries WHERE source_type='sales_invoices' AND source_id=${inv.main}`), [['1']], 'one journal entry')
  assert.deepEqual([onHand(ids.ghee), onHand(ids.rice)], ['60.000', '8.000'], 'stock reduced; the service has none')

  // E5 ledger entries (06 §5): Dr customer 67,100 · Cr income 67,100 · Dr COGS = Cr inventory = 40×800 + 12×2,000 = 56,000
  await go(page, `/sales/invoices/${inv.main}`)
  await page.getByTestId('invoice-status').getByText(/Unpaid|Overdue/).waitFor()
  await page.getByRole('tab', { name: 'Ledger entries' }).click()
  const ledger = await page.getByTestId('ledger-entries').innerText()
  assert.match(ledger, /Rahman Super Shop[\s\S]*67,100\.00/)
  assert.match(ledger, /Cost of goods sold[\s\S]*56,000\.00/)
  assert.match(ledger, /1301-\d+[\s\S]*56,000\.00/)
  assert.deepEqual(sqlRows(`SELECT SUM(debit) = SUM(credit), SUM(debit) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.source_type='sales_invoices' AND je.source_id=${inv.main}`), [['1', '123100.00']])
  assert.deepEqual(sqlRows(`SELECT unit_cost FROM sales_invoice_lines WHERE sales_invoice_id=${inv.main} ORDER BY line_no`), [['800.0000'], ['2000.0000'], ['NULL']])

  // D9 links the sale back to E5
  await go(page, `/inventory/movements?product_id=${ids.ghee}`)
  await page.locator('tbody a', { hasText: /INV-\d{4}-0001/ }).click()
  await page.getByTestId('invoice-number').getByText(/INV-\d{4}-0001/).waitFor()

  await page.setViewportSize(VIEWPORTS.phone)
  for (const u of ['/sales/invoices', '/sales/invoices/new', `/sales/invoices/${inv.main}`, `/sales/invoices/${inv.main}/preview`]) {
    await go(page, u); await page.waitForTimeout(300); await assertNoPageScroll(page, u)
  }
  assert.deepEqual(errors, [])
  await context.close()
})

test('too little stock: warned under the line, refused in the post dialog; bulk post names the failed draft', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, SALES)
  await fillInvoice(page, [['Chinigura', '50']])
  await page.getByTestId('line-errors-0').getByText(/Only 8 .* Chattogram depot/).waitFor()
  inv.short = await saveDraft(page)
  await page.getByTestId('save-post').click()
  await page.getByTestId('confirm-post').click()
  await page.getByTestId('post-dialog').getByText('Not enough stock').waitFor()
  assert.match(await page.getByTestId('post-dialog').innerText(), /Only 8\.000 on hand in Chattogram depot/, 'the shortage is listed per line')
  await page.getByRole('button', { name: 'Not now' }).click()

  await fillInvoice(page, [['Pran ghee', '5']])
  inv.small = await saveDraft(page)
  await go(page, '/sales/invoices?tab=draft')
  await page.locator('tbody input[type=checkbox]').nth(1).waitFor() // real rows, not the loading skeleton
  for (const box of await page.locator('tbody input[type=checkbox]').all()) await box.check()
  await page.getByTestId('bulk-post').click()
  await page.getByRole('button', { name: 'Post', exact: true }).last().click()
  const failures = await page.getByTestId('bulk-post-failures').innerText()
  assert.match(failures, /INV-\d{4}-0002: .*more stock/)
  await page.getByRole('button', { name: 'Done' }).click()
  assert.deepEqual(sqlRows(`SELECT status FROM sales_invoices WHERE id IN (${inv.short}, ${inv.small}) ORDER BY id`), [['draft'], ['posted']])
  assert.equal(onHand(ids.ghee), '55.000')
  assert.deepEqual(errors, [])
  await context.close()
})

test('a posted invoice is cancelled with a reason; its stock comes back', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, SALES)
  await go(page, `/sales/invoices/${inv.small}`)
  await page.getByTestId('cancel-invoice').click()
  await page.getByTestId('confirm-cancel').click()
  await page.getByText('Choose why the invoice is cancelled').waitFor()
  await page.locator('#cancel-reason').selectOption('customer_cancelled')
  await page.getByTestId('confirm-cancel').click()
  await page.getByText(/INV-\d{4}-0003 cancelled/).waitFor()
  await page.getByTestId('invoice-status').getByText('Cancelled').waitFor()
  assert.equal(onHand(ids.ghee), '60.000')
  assert.deepEqual(sqlRows(`SELECT COUNT(*) FROM journal_entries WHERE reverses_entry_id IN (SELECT journal_entry_id FROM sales_invoices WHERE id=${inv.small})`), [['1']])
  await go(page, `/inventory/movements?product_id=${ids.ghee}`)
  await page.locator('tbody tr', { hasText: 'Reversal' }).first().waitFor()
  // Sales staff may not delete drafts (no sales.delete)
  await go(page, `/sales/invoices/${inv.short}/edit`)
  await page.getByTestId('invoice-form').waitFor()
  assert.equal(await page.getByTestId('delete-draft').count(), 0)
  assert.deepEqual(errors, [])
  await context.close()
})

test('viewer reads invoices only; the store keeper gets 403', async () => {
  const viewer = await newPage()
  await signIn(viewer.page, VIEWER)
  await go(viewer.page, `/sales/invoices/${inv.main}`)
  await viewer.page.getByTestId('invoice-number').waitFor()
  for (const t of ['send-invoice', 'cancel-invoice', 'edit-invoice', 'post-invoice']) assert.equal(await viewer.page.getByTestId(t).count(), 0, `${t} hidden`)
  await go(viewer.page, '/sales/invoices')
  await viewer.page.locator('tbody tr').first().waitFor()
  assert.equal(await viewer.page.getByTestId('new-invoice').count(), 0)
  await viewer.context.close()

  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, STORE)
  await go(page, '/sales/invoices')
  await page.getByText(/permission|not allowed|access/i).first().waitFor()
  assert.equal((await api('GET', `/sales-invoices/${inv.main}`)).status, 403)
  assert.equal((await api('POST', `/sales-invoices/${inv.short}/post`, {})).status, 403)
  await context.close()
})

test('books integrity check passes', () => {
  const out = artisan(['pluto:integrity'])
  assert.doesNotMatch(out, /\d+ failed/, out)
})
