/**
 * End-to-end for phase 16 (backlog P16.3-VAL-01/02; TC-E2E-006; BR-039–BR-047) against the real API and MySQL, with the
 * worked examples of 06 §12 to the taka:
 * - the owner raises LC in the UI (US$ 38,400 at 121.50, margin 20 %), submits it, marks it opened;
 * - margin ৳ 9,33,120 and charges ৳ 2,40,000 are recorded; a lot goes to sea;
 * - "Receive goods" opens F3 in import mode with the LC prefilled; the bill books 20,000 kg at 121.50 = ৳ 46,65,600;
 * - the payment at 122.10 = ৳ 46,88,640 applies the margin; the FX loss is ৳ 23,040;
 * - with 40 % sold, landed cost puts ৳ 1,44,000 into stock and ৳ 96,000 into COGS (+৳ 12.00 a kilo);
 * - documents are received and the LC closes; reports open; Viewer reads only, Sales staff get 403;
 * - an LC raised with two items (PEP-487) keeps them on a purchase order; "New bill" from it shows both lines prefilled;
 * - phone widths fit; `pluto:integrity` passes.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { OWNER, SALES, VIEWER, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const dhaka = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const today = dhaka(new Date())
const expiry = dhaka(new Date(Date.now() + 60 * 86_400_000))

function artisan(args) {
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}
const ledgerBalance = (code, lc) => sqlRows(`SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) FROM journal_lines l JOIN ledgers g ON g.id = l.ledger_id
  WHERE g.code = '${code}' AND l.is_posted = 1${lc ? ` AND l.letter_of_credit_id = ${lc}` : ''}`)[0][0]

const ids = {}

test('masters for the import (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const ok = (r, s = 201) => assert.equal(r.status, s, JSON.stringify(r.body))
  const branch = (await api('GET', '/branches')).body.data[0]
  ids.warehouse = (await api('POST', '/warehouses', { code: 'WH-CTG', name: 'Chattogram depot', branch_id: branch.id })).body.data.id
  const unit = (await api('GET', '/units?per_page=100')).body.data[0]
  const income = (await api('GET', '/ledgers?purpose=income_for_product&per_page=100')).body.data[0]
  ids.oil = (await api('POST', '/products', { item_type: 'product', name: 'Crude palm oil', unit_id: unit.id, selling_price: '300.00', income_ledger_id: income.id })).body.data.id
  const bank = await api('POST', '/money-accounts', { account_type: 'bank', bank_name: 'Sonali Bank', account_name: 'Meghna Traders Ltd.', account_number: '0012345678', opening_balance: '10000000.00' })
  ok(bank)
  ids.bank = bank.body.data.id
  ids.supplier = (await api('POST', '/parties', { party_type: 'supplier', name: 'Straits Edible Oils', mobile: '01711000801' })).body.data.id
  ids.customer = (await api('POST', '/parties', { party_type: 'customer', name: 'Karim Traders', mobile: '01711000803' })).body.data.id
  await context.close()
})

test('TC-E2E-006: raise, submit and open an LC; charges, lot, import bill, payment, landed cost, close', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)

  // M3: raise the LC and submit it.
  await page.goto('/lc/new')
  await page.getByTestId('lc-form').waitFor()
  await page.getByRole('combobox', { name: 'Supplier' }).fill('Straits')
  await page.getByRole('listbox').getByRole('option', { name: /Straits Edible Oils/ }).click()
  await page.locator('#lc-goods').fill('20,000 kg crude palm oil')
  await page.locator('#lc-incoterm').selectOption('CFR Chattogram')
  await page.locator('#lc-amount').fill('38400.00')
  await page.locator('#lc-tol').fill('5')
  await page.locator('#lc-rate').fill('121.50')
  await page.getByTestId('lc-review-missing').getByText('Issuing bank').waitFor()
  await page.locator('#lc-bank').selectOption(String(ids.bank))
  await page.locator('#lc-margin').fill('20')
  await page.locator('#lc-expiry').fill(expiry)
  await page.getByTestId('lc-review-ready').waitFor()
  await page.getByTestId('lc-submit').click()
  await page.getByText(/LC-\d{4}-\d{3} submitted to the bank/).waitFor()
  await page.waitForURL(/\/lc\/\d+$/)
  ids.lc = Number(new URL(page.url()).pathname.split('/').pop())
  await page.getByText('Awaiting bank').first().waitFor()

  // Mark opened: bank reference and date (BR-039).
  await page.getByTestId('lc-action-mark_opened').click()
  await page.locator('#tr-ref').fill('SBL/LC/2026/0419')
  await page.getByTestId('confirm-transition').click()
  await page.getByText('Status is now opened.').waitFor()
  await page.getByTestId('lc-margin').getByText('৳ 0.00').waitFor()

  // LC-DrawerCharge: margin ৳ 9,33,120 and opening commission ৳ 40,000 in the UI; insurance and C&F through the API.
  const addCharge = async (type, amount) => {
    await page.getByTestId('lc-add-charge').click()
    await page.locator('#ch-type').selectOption(type)
    await page.locator('#ch-amount').fill(amount)
    await page.locator('#ch-account').selectOption(String(ids.bank))
    await page.getByTestId('save-charge').click()
    await page.getByTestId('lc-charge-dialog').waitFor({ state: 'detached' })
  }
  await addCharge('margin_deposit', '933120.00')
  await page.getByTestId('lc-margin').getByText('৳ 9,33,120.00').waitFor()
  await addCharge('opening_commission', '40000.00')
  for (const [type, amount] of [['marine_insurance', '50000.00'], ['cf_agent_fee', '150000.00']]) {
    const r = await api('POST', '/lc-charges', { letter_of_credit_id: ids.lc, charge_type: type, charge_date: today, amount, status: 'paid', paid_from_account_id: ids.bank })
    assert.equal(r.status, 201, JSON.stringify(r.body))
  }
  assert.equal(ledgerBalance('1403', ids.lc), '933120.00')
  assert.equal(ledgerBalance('1404', ids.lc), '240000.00')

  // Shipment: a lot at sea moves the LC to partly shipped.
  await page.goto(`/lc/${ids.lc}?tab=shipments`)
  await page.getByTestId('lc-add-lot').click()
  await page.locator('#lot-status').selectOption('at_sea')
  await page.locator('#lot-bl').fill('MAEU-1234')
  await page.getByTestId('save-lot').click()
  await page.getByText('Lot 1 added').waitFor()
  await page.getByText('Partly shipped').first().waitFor()

  // F3 import mode from "Receive goods": the LC and currency are prefilled; the bill is posted through the API.
  await page.getByTestId('lc-receive').click()
  await page.waitForURL(/\/purchases\/bills\/new\?lc=/)
  await page.getByTestId('bill-import').waitFor()
  await page.waitForFunction((id) => document.querySelector('#f-lc')?.value === String(id), ids.lc)
  assert.equal(await page.locator('#f-currency').inputValue(), 'USD')
  // No items on this LC (it was raised with the items left blank): the lines stay manual, with the LC's goods as a
  // reference and a link to add its items once; nothing paid yet, so the rate is the planning rate (FromLc.ts).
  await page.getByTestId('bill-lc-note').getByText(/has no items yet/).waitFor()
  await page.getByTestId('bill-lc-add-items').getByText(/Add the items to LC-\d{4}-\d{3}/).waitFor()
  await page.getByTestId('bill-lc-note').getByText(/20,000 kg crude palm oil/).waitFor()
  assert.match(await page.locator('#f-rate').inputValue(), /^121\.50/)
  const bill = await api('POST', '/purchase-bills', { party_id: ids.supplier, supplier_bill_no: 'SEO-CI-88', bill_date: today, warehouse_id: ids.warehouse, letter_of_credit_id: ids.lc,
    lines: [{ product_id: ids.oil, quantity: '20000', unit_cost: '1.92' }] })
  assert.equal(bill.status, 201, JSON.stringify(bill.body))
  const posted = await api('POST', `/purchase-bills/${bill.body.data.id}/post`, {})
  assert.equal(posted.status, 200, JSON.stringify(posted.body))
  assert.deepEqual([posted.body.data.currency_code, posted.body.data.exchange_rate, posted.body.data.total], ['USD', '121.500000', '4665600.00'])
  ids.bill = posted.body.data.id

  // LC-DlgPay: US$ 38,400 at 122.10 = ৳ 46,88,640, margin applied; FX loss ৳ 23,040 (06 §12.5).
  await page.goto(`/lc/${ids.lc}`)
  await page.getByTestId('lc-record-payment').click()
  await page.locator('#pay-rate').fill('122.10')
  await page.locator('#pay-account').selectOption(String(ids.bank))
  await page.locator('#pay-margin').fill('933120.00')
  await page.getByTestId('save-lc-payment').click()
  await page.getByText('৳ 46,88,640.00 · exchange difference ৳ 23,040.00').waitFor()
  assert.equal(ledgerBalance('6603'), '23040.00')
  assert.equal(ledgerBalance('1403', ids.lc), '0.00')
  const billNow = (await api('GET', `/purchase-bills/${ids.bill}`)).body.data
  assert.deepEqual([billNow.payment_status, billNow.balance_due], ['paid', '0.00'])
  await page.getByTestId('lc-outstanding').getByText('0.00').waitFor()

  // Sell 40 %, then allocate the landed cost: ৳ 1,44,000 to stock, ৳ 96,000 to COGS.
  const inv = await api('POST', '/sales-invoices', { party_id: ids.customer, invoice_date: today, warehouse_id: ids.warehouse, lines: [{ product_id: ids.oil, quantity: '8000' }] })
  assert.equal((await api('POST', `/sales-invoices/${inv.body.data.id}/post`, {})).status, 200)
  await page.goto(`/lc/${ids.lc}?tab=cost`)
  await page.getByTestId('cost-unallocated').getByText('৳ 2,40,000.00').waitFor()
  await page.getByTestId('lc-allocate').click()
  await page.locator('#lca-bill').selectOption(String(ids.bill))
  await page.getByTestId('preview-landed-cost').click()
  const preview = page.getByTestId('landed-cost-preview')
  await preview.getByText('1,44,000.00').waitFor()
  await preview.getByText('96,000.00').waitFor()
  await preview.getByText('12.0000').waitFor()
  await page.getByTestId('post-landed-cost').click()
  await page.getByText('৳ 2,40,000.00 allocated to the goods').waitFor()
  await page.getByTestId('cost-unallocated').getByText('৳ 0.00').waitFor()
  await page.getByTestId('cost-landed').getByText('৳ 49,05,600.00').waitFor()
  assert.equal(ledgerBalance('1404', ids.lc), '0.00')

  // LC-DlgClose: blocked while documents are pending; received → closed.
  await page.getByTestId('lc-close').click()
  await page.getByTestId('confirm-close-lc').click()
  await page.getByTestId('close-checks').locator('[data-ok="false"]').first().waitFor()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.goto(`/lc/${ids.lc}?tab=documents`)
  // The LC was raised with no template and the default two-document checklist.
  for (const name of ['Bill of lading', 'Commercial invoice']) {
    await page.getByLabel(`Status of ${name}`).selectOption('received')
    await page.getByText(`${name}: Received`).waitFor()
  }
  await page.getByTestId('lc-close').click()
  await page.getByTestId('confirm-close-lc').click()
  await page.getByText(/LC-\d{4}-\d{3} closed/).waitFor()
  await page.getByText('Closed').first().waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('M1, M2, M5–M8 open and agree with the LC', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await page.goto('/lc')
  await page.getByTestId('lc-kpis').waitFor()
  await page.getByTestId('lc-pipeline').getByText('Closed 1').waitFor()
  await page.goto('/lc/list?group=closed')
  await page.getByText('Straits Edible Oils · 20,000 kg crude palm oil').first().waitFor()
  await page.goto('/lc/amendments')
  await page.getByText('No amendments').first().waitFor()
  await page.goto('/lc/documents')
  await page.getByTestId('templates').waitFor()
  await page.goto(`/lc/charges?lc=${ids.lc}`)
  await page.getByTestId('m7-landed').getByText('৳ 49,05,600.00').waitFor()
  await page.goto('/lc/reports/cost')
  await page.getByTestId('lc-report-cost').waitFor()
  await page.goto('/lc/reports/charges')
  await page.getByTestId('lc-report-charges').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('Viewer reads LCs without actions; Sales staff are refused (lc.view)', async () => {
  const { context, page } = await newPage()
  await signIn(page, VIEWER)
  await page.goto(`/lc/${ids.lc}`)
  await page.getByTestId('lc-title').waitFor()
  assert.equal(await page.getByTestId('lc-add-charge').count(), 0)
  assert.equal(await page.getByTestId('lc-record-payment').count(), 0)
  await context.close()
  const s = await newPage()
  await signIn(s.page, SALES)
  await s.page.goto('/lc/list')
  await s.page.getByTestId('state-denied').waitFor()
  await s.context.close()
})

test('LC pages fit phone, tablet and desktop widths', async () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const { context, page } = await newPage({ viewport })
    await signIn(page, OWNER)
    for (const path of ['/lc', '/lc/list', `/lc/${ids.lc}`, '/lc/new']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await assertNoPageScroll(page, `${name} ${path}`)
    }
    await context.close()
  }
})

test('F3: choosing an LC raised against a PO fills the bill; the server refuses more than the order expects (BR-056)', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const ok = (r, s = 201) => assert.equal(r.status, s, JSON.stringify(r.body))
  const po = await api('POST', '/purchase-orders', { party_id: ids.supplier, order_date: today, warehouse_id: ids.warehouse, currency_code: 'USD', exchange_rate: '121.500000',
    lines: [{ product_id: ids.oil, quantity: '1000', unit_cost: '1.90' }] })
  ok(po)
  ok(await api('POST', `/purchase-orders/${po.body.data.id}/send`, { to: ['exports@straits.example'] }), 200)
  const lc = await api('POST', '/letters-of-credit', { party_id: ids.supplier, purchase_order_id: po.body.data.id, goods_description: '1,000 kg crude palm oil', tenor: 'sight',
    incoterm: 'CFR Chattogram', currency_code: 'USD', amount: '1900.00', tolerance_pct: '5', planning_rate: '121.50', issuing_bank_account_id: ids.bank, expiry_date: expiry })
  ok(lc)
  ok(await api('POST', `/letters-of-credit/${lc.body.data.id}/transition`, { action: 'submit' }, { 'If-Match': `W/"${lc.body.data.version}"` }), 200)
  const sub = (await api('GET', `/letters-of-credit/${lc.body.data.id}`)).body.data
  ok(await api('POST', `/letters-of-credit/${sub.id}/transition`, { action: 'mark_opened', bank_reference: 'SBL/LC/2026/0420', date: today }, { 'If-Match': `W/"${sub.version}"` }), 200)

  // New bill, no supplier yet: pick the LC; supplier, currency, order and its 1,000 kg line are filled.
  await page.goto('/purchases/bills/new')
  await page.getByTestId('bill-import-open').click()
  await page.locator('#f-lc').selectOption(String(lc.body.data.id))
  await page.waitForFunction(() => document.querySelector('[aria-label="Quantity, line 1"]')?.value === '1000.000')
  assert.equal(await page.locator('#f-currency').inputValue(), 'USD')
  assert.equal(await page.getByTestId('from-po').inputValue(), String(po.body.data.id))
  await page.getByText('Straits Edible Oils').first().waitFor()
  assert.equal(await page.getByTestId('bill-lc-note').count(), 0)

  // 1,050 kg is the order plus the LC's 5 % tolerance; 1,051 is refused, on the line.
  await page.locator('[aria-label="Quantity, line 1"]').fill('1051')
  await page.getByTestId('line-errors-0').getByText(/Only 1050\.000 .* is left on PO-/).waitFor()
  const line = (await api('GET', `/purchase-orders/${po.body.data.id}`)).body.data.lines[0]
  const body = (q) => ({ party_id: ids.supplier, supplier_bill_no: `SEO-PO-${q}`, bill_date: today, warehouse_id: ids.warehouse, purchase_order_id: po.body.data.id,
    letter_of_credit_id: lc.body.data.id, currency_code: 'USD', exchange_rate: '121.500000', lines: [{ product_id: ids.oil, quantity: q, unit_cost: '1.90', purchase_order_line_id: line.id }] })
  const over = await api('POST', '/purchase-bills', body('1051'))
  assert.deepEqual([over.status, over.body.code], [422, 'order_qty_exceeded'])
  const fine = await api('POST', '/purchase-bills', body('1050'))
  ok(fine)
  ok(await api('POST', `/purchase-bills/${fine.body.data.id}/post`, {}), 200)

  // Everything received: picking the LC again says so.
  await page.goto('/purchases/bills/new')
  await page.getByTestId('bill-import-open').click()
  await page.locator('#f-lc').selectOption(String(lc.body.data.id))
  await page.getByTestId('bill-lc-note').getByText('Everything on this LC has already been billed').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('PEP-487: an LC raised with two items fills "New bill" from the LC with both lines', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const unit = (await api('GET', '/units?per_page=100')).body.data[0]
  const income = (await api('GET', '/ledgers?purpose=income_for_product&per_page=100')).body.data[0]
  const ghee = await api('POST', '/products', { item_type: 'product', name: 'Vegetable ghee', unit_id: unit.id, selling_price: '450.00', income_ledger_id: income.id })
  assert.equal(ghee.status, 201, JSON.stringify(ghee.body))

  // M3: "Enter the items" is the default; two items, the goods wording is filled from their names.
  await page.goto('/lc/new')
  await page.getByTestId('lc-form').waitFor()
  await page.getByRole('combobox', { name: 'Supplier' }).fill('Straits')
  await page.getByRole('listbox').getByRole('option', { name: /Straits Edible Oils/ }).click()
  await page.getByTestId('lc-items-section').waitFor()
  const item = async (i, name, qty, cost) => {
    await page.getByRole('combobox', { name: `Item ${i + 1}`, exact: true }).fill(name)
    await page.getByRole('listbox').getByRole('option', { name: new RegExp(name) }).click()
    await page.locator(`#lc-item-qty-${i}`).fill(qty)
    await page.locator(`#lc-item-cost-${i}`).fill(cost)
  }
  await item(0, 'Crude palm oil', '5000', '1.92')
  await page.getByTestId('lc-item-add').click()
  await item(1, 'Vegetable ghee', '400', '2.50')
  assert.equal(await page.locator('#lc-goods').inputValue(), 'Crude palm oil, Vegetable ghee')
  await page.getByTestId('lc-items-total').getByText('The items total is worked out when you save.').waitFor()
  await page.locator('#lc-incoterm').selectOption('CFR Chattogram')
  await page.locator('#lc-amount').fill('10600.00')
  await page.locator('#lc-tol').fill('5')
  await page.locator('#lc-rate').fill('121.50')
  await page.locator('#lc-bank').selectOption(String(ids.bank))
  await page.locator('#lc-expiry').fill(expiry)
  await page.getByTestId('lc-submit').click()
  await page.getByText(/LC-\d{4}-\d{3} submitted to the bank/).waitFor()
  await page.waitForURL(/\/lc\/\d+$/)
  const lcId = Number(new URL(page.url()).pathname.split('/').pop())

  // M4: the items card shows both lines and the server's total (US$ 9,600 + 1,000), which matches the LC amount.
  await page.getByTestId('lc-items-card').getByText('Crude palm oil').waitFor()
  await page.getByTestId('lc-items-card').getByText('Vegetable ghee').waitFor()
  assert.equal((await page.getByTestId('lc-items-total').innerText()).trim(), '10600.00')
  assert.equal(await page.getByTestId('lc-items-differ').count(), 0)
  assert.equal(await page.getByTestId('lc-add-items').count(), 0)
  const stored = (await api('GET', `/letters-of-credit/${lcId}`)).body.data
  assert.deepEqual([stored.items_source, stored.lines.length, stored.lines_total], ['entered', 2, '10600.00'])
  const po = (await api('GET', `/purchase-orders/${stored.purchase_order_id}`)).body.data
  assert.deepEqual([po.status, po.currency_code, po.total_foreign], ['sent', 'USD', '10600.00'])

  // Opened by the bank, then "Receive goods": F3 import mode with both lines prefilled with what is still to come.
  await page.getByTestId('lc-action-mark_opened').click()
  await page.locator('#tr-ref').fill('SBL/LC/2026/0421')
  await page.getByTestId('confirm-transition').click()
  await page.getByText('Status is now opened.').waitFor()
  await page.getByTestId('lc-receive').click()
  await page.waitForURL(/\/purchases\/bills\/new\?lc=/)
  await page.waitForFunction(() => document.querySelector('[aria-label="Quantity, line 1"]')?.value === '5000.000'
    && document.querySelector('[aria-label="Quantity, line 2"]')?.value === '400.000')
  assert.equal(await page.locator('[aria-label="Cost, line 1"]').inputValue(), '1.9200')
  assert.equal(await page.locator('[aria-label="Cost, line 2"]').inputValue(), '2.5000')
  assert.equal(await page.locator('#f-currency').inputValue(), 'USD')
  assert.equal(await page.getByTestId('from-po').inputValue(), String(stored.purchase_order_id))
  assert.equal(await page.getByTestId('bill-lc-note').count(), 0)

  // The server holds a bill from this LC to its items: an extra item is refused, an amendment adds it.
  const extra = await api('POST', '/purchase-bills', { party_id: ids.supplier, supplier_bill_no: 'SEO-X-1', bill_date: today, warehouse_id: po.warehouse_id, letter_of_credit_id: lcId,
    purchase_order_id: po.id, lines: [{ product_id: ids.oil, quantity: '10', unit_cost: '1.92' }] })
  assert.deepEqual([extra.status, extra.body.code], [422, 'validation_failed'])
  // The amendment dialog's "Item changes": ghee 400 → 500, recorded as accepted, changes the LC's items.
  await page.goto(`/lc/${lcId}`)
  await page.getByTestId('lc-amend-items').click()
  await page.getByTestId('am-items').waitFor()
  await page.locator(`#am-qty-${stored.lines[1].id}`).fill('500')
  await page.getByRole('radio', { name: 'Accepted' }).click()
  await page.getByTestId('save-amendment').click()
  await page.getByText(/Amendment \d+ recorded/).waitFor()
  const amended = (await api('GET', `/letters-of-credit/${lcId}`)).body.data
  assert.deepEqual(amended.lines.map((l) => l.quantity), ['5000.000', '500.000'])
  await page.getByTestId(`lc-item-${stored.lines[1].id}`).getByText('500.000').first().waitFor()
  await page.getByTestId('lc-items-differ').getByText(/The items add up to USD 10850\.00; the LC amount is USD 10600\.00/).waitFor()
  await assertNoPageScroll(page)
  assert.deepEqual(errors, [])
  await context.close()
})

test('the books still agree (pluto:integrity)', () => {
  const out = artisan(['pluto:integrity'])
  assert.doesNotMatch(out, /\d+ failed/, out)
})
