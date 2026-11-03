/**
 * End-to-end for line units (backlog P10.7-VAL-01, PEP-468; BR-069) against the real API and MySQL. 1 box = 12 pcs.
 * - D2: the item "Lux soap 100g" is created in pcs with an extra unit box = 12 (Other units).
 * - F8 → F3: a purchase order for 10 boxes is converted to a bill; the bill keeps the box unit; 5 boxes post = 60 pcs
 *   in stock at 40.00 a piece.
 * - E10 → E3: choosing box on a quotation line fills the box price (660.00 = 55.00 x 12, from the API); accepted,
 *   converted and posted for 2 boxes = 24 pcs out, cost kept per box.
 * - E8 / F6: returning 1 box restocks 12 pcs; sending 1 box back to the supplier takes 12 pcs out.
 * - The line grid has Qty · Unit (no Description); the item search list is fully visible above the line table at
 *   1440, 1024 and 390 px (P10.7-FE-01). `pluto:integrity` passes at the end.
 * Screenshots go to $E2E_SHOTS when it is set.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { OWNER, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const shot = async (page, name) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/line-units-${name}.png`, fullPage: true }) }

function artisan(args) {
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}

/** In-app navigation (see sales-invoice.e2e): avoids a full reload racing the refresh-token rotation. */
async function go(page, path) {
  await page.waitForLoadState('networkidle')
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

const ids = {}
const onHand = () => sqlRows(`SELECT qty_on_hand FROM stock_balances WHERE product_id=${ids.product} AND warehouse_id=${ids.warehouse}`)[0]?.[0]
const confirm = (page, name) => page.getByRole('button', { name, exact: true }).last().click()

async function pickParty(page, search, name) {
  await page.locator('#doc-party').fill(search)
  await page.getByRole('listbox').getByRole('option', { name }).click()
}

async function pickSoap(page) {
  await page.getByLabel('Item, line 1').fill('Lux')
  await page.getByRole('listbox').getByRole('option', { name: /Lux soap 100g/ }).click()
}

/** The unit chosen in a line's Unit dropdown (its visible label). */
const unitOf = (page, n = 1) => page.getByLabel(`Unit, line ${n}`).evaluate((s) => s.selectedOptions[0]?.textContent ?? '')

test('owner sets up a supplier, a customer and a warehouse (API), then the item in pcs with box = 12 (D2)', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const branch = (await api('GET', '/branches')).body.data[0]
  const wh = await api('POST', '/warehouses', { code: 'WH-TEJ', name: 'Tejgaon warehouse', branch_id: branch.id })
  assert.equal(wh.status, 201, JSON.stringify(wh.body))
  ids.warehouse = wh.body.data.id
  const sup = await api('POST', '/parties', { party_type: 'supplier', name: 'Unilever Distribution', mobile: '01711000555' })
  assert.equal(sup.status, 201, JSON.stringify(sup.body))
  const cus = await api('POST', '/parties', { party_type: 'customer', name: 'Rahman Super Shop', mobile: '01811458230' })
  assert.equal(cus.status, 201, JSON.stringify(cus.body))

  await go(page, '/inventory/products/new')
  await page.getByTestId('product-form').waitFor()
  await page.getByLabel('Item name').fill('Lux soap 100g')
  await page.locator('#p-unit').selectOption({ label: 'pcs' })
  await page.getByLabel('Selling price').fill('55.00')
  for (let i = 0; i < 100 && !/4101/.test(await page.getByLabel('Income account').inputValue()); i++) await page.waitForTimeout(100)
  await page.getByTestId('add-product-unit').click()
  await page.getByLabel('Unit 1', { exact: true }).selectOption({ label: 'box' })
  await page.getByLabel('pcs in unit 1').fill('12')
  await shot(page, 'product-form')
  await page.getByTestId('save-product').click()
  await page.waitForURL(/\/inventory\/products$/)

  const list = (await api('GET', '/products?q=Lux')).body.data
  assert.equal(list.length, 1)
  ids.product = list[0].id
  assert.deepEqual(list[0].units.map((u) => [u.name, u.factor, u.selling_price]), [['pcs', '1.000000', '55.00'], ['box', '12.000000', '660.00']])
  assert.deepEqual(errors, [])
  await context.close()
})

test('purchase order in boxes → bill keeps the unit; 5 boxes post 60 pcs at 40.00 a piece', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/purchases/orders')
  await page.getByTestId('new-document').click()
  await page.getByTestId('order-form').waitFor()
  await pickParty(page, 'Unilever', /Unilever Distribution/)
  await page.locator('#po-wh').selectOption(String(ids.warehouse))
  await pickSoap(page)
  assert.equal(await unitOf(page), 'pcs', 'the base unit first')
  await page.getByLabel('Unit, line 1').selectOption({ label: 'box' })
  await page.getByLabel('Quantity, line 1').fill('10')
  await page.getByLabel('Cost, line 1').fill('480')
  await page.getByTestId('total-total').getByText('4,800.00').waitFor()
  const heads = (await page.locator('[data-testid=line-grid] thead th').allInnerTexts()).map((h) => h.trim().toUpperCase())
  assert.deepEqual(heads.slice(1, 5), ['ITEM', 'QTY', 'UNIT', 'COST'], 'Qty then Unit, no Description')
  await shot(page, 'po-box-line')
  await page.getByTestId('save-draft').click()
  await page.getByText(/Purchase order PO-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/\/purchases\/orders\/\d+$/)
  ids.po = Number(/orders\/(\d+)$/.exec(page.url())[1])
  assert.deepEqual(sqlRows(`SELECT unit_name, unit_factor FROM purchase_order_lines WHERE purchase_order_id=${ids.po}`), [['box', '12.000000']])

  await page.getByTestId('convert-order').click()
  await page.getByText(/Draft bill BILL-\d{4}-0001 created/).waitFor()
  await page.waitForURL(/\/purchases\/bills\/\d+\/edit$/)
  await page.getByTestId('bill-form').waitFor()
  for (let i = 0; i < 50 && (await page.getByLabel('Unit, line 1').isDisabled()); i++) await page.waitForTimeout(100) // the saved line's item loads its units
  assert.equal(await unitOf(page), 'box', 'the saved line keeps its unit')
  await page.locator('#f-supplier-bill').fill('UDL-5521')
  await page.getByLabel('Quantity, line 1').fill('5')
  await page.getByTestId('total-total').getByText('2,400.00').waitFor()
  await page.getByTestId('save-post').click()
  await page.getByTestId('post-dialog').waitFor()
  await page.getByTestId('confirm-post').click()
  await page.getByText(/BILL-\d{4}-0001 posted/).waitFor()
  ids.bill = Number(sqlRows('SELECT id FROM purchase_bills ORDER BY id DESC LIMIT 1')[0][0])
  assert.equal(onHand(), '60.000', '5 boxes = 60 pcs')
  assert.deepEqual(sqlRows(`SELECT avg_unit_cost FROM stock_balances WHERE product_id=${ids.product}`), [['40.0000']])
  assert.deepEqual(sqlRows(`SELECT received_quantity FROM purchase_order_lines WHERE purchase_order_id=${ids.po}`), [['5.000']], 'received in boxes')
  assert.deepEqual(errors, [])
  await context.close()
})

test('quotation line in boxes takes the box price; converted and posted for 2 boxes = 24 pcs out', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/sales/quotations')
  await page.getByTestId('new-document').click()
  await page.getByTestId('quote-form').waitFor()
  await pickParty(page, 'Rahman', /Rahman Super Shop/)
  await page.locator('#q-wh').selectOption(String(ids.warehouse))
  await pickSoap(page)
  assert.equal(await page.getByLabel('Price, line 1').inputValue(), '55.00')
  await page.getByLabel('Unit, line 1').selectOption({ label: 'box' })
  assert.equal(await page.getByLabel('Price, line 1').inputValue(), '660.00', 'the box price from the API')
  await page.getByLabel('Quantity, line 1').fill('2')
  await page.getByTestId('total-total').getByText('1,320.00').waitFor()
  await page.getByTestId('save-draft').click()
  await page.getByText(/Quotation QT-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/\/sales\/quotations\/\d+$/)
  await page.getByTestId('mark-accepted').click()
  await confirm(page, 'Mark accepted')
  await page.getByText(/QT-\d{4}-0001 marked accepted/).waitFor()
  await page.getByTestId('convert-quote').click()
  await page.getByText(/Draft invoice INV-\d{4}-0001 created/).waitFor()
  await page.waitForURL(/\/sales\/invoices\/\d+\/edit$/)
  ids.invoice = Number(/invoices\/(\d+)\/edit/.exec(page.url())[1])
  await page.getByTestId('invoice-form').waitFor()
  for (let i = 0; i < 50 && (await page.getByLabel('Unit, line 1').isDisabled()); i++) await page.waitForTimeout(100)
  assert.equal(await unitOf(page), 'box')
  await page.getByText('60 pcs on hand').or(page.getByText('60.000 pcs on hand')).first().waitFor()
  await shot(page, 'invoice-box-line')
  await page.getByTestId('save-post').click()
  await page.getByTestId('post-dialog').waitFor()
  await page.getByTestId('confirm-post').click()
  await page.getByText(/INV-\d{4}-0001 posted/).waitFor()
  assert.equal(onHand(), '36.000', '60 - 24 pcs')
  assert.deepEqual(sqlRows(`SELECT unit_name, unit_price, unit_cost, cost_amount FROM sales_invoice_lines WHERE sales_invoice_id=${ids.invoice}`), [['box', '660.00', '480.0000', '960.00']])
  assert.deepEqual(errors, [])
  await context.close()
})

test('returns move the source line unit: 1 box back from the customer, 1 box back to the supplier', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, `/sales/returns/new?invoice=${ids.invoice}`)
  await page.getByLabel('Quantity to return').first().waitFor()
  await page.getByLabel('Quantity to return').first().fill('1')
  await page.getByTestId('save-return').click()
  await page.getByText(/Draft SR-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/\/sales\/returns\/\d+$/)
  await page.getByTestId('return-total').getByText('660.00').waitFor()
  await page.getByTestId('post-return').click()
  await confirm(page, 'Post')
  await page.getByText(/SR-\d{4}-0001 posted/).waitFor()
  assert.equal(onHand(), '48.000', '1 box = 12 pcs restocked')

  await go(page, `/purchases/returns/new?bill=${ids.bill}`)
  await page.getByLabel('Quantity to return').first().waitFor()
  await page.getByLabel('Quantity to return').first().fill('1')
  await page.getByTestId('save-return').click()
  await page.getByText(/Draft PR-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/\/purchases\/returns\/\d+$/)
  await page.getByTestId('return-total').getByText('480.00').waitFor()
  await page.getByTestId('post-return').click()
  await confirm(page, 'Post')
  await page.getByText(/PR-\d{4}-0001 posted/).waitFor()
  assert.equal(onHand(), '36.000', '1 box = 12 pcs sent back')
  assert.deepEqual(errors, [])
  await context.close()
})

test('the item search list opens fully visible above the line table (1440, 1024, 390 px)', async () => {
  for (const name of ['desktop', 'laptop', 'phone']) {
    const { context, page, errors } = await newPage({ viewport: VIEWPORTS[name] })
    await signIn(page, OWNER)
    await go(page, '/sales/invoices/new')
    await page.getByTestId('invoice-form').waitFor()
    const input = page.getByLabel('Item, line 1')
    await input.scrollIntoViewIfNeeded()
    await input.fill('Lux')
    const list = page.getByRole('listbox')
    await list.getByRole('option', { name: /Lux soap 100g/ }).waitFor()
    const [box, field, vw, vh] = await Promise.all([list.boundingBox(), input.boundingBox(), page.evaluate(() => innerWidth), page.evaluate(() => innerHeight)])
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= vw && box.y + box.height <= vh, `${name}: the list is inside the window ${JSON.stringify(box)}`)
    assert.ok(box.width >= field.width - 1, `${name}: at least as wide as the search box`)
    assert.equal(await list.evaluate((el) => el.parentElement === document.body), true, `${name}: rendered outside the table`)
    // Nothing covers it: the topmost element at its centre and near its bottom is inside the list
    for (const y of [box.y + box.height / 2, box.y + box.height - 6]) {
      const inside = await page.evaluate(([x, yy]) => !!document.elementFromPoint(x, yy)?.closest('[role=listbox]'), [box.x + box.width / 2, y])
      assert.ok(inside, `${name}: the list is on top at y=${Math.round(y)}`)
    }
    await shot(page, `picker-${name}`)
    await list.getByRole('option', { name: /Lux soap 100g/ }).click()
    assert.equal(await unitOf(page), 'pcs')
    await assertNoPageScroll(page, `/sales/invoices/new at ${name}`)
    assert.deepEqual(errors, [])
    await context.close()
  }
})

test('books integrity check passes', () => {
  const out = artisan(['pluto:integrity'])
  assert.doesNotMatch(out, /\d+ failed/, out)
})
