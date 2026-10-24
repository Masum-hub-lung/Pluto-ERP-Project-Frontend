/**
 * End-to-end for phase 4 (backlog P4.6-VAL-01): purchase bills F2–F4 and stock movements D9 against the real API and
 * MySQL. A supplier, a product and a warehouse are made through the API (this file runs before suppliers.e2e), then
 * the Accountant enters and posts two bills through the UI — 100 @ 800 then 50 @ 860, so the average cost is
 * 820.0000 (BR-017) — with a double-clicked Post giving one journal entry; the ledger entries balance; a duplicate
 * supplier bill number is refused naming the existing bill; a third bill is cancelled. The Store keeper can only look
 * (Post hidden, direct API call 403), another company's owner gets 404, and `pluto:integrity` passes at the end.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { ACCOUNTANT, OWNER, PASSWORD, STORE, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

/** php artisan on the E2E API container (cwd = backend repo, like sql()). */
function artisan(args, env = {}) {
  const backend = process.env.BACKEND_DIR ?? '../backend'
  const e = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', ...e, 'app-e2e', 'php', 'artisan', ...args],
    { cwd: backend, encoding: 'utf8', env: { ...process.env, ...env } })
}

const ids = {}
const bills = {}

test('owner sets up a supplier, a warehouse and a stocked product (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const branch = (await api('GET', '/branches')).body.data[0]
  const wh = await api('POST', '/warehouses', { code: 'WH-BOG', name: 'Bogura warehouse', branch_id: branch.id })
  assert.equal(wh.status, 201, JSON.stringify(wh.body))
  ids.warehouse = wh.body.data.id
  const sup = await api('POST', '/parties', { party_type: 'supplier', name: 'Bengal Edible Oils', mobile: '01711000777' })
  assert.equal(sup.status, 201, JSON.stringify(sup.body))
  ids.supplier = sup.body.data.id
  const unit = (await api('GET', '/units?per_page=100')).body.data[0]
  const income = (await api('GET', '/ledgers?purpose=income_for_product&per_page=100')).body.data[0]
  const prod = await api('POST', '/products', { item_type: 'product', name: 'Soybean oil 5L jar', unit_id: unit.id, selling_price: '950.00', income_ledger_id: income.id })
  assert.equal(prod.status, 201, JSON.stringify(prod.body))
  ids.product = prod.body.data.id
  assert.equal(prod.body.data.track_stock, true)
  await context.close()
})

/** Fills a new bill: supplier, supplier's ref, warehouse, one line. */
async function fillBill(page, ref, qty, cost) {
  await page.goto('/purchases/bills/new')
  await page.getByTestId('bill-form').waitFor()
  await page.locator('#doc-party').fill('Bengal')
  await page.getByRole('listbox').getByRole('option', { name: /Bengal Edible Oils/ }).click()
  await page.getByTestId('party-balance').waitFor()
  await page.locator('#f-supplier-bill').fill(ref)
  await page.locator('#doc-warehouse').selectOption(String(ids.warehouse))
  await page.getByLabel('Item, line 1').fill('Soybean')
  await page.getByRole('listbox').getByRole('option', { name: /Soybean oil 5L jar/ }).click()
  await page.getByLabel('Quantity, line 1').fill(qty)
  await page.getByLabel('Cost, line 1').fill(cost)
}

/** Save and post from F3; a double click on Post sends one request. Returns the bill id. */
async function saveAndPost(page) {
  let posts = 0
  page.on('request', (r) => { if (r.method() === 'POST' && /\/purchase-bills\/\d+\/post$/.test(r.url())) posts++ })
  await page.getByTestId('save-post').click()
  await page.getByTestId('post-dialog').waitFor()
  const id = Number(/bills\/(\d+)\/edit/.exec(page.url())[1])
  await page.getByTestId('confirm-post').dblclick()
  await page.getByText(/BILL-\d{4}-\d{4} posted/).waitFor()
  await page.waitForURL(/\/purchases\/bills$/)
  assert.equal(posts, 1, 'one post request')
  return id
}

test('accountant enters and posts two bills; stock, average cost and ledger entries are right', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, ACCOUNTANT)

  // F2 empty, then F3: required fields first
  await page.goto('/purchases/bills')
  await page.getByText('No purchase bills yet').waitFor()
  await page.getByTestId('new-bill').click()
  await page.getByTestId('save-draft').click()
  await page.getByText("Enter the supplier's bill number").waitFor()

  // Bill 1: 100 @ 800, saved as a draft first (reload keeps the values and server totals)
  await fillBill(page, 'CST-0918', '100', '800')
  await page.getByTestId('total-total').getByText('80,000.00').waitFor()
  await page.getByTestId('save-draft').click()
  await page.getByText(/Draft BILL-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/bills\/\d+\/edit$/)
  await page.reload()
  assert.equal(await page.locator('#f-supplier-bill').inputValue(), 'CST-0918')
  await page.waitForFunction((v) => document.querySelector('#doc-warehouse')?.value === v, String(ids.warehouse))
  await page.getByTestId('total-total').getByText('80,000.00').waitFor()
  bills.first = await saveAndPost(page)
  assert.deepEqual(sqlRows(`SELECT COUNT(*) FROM journal_entries WHERE source_type='purchase_bills' AND source_id=${bills.first}`), [['1']], 'one journal entry')

  // Duplicate supplier bill number: refused, naming the existing bill
  await fillBill(page, 'CST-0918', '1', '800')
  await page.getByTestId('save-draft').click()
  await page.getByText(/Already entered as BILL-\d{4}-0001/).waitFor()
  await page.getByTestId('duplicate-link').waitFor()

  // Bill 2: 50 @ 860 → average (80,000 + 43,000) / 150 = 820.0000
  await fillBill(page, 'CST-0950', '50', '860')
  await page.getByTestId('total-total').getByText('43,000.00').waitFor()
  await page.getByTestId('save-draft').click()
  await page.waitForURL(/bills\/\d+\/edit$/)
  bills.second = await saveAndPost(page)
  assert.deepEqual(sqlRows(`SELECT qty_on_hand, avg_unit_cost FROM stock_balances WHERE product_id=${ids.product} AND warehouse_id=${ids.warehouse}`), [['150.000', '820.0000']])

  // D1 shows on hand and average cost; D9 has both movements linking back to F4
  await page.goto('/inventory/products')
  const prodRow = page.locator('tbody tr', { hasText: 'Soybean oil 5L jar' })
  assert.match(await prodRow.innerText(), /820\.00[\s\S]*150\.000|150\.000[\s\S]*820\.00/)
  await page.goto(`/inventory/movements?product_id=${ids.product}`)
  await page.locator('tbody tr', { hasText: /BILL-\d{4}-0001/ }).waitFor()
  assert.equal(await page.locator('tbody tr', { hasText: /BILL-/ }).count(), 2)
  assert.match(await page.locator('tbody tr').first().innerText(), /Purchase[\s\S]*50\.000[\s\S]*150\.000[\s\S]*860\.00[\s\S]*43,000\.00/)
  await page.locator('tbody a', { hasText: /BILL-\d{4}-0001/ }).click()
  await page.getByTestId('bill-number').getByText(/BILL-\d{4}-0001/).waitFor()

  // F4 ledger entries: Dr inventory = Cr supplier
  await page.getByRole('tab', { name: 'Ledger entries' }).click()
  const ledger = await page.getByTestId('ledger-entries').innerText()
  assert.match(ledger, /1301-\d+[\s\S]*80,000\.00/)
  assert.match(ledger, /Bengal Edible Oils[\s\S]*80,000\.00/)
  assert.deepEqual(sqlRows(`SELECT SUM(debit) = SUM(credit), SUM(debit) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.source_type='purchase_bills' AND je.source_id=${bills.first}`), [['1', '80000.00']])

  // Activity shows the posting
  await page.getByRole('tab', { name: 'Activity' }).click()
  await page.getByText(/posted/i).first().waitFor()

  // Phone width: list, editor and details fit
  await page.setViewportSize(VIEWPORTS.phone)
  for (const u of ['/purchases/bills', '/purchases/bills/new', `/purchases/bills/${bills.first}`, '/inventory/movements']) {
    await page.goto(u); await page.waitForTimeout(300); await assertNoPageScroll(page, u)
  }
  assert.deepEqual(errors, [])
  await context.close()
})

test('a posted bill is cancelled with a reason; its stock and journal are reversed', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, ACCOUNTANT)
  await fillBill(page, 'CST-0990', '10', '900')
  await page.getByTestId('save-draft').click()
  await page.waitForURL(/bills\/\d+\/edit$/)
  bills.third = await saveAndPost(page)
  await page.goto(`/purchases/bills/${bills.third}`)
  await page.getByTestId('cancel-bill').click()
  await page.getByTestId('confirm-cancel').click()
  await page.getByText('Choose why the bill is cancelled').waitFor()
  await page.locator('#cancel-reason').selectOption('entered_by_mistake')
  await page.getByTestId('confirm-cancel').click()
  await page.getByText(/BILL-\d{4}-0003 cancelled/).waitFor()
  await page.getByTestId('bill-status').getByText('Cancelled').waitFor()
  assert.deepEqual(sqlRows(`SELECT qty_on_hand, avg_unit_cost FROM stock_balances WHERE product_id=${ids.product} AND warehouse_id=${ids.warehouse}`), [['150.000', '820.0000']])
  assert.deepEqual(sqlRows(`SELECT COUNT(*) FROM journal_entries WHERE reverses_entry_id IN (SELECT id FROM journal_entries WHERE source_type='purchase_bills' AND source_id=${bills.third})`), [['1']])
  // The Accountant may not delete drafts (no purchases.delete): the button is hidden
  await fillBill(page, 'CST-DEL', '1', '800')
  await page.getByTestId('save-draft').click()
  await page.waitForURL(/bills\/\d+\/edit$/)
  assert.equal(await page.getByTestId('delete-draft').count(), 0)
  bills.draft = Number(/bills\/(\d+)\/edit/.exec(page.url())[1])
  await page.goto('/purchases/bills?tab=cancelled')
  await page.locator('tbody tr', { hasText: 'CST-0990' }).waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('owner deletes a draft; its number is voided', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await page.goto(`/purchases/bills/${bills.draft}/edit`)
  await page.getByTestId('bill-form').waitFor()
  const num = await page.getByLabel('Bill number', { exact: true }).inputValue()
  await page.getByTestId('delete-draft').click()
  await page.getByLabel('Type the draft name to confirm').fill(num)
  await page.getByRole('button', { name: 'Delete draft' }).last().click()
  await page.getByText('Draft deleted').waitFor()
  await page.waitForURL(/\/purchases\/bills$/)
  assert.equal(await page.locator('tbody tr', { hasText: 'CST-DEL' }).count(), 0)
  assert.deepEqual(errors, [])
  await context.close()
})

test('store keeper can look at bills but not post them', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, STORE)
  await page.goto('/purchases/bills')
  await page.locator('tbody tr').first().waitFor()
  assert.equal(await page.getByTestId('new-bill').count(), 0)
  await page.goto(`/purchases/bills/${bills.second}`)
  await page.getByTestId('bill-number').waitFor()
  for (const t of ['edit-bill', 'post-bill', 'cancel-bill']) assert.equal(await page.getByTestId(t).count(), 0, `${t} hidden`)
  assert.equal((await api('POST', `/purchase-bills/${bills.second}/post`, {})).status, 403)
  assert.equal((await api('POST', '/purchase-bills', { party_id: ids.supplier })).status, 403)
  await page.goto(`/inventory/movements?product_id=${ids.product}`)
  await page.locator('tbody tr').first().waitFor()
  assert.equal(await page.getByText('Cost (৳)', { exact: true }).count(), 0, 'no costs without inventory.view_costs')
  await context.close()
})

test("another company's owner gets 404 for the bill", async () => {
  artisan(['pluto:company:create', 'Padma Traders Ltd.', '--owner-email=other-owner@e2e.pluto.test', '--owner-name=Other Owner'], { PLUTO_OWNER_PASSWORD: PASSWORD })
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, 'other-owner@e2e.pluto.test')
  await page.goto(`/purchases/bills/${bills.first}`)
  await page.getByText(/couldn.t find this bill|not found/i).first().waitFor()
  assert.equal((await api('GET', `/purchase-bills/${bills.first}`)).status, 404)
  await context.close()
})

test('books integrity check passes', () => {
  const out = artisan(['pluto:integrity'])
  assert.doesNotMatch(out, /\d+ failed/, out)
})
