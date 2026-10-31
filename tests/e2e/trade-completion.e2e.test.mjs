/**
 * End-to-end for phase 10 (backlog P10.6-VAL-01, trade completion) against the real API and MySQL. The owner sets up a
 * supplier, a customer, a warehouse, a bank account and a stocked product (API). Then through the UI:
 * - F8/F11: a purchase order for 100 jars is converted to a bill; 80 arrive, so the bill is posted for 80 and the order
 *   shows 80 received, 20 still to come (partly received).
 * - E10/E13: a quotation for 60 jars is accepted and converted to a draft invoice, which is posted.
 * - E8/E9: a sales return of 12 of the 60 is restocked and its credit note applied to the invoice; returning 50 more is
 *   refused (only 48 left, BR-022). Two hand-made credit notes: one kept as credit, one refunded from the bank.
 * - F6/F7: a purchase return of 6 jars posts its debit note in the same, single journal entry.
 * - E11/F9/E12: the trade reports match the posted data; E1/F1 overviews load. `pluto:integrity` passes at the end.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { OWNER, VIEWER, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

function artisan(args) {
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}

/** In-app navigation (see sales-invoice.e2e): avoids a full reload racing the refresh-token rotation. */
async function go(page, path) {
  await page.waitForLoadState('networkidle')
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

/** "11400.00" → "11,400.00" (lakh grouping, as formatTaka shows it); only to find the API's figure on the page. */
function lakh(s) {
  const [int, dec] = s.replace('-', '').split('.')
  const last3 = int.slice(-3)
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return `${rest ? `${rest},` : ''}${last3}.${dec ?? '00'}`
}

const ids = {}
const onHand = () => sqlRows(`SELECT qty_on_hand FROM stock_balances WHERE product_id=${ids.product} AND warehouse_id=${ids.warehouse}`)[0]?.[0]

test('owner sets up parties, a warehouse, a bank account and a product (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const branch = (await api('GET', '/branches')).body.data[0]
  const wh = await api('POST', '/warehouses', { code: 'WH-NGJ', name: 'Narayanganj godown', branch_id: branch.id })
  assert.equal(wh.status, 201, JSON.stringify(wh.body))
  ids.warehouse = wh.body.data.id
  const sup = await api('POST', '/parties', { party_type: 'supplier', name: 'Bengal Edible Oils', mobile: '01711000777' })
  assert.equal(sup.status, 201, JSON.stringify(sup.body))
  ids.supplier = sup.body.data.id
  const cus = await api('POST', '/parties', { party_type: 'customer', name: 'Rahman Super Shop', mobile: '01811458230' })
  assert.equal(cus.status, 201, JSON.stringify(cus.body))
  ids.customer = cus.body.data.id
  const bank = await api('POST', '/money-accounts', { account_type: 'bank', bank_name: 'Dutch-Bangla Bank', account_name: 'Meghna Traders Ltd.', account_number: '1051100045220', opening_balance: '100000.00' })
  assert.equal(bank.status, 201, JSON.stringify(bank.body))
  ids.bank = bank.body.data.id
  const unit = (await api('GET', '/units?per_page=100')).body.data[0]
  const income = (await api('GET', '/ledgers?purpose=income_for_product&per_page=100')).body.data[0]
  const prod = await api('POST', '/products', { item_type: 'product', name: 'Teer soybean oil 5L jar', unit_id: unit.id, selling_price: '950.00', income_ledger_id: income.id })
  assert.equal(prod.status, 201, JSON.stringify(prod.body))
  ids.product = prod.body.data.id
  await context.close()
})

/** Picks the party in a document's PartyPanel (#doc-party). */
async function pickParty(page, search, name) {
  await page.locator('#doc-party').fill(search)
  await page.getByRole('listbox').getByRole('option', { name }).click()
}

async function fillLine(page, qty, cost) {
  await page.getByLabel('Item, line 1').fill('Teer')
  await page.getByRole('listbox').getByRole('option', { name: /Teer soybean oil 5L jar/ }).click()
  await page.getByLabel('Quantity, line 1').fill(qty)
  if (cost) await page.getByLabel('Cost, line 1').fill(cost)
}

/** The confirm button of the open dialog (its label can repeat the button that opened it). */
const confirm = (page, name) => page.getByRole('button', { name, exact: true }).last().click()

test('purchase order → bill: 80 of 100 arrive, the order is partly received', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/purchases/orders')
  await page.getByTestId('new-document').click()
  await page.getByTestId('order-form').waitFor()
  await pickParty(page, 'Bengal', /Bengal Edible Oils/)
  await page.locator('#po-wh').selectOption(String(ids.warehouse))
  await fillLine(page, '100', '800')
  await page.getByTestId('total-total').getByText('80,000.00').waitFor()
  const entries = sqlRows('SELECT COUNT(*) FROM journal_entries')
  await page.getByTestId('save-draft').click()
  await page.getByText(/Purchase order PO-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/\/purchases\/orders\/\d+$/)
  ids.po = Number(/orders\/(\d+)$/.exec(page.url())[1])
  assert.deepEqual(sqlRows('SELECT COUNT(*) FROM journal_entries'), entries, 'an order posts nothing')
  assert.equal(onHand(), undefined, 'no stock yet')

  // Create bill: a draft with what is still to come, linked to the order
  await page.getByTestId('convert-order').click()
  await page.getByText(/Draft bill BILL-\d{4}-0001 created/).waitFor()
  await page.waitForURL(/\/purchases\/bills\/\d+\/edit$/)
  ids.bill = Number(/bills\/(\d+)\/edit/.exec(page.url())[1])
  await page.getByTestId('bill-form').waitFor()
  assert.match(await page.getByLabel('Quantity, line 1').inputValue(), /^100(\.0+)?$/, 'all 100 still to come')
  await page.locator('#f-supplier-bill').fill('CST-1101')
  await page.getByLabel('Quantity, line 1').fill('80')
  await page.getByTestId('total-total').getByText('64,000.00').waitFor()
  await page.getByTestId('save-post').click()
  await page.getByTestId('post-dialog').waitFor()
  await page.getByTestId('confirm-post').click()
  await page.getByText(/BILL-\d{4}-0001 posted/).waitFor()
  assert.equal(onHand(), '80.000')
  assert.deepEqual(sqlRows(`SELECT l.received_quantity, o.status FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.purchase_order_id WHERE o.id=${ids.po}`), [['80.000', 'partly_received']])

  // F8 shows received / still to come and the bill made from it; F11 lists it as partly received
  await go(page, `/purchases/orders/${ids.po}`)
  await page.getByText('Bills made from this order').waitFor()
  assert.match(await page.locator('table').first().innerText(), /100[\s\S]*80[\s\S]*20/)
  await go(page, '/purchases/orders')
  await page.locator('tbody tr', { hasText: /PO-\d{4}-0001/ }).getByText('Partly received').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('quotation → accepted → invoice posted', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/sales/quotations')
  await page.getByTestId('new-document').click()
  await page.getByTestId('quote-form').waitFor()
  await pickParty(page, 'Rahman', /Rahman Super Shop/)
  await page.locator('#q-wh').selectOption(String(ids.warehouse))
  await fillLine(page, '60')
  assert.equal(await page.getByLabel('Price, line 1').inputValue(), '950.00')
  await page.getByTestId('total-total').getByText('57,000.00').waitFor()
  const before = sqlRows('SELECT COUNT(*) FROM journal_entries')
  await page.getByTestId('save-draft').click()
  await page.getByText(/Quotation QT-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/\/sales\/quotations\/\d+$/)
  ids.quote = Number(/quotations\/(\d+)$/.exec(page.url())[1])
  assert.deepEqual(sqlRows('SELECT COUNT(*) FROM journal_entries'), before, 'a quotation posts nothing')

  // Converting before acceptance is not offered; accept, then convert
  assert.equal(await page.getByTestId('convert-quote').count(), 0)
  await page.getByTestId('mark-accepted').click()
  await confirm(page, 'Mark accepted')
  await page.getByText(/QT-\d{4}-0001 marked accepted/).waitFor()
  await page.getByTestId('convert-quote').click()
  await page.getByText(/Draft invoice INV-\d{4}-0001 created/).waitFor()
  await page.waitForURL(/\/sales\/invoices\/\d+\/edit$/)
  ids.invoice = Number(/invoices\/(\d+)\/edit/.exec(page.url())[1])
  await page.getByTestId('invoice-form').waitFor()
  await page.getByTestId('total-total').getByText('57,000.00').waitFor()
  await page.getByTestId('save-post').click()
  await page.getByTestId('post-dialog').waitFor()
  await page.getByTestId('confirm-post').click()
  await page.getByText(/INV-\d{4}-0001 posted/).waitFor()
  assert.equal(onHand(), '20.000')
  assert.deepEqual(sqlRows(`SELECT status FROM quotations WHERE id=${ids.quote}`), [['converted']])

  // The converted quotation links to its invoice and cannot convert again
  await go(page, `/sales/quotations/${ids.quote}`)
  await page.getByRole('button', { name: /Open INV-\d{4}-0001/ }).waitFor()
  assert.equal(await page.getByTestId('convert-quote').count(), 0)
  assert.deepEqual(errors, [])
  await context.close()
})

test('sales return 12 of 60 restocked, its credit note applied; 50 more is refused', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, `/sales/returns/new?invoice=${ids.invoice}`)
  await page.getByLabel('Quantity to return').first().waitFor()
  await page.getByLabel('Quantity to return').first().fill('12')
  await page.getByTestId('save-return').click()
  await page.getByText(/Draft SR-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/\/sales\/returns\/\d+$/)
  ids.salesReturn = Number(/returns\/(\d+)$/.exec(page.url())[1])
  await page.getByTestId('return-total').getByText('11,400.00').waitFor()
  await page.getByTestId('post-return').click()
  await confirm(page, 'Post')
  await page.getByText(/SR-\d{4}-0001 posted/).waitFor()
  assert.equal(onHand(), '32.000', 'restocked')

  // Its draft credit note opens; posting applies it to the invoice
  await page.waitForURL(/\/sales\/credit-notes\/\d+$/)
  await page.getByTestId('note-amount').waitFor()
  assert.equal(await page.getByTestId('note-amount').inputValue(), '11400.00')
  await page.getByTestId('post-note').click()
  await confirm(page, 'Post')
  await page.getByText(/CN-\d{4}-0001 posted/).waitFor()
  await page.getByTestId('note-effects').waitFor()
  assert.deepEqual(sqlRows(`SELECT balance_due FROM sales_invoices WHERE id=${ids.invoice}`), [['45600.00']])

  // 50 more: only 48 are left (BR-022)
  await go(page, `/sales/returns/new?invoice=${ids.invoice}`)
  await page.getByLabel('Quantity to return').first().waitFor()
  await page.getByLabel('Quantity to return').first().fill('50')
  await page.getByTestId('save-return').click()
  await page.getByText('More than the quantity still returnable').waitFor()
  assert.match(await page.getByTestId('return-errors').innerText(), /Only 48(\.0+)? .*Teer soybean oil 5L jar can still be returned/)
  assert.deepEqual(sqlRows(`SELECT COUNT(*) FROM sales_returns WHERE sales_invoice_id=${ids.invoice}`), [['1']])
  assert.equal(onHand(), '32.000')
  assert.deepEqual(errors, [])
  await context.close()
})

test('credit notes: kept as credit, and refunded from the bank', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  const newNote = async (amount, usage) => {
    await go(page, '/sales/credit-notes/new')
    await page.getByRole('combobox', { name: 'customer' }).fill('Rahman')
    await page.getByRole('listbox').getByRole('option', { name: /Rahman Super Shop/ }).click()
    await page.locator('#note-reason').selectOption('goodwill')
    await page.getByTestId('note-amount').fill(amount)
    await page.getByRole('radio', { name: usage }).click()
  }
  await newNote('500.00', 'Keep as credit')
  await page.getByTestId('save-note').click()
  await page.getByText(/Draft CN-\d{4}-0002 saved/).waitFor()
  await page.getByTestId('post-note').click()
  await confirm(page, 'Post')
  await page.getByText(/CN-\d{4}-0002 posted/).waitFor()

  await newNote('300.00', 'Refund')
  await page.locator('#note-acct').selectOption(String(ids.bank))
  await page.locator('#note-method').selectOption('bank_transfer')
  await page.getByTestId('save-note').click()
  await page.getByText(/Draft CN-\d{4}-0003 saved/).waitFor()
  await page.getByTestId('post-note').click()
  await confirm(page, 'Post')
  await page.getByText(/CN-\d{4}-0003 posted/).waitFor()
  assert.deepEqual(sqlRows('SELECT `usage`, status FROM credit_notes ORDER BY id'), [['apply', 'posted'], ['credit', 'posted'], ['refund', 'posted']])
  // The invoice keeps the balance after the applied note only
  assert.deepEqual(sqlRows(`SELECT balance_due FROM sales_invoices WHERE id=${ids.invoice}`), [['45600.00']])

  // E15 lists the notes
  await go(page, '/sales/returns?view=notes')
  await page.locator('tbody tr', { hasText: /CN-\d{4}-0003/ }).waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('purchase return of 6 jars: one journal entry debits the supplier once', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, `/purchases/returns/new?bill=${ids.bill}`)
  await page.getByLabel('Quantity to return').first().waitFor()
  await page.getByLabel('Quantity to return').first().fill('6')
  await page.getByTestId('save-return').click()
  await page.getByText(/Draft PR-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/\/purchases\/returns\/\d+$/)
  ids.purchaseReturn = Number(/returns\/(\d+)$/.exec(page.url())[1])
  await page.getByTestId('return-total').getByText('4,800.00').waitFor()
  await page.getByTestId('post-return').click()
  await confirm(page, 'Post')
  await page.getByText(/PR-\d{4}-0001 posted/).waitFor()
  assert.equal(onHand(), '26.000')
  assert.deepEqual(sqlRows(`SELECT COUNT(DISTINCT je) FROM (SELECT journal_entry_id je FROM purchase_returns WHERE id=${ids.purchaseReturn}
    UNION ALL SELECT journal_entry_id FROM debit_notes WHERE purchase_return_id=${ids.purchaseReturn} AND journal_entry_id IS NOT NULL) x`), [['1']], 'one entry')
  assert.deepEqual(sqlRows(`SELECT status, amount FROM debit_notes WHERE purchase_return_id=${ids.purchaseReturn}`), [['posted', '4800.00']])

  // The debit note opens read-only with the "posted with its return" note
  await page.getByRole('button', { name: /Open debit note/ }).click()
  await page.getByText('Posted with its return').waitFor()
  assert.equal(await page.getByTestId('post-note').count(), 0)
  assert.deepEqual(errors, [])
  await context.close()
})

test('trade reports and overviews match the posted data', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const month = `${today.slice(0, 8)}01`
  for (const [path, url, gross] of [['sales', '/reports/sales', '57000.00'], ['purchases', '/reports/purchases', '64000.00']]) {
    const r = await api('GET', `/reports/${path}?date_from=${month}&date_to=${today}`)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const t = r.body.data.totals
    assert.equal(t.gross, gross, `${path} gross = posted ${path === 'sales' ? 'invoices' : 'bills'}`)
    await go(page, url)
    await page.getByTestId('tile-gross').getByText(lakh(t.gross)).waitFor()
    await page.getByTestId('tile-returns').getByText(lakh(t.returns)).waitFor()
    await page.getByTestId('tile-net').getByText(lakh(t.net)).waitFor()
    await page.getByTestId('trade-report').getByText(path === 'sales' ? 'Rahman Super Shop' : 'Bengal Edible Oils').first().waitFor()
  }
  const sales = (await api('GET', `/reports/sales?date_from=${month}&date_to=${today}`)).body.data.totals
  assert.deepEqual(sqlRows(`SELECT ${sales.net} = (SELECT SUM(total) FROM sales_invoices WHERE status='posted') - (SELECT SUM(amount) FROM credit_notes WHERE status='posted')`), [['1']], 'net sales = invoices − credit notes')

  // E12: the sales return shows with its reason and opens
  await go(page, '/reports/sales-returns')
  await page.getByTestId('return-report').getByText(/SR-\d{4}-0001/).first().waitFor()
  await go(page, '/reports/purchase-returns')
  await page.getByTestId('return-report').getByText(/PR-\d{4}-0001/).first().waitFor()

  // E1 / F1 overviews
  for (const u of ['/sales', '/purchases']) {
    await go(page, u)
    await page.getByTestId('overview-tiles').waitFor()
  }

  // Phone width: the new pages fit
  await page.setViewportSize(VIEWPORTS.phone)
  for (const u of ['/sales', '/sales/quotations', `/sales/quotations/${ids.quote}`, '/sales/returns', `/sales/returns/${ids.salesReturn}`, '/purchases/orders',
    `/purchases/orders/${ids.po}`, '/purchases/returns', '/reports/sales']) {
    await go(page, u); await page.waitForTimeout(400); await assertNoPageScroll(page, u)
  }
  assert.deepEqual(errors, [])
  await context.close()
})

test('viewer can look but not create', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, VIEWER)
  await go(page, '/sales/quotations')
  await page.locator('tbody tr').first().waitFor()
  assert.equal(await page.getByTestId('new-document').count(), 0)
  await go(page, `/purchases/returns/${ids.purchaseReturn}`)
  await page.getByTestId('doc-actions').waitFor()
  assert.equal(await page.getByTestId('cancel-return').count(), 0)
  assert.equal((await api('POST', '/quotations', { party_id: ids.customer })).status, 403)
  await context.close()
})

test('books integrity check passes', () => {
  const out = artisan(['pluto:integrity'])
  assert.doesNotMatch(out, /\d+ failed/, out)
})
