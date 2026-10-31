/**
 * End-to-end for phase 11 (backlog P11.3-VAL-01, inventory completion) against the real API and MySQL. The owner sets up
 * two warehouses with their own inventory ledgers (1301-01, 1301-02), a supplier and a stock item that supplier is
 * preferred for, with a reorder level in the first warehouse (API). Then through the UI:
 * - TC-E2E-003: D12 lists the item as out of stock → "Create purchase orders" makes a draft PO → it becomes a bill,
 *   posted → D9 shows the purchase and D4 the stock.
 * - D10: counted 16 jars against 18 in the system → posting books Dr 5002 ৳ 1,690 / Cr 1301-01 (TC-INV-002).
 * - D11: 6 jars to the other warehouse (different ledger) → dispatch posts via stock in transit (1405), receive clears it.
 * - D13: the valuation agrees with the inventory ledgers in the trial balance; D14 and D8 load; phone widths fit.
 * - The product import checks a file and creates an item with opening stock. Viewer cannot adjust; `pluto:integrity` passes.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OWNER, VIEWER, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)

function artisan(args) {
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}

/** In-app navigation (see sales-invoice.e2e): avoids a full reload racing the refresh-token rotation. */
async function go(page, path) {
  await page.waitForLoadState('networkidle')
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

const confirm = (page, name) => page.getByRole('button', { name, exact: true }).last().click()
const ids = {}
const stock = (wh) => sqlRows(`SELECT qty_on_hand, total_value FROM stock_balances WHERE product_id=${ids.oil} AND warehouse_id=${wh}`)[0] ?? ['0.000', '0.00']
const entryLines = (where) => sqlRows(`SELECT l.code, jl.debit, jl.credit FROM journal_lines jl JOIN ledgers l ON l.id = jl.ledger_id
  JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE ${where} ORDER BY jl.line_no`)

test('owner sets up warehouses, a supplier and a stock item with a reorder level (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const branch = (await api('GET', '/branches')).body.data[0]
  for (const [k, code, name] of [['tej', 'WH-TEJ', 'Tejgaon warehouse'], ['ngj', 'WH-NGJ', 'Narayanganj depot']]) {
    const w = await api('POST', '/warehouses', { code, name, branch_id: branch.id })
    assert.equal(w.status, 201, JSON.stringify(w.body))
    ids[k] = w.body.data.id
  }
  const sup = await api('POST', '/parties', { party_type: 'supplier', name: 'Bengal Edible Oils', mobile: '01711000777' })
  assert.equal(sup.status, 201, JSON.stringify(sup.body))
  ids.supplier = sup.body.data.id
  const unit = (await api('GET', '/units?per_page=100')).body.data.find((u) => u.name === 'jar') ?? (await api('GET', '/units?per_page=100')).body.data[0]
  ids.unit = unit.name
  const income = (await api('GET', '/ledgers?purpose=income_for_product&per_page=100')).body.data[0]
  const prod = await api('POST', '/products', { item_type: 'product', name: 'Teer soybean oil 5L jar', unit_id: unit.id, selling_price: '950.00', income_ledger_id: income.id,
    last_purchase_cost: '845.0000', preferred_supplier_id: ids.supplier, warehouses: [{ warehouse_id: ids.tej, reorder_level: '30', reorder_qty: '18' }] })
  assert.equal(prod.status, 201, JSON.stringify(prod.body))
  ids.oil = prod.body.data.id
  await context.close()
})

test('TC-E2E-003: low stock → purchase order → bill posted → movement and stock', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/inventory/low-stock')
  await page.getByTestId('low-stock').getByText('Teer soybean oil 5L jar').waitFor()
  await page.getByTestId('tile-out').getByText('1').waitFor()
  await page.getByLabel('Select Teer soybean oil 5L jar').check()
  await page.getByTestId('create-pos').click()
  await page.getByText(/1 draft purchase order created/).waitFor()
  await page.waitForURL(/\/purchases\/orders\/\d+$/)
  ids.po = Number(/orders\/(\d+)$/.exec(page.url())[1])
  assert.deepEqual(sqlRows(`SELECT l.quantity, l.unit_cost FROM purchase_order_lines l WHERE l.purchase_order_id=${ids.po}`), [['18.000', '845.0000']])

  await page.getByTestId('convert-order').click()
  await page.waitForURL(/\/purchases\/bills\/\d+\/edit$/)
  await page.getByTestId('bill-form').waitFor()
  await page.locator('#f-supplier-bill').fill('CST-2201')
  await page.getByTestId('total-total').getByText('15,210.00').waitFor()
  await page.getByTestId('save-post').click()
  await page.getByTestId('post-dialog').waitFor()
  await page.getByTestId('confirm-post').click()
  await page.getByText(/BILL-\d{4}-0001 posted/).waitFor()
  assert.deepEqual(stock(ids.tej), ['18.000', '15210.00'])

  // D9 shows the purchase; D4 the stock in the warehouse
  await go(page, `/inventory/movements?product_id=${ids.oil}`)
  await page.locator('tbody tr', { hasText: /BILL-\d{4}-0001/ }).getByText('Purchase').waitFor()
  await go(page, '/inventory/products')
  await page.locator('tbody tr', { hasText: 'Teer soybean oil 5L jar' }).click()
  await page.getByTestId('product-name').getByText('Teer soybean oil 5L jar').waitFor()
  await page.getByTestId('tile-on-hand').getByText('18.000').waitFor()
  await page.getByTestId('stock-by-warehouse').getByText('Tejgaon warehouse').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('D10: counted 16 against 18 posts Dr 5002 ৳ 1,690 / Cr 1301-01', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, `/inventory/products/${ids.oil}`)
  await page.getByTestId('adjust-product').click()
  await page.waitForURL(/\/inventory\/adjustments\/new/)
  await page.locator('#adj-wh').selectOption(String(ids.tej))
  await page.getByLabel('Counted, line 1').fill('16')
  await page.getByTestId('save-adjustment').click()
  await page.getByText(/Draft ADJ-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/\/inventory\/adjustments\/\d+$/)
  ids.adj = Number(/adjustments\/(\d+)$/.exec(page.url())[1])
  await page.getByTestId('difference').getByText('-2.000').waitFor()
  await page.getByTestId('posting-preview').getByText('5002').waitFor()
  await page.getByTestId('post-adjustment').click()
  await confirm(page, 'Post')
  await page.getByText(/ADJ-\d{4}-0001 posted/).waitFor()
  assert.deepEqual(stock(ids.tej), ['16.000', '13520.00'])
  assert.deepEqual(entryLines(`je.source_type='stock_adjustments' AND je.source_id=${ids.adj}`), [['5002', '1690.00', '0.00'], ['1301-01', '0.00', '1690.00']])
  await go(page, '/inventory/adjustments')
  await page.locator('tbody tr', { hasText: /ADJ-\d{4}-0001/ }).getByText('Posted').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('D11: 6 jars to a warehouse with its own ledger go through stock in transit', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, `/inventory/warehouses/${ids.tej}`)
  await page.getByTestId('warehouse-name').getByText('Tejgaon warehouse').waitFor()
  await page.getByTestId('transfer-from').click()
  await page.waitForURL(/\/inventory\/transfers\/new/)
  await page.locator('#tr-to-wh').selectOption(String(ids.ngj))
  await page.getByLabel('Product, line 1').fill('Teer')
  await page.getByRole('listbox').getByRole('option', { name: /Teer soybean oil 5L jar/ }).click()
  await page.getByLabel('Quantity, line 1').fill('6')
  await page.locator('#tr-vehicle').fill('Dhaka Metro Ta 11-2345')
  await page.getByTestId('save-transfer').click()
  await page.getByText(/Draft TRF-\d{4}-0001 saved/).waitFor()
  await page.waitForURL(/\/inventory\/transfers\/\d+$/)
  ids.trf = Number(/transfers\/(\d+)$/.exec(page.url())[1])
  await page.getByTestId('dispatch-transfer').click()
  await confirm(page, 'Dispatch')
  await page.getByText(/TRF-\d{4}-0001 dispatched/).waitFor()
  assert.deepEqual(entryLines(`je.source_type='stock_transfers' AND je.source_id=${ids.trf} AND je.voucher_number LIKE 'TRF-%'`), [['1405', '5070.00', '0.00'], ['1301-01', '0.00', '5070.00']])
  await page.getByTestId('receive-transfer').click()
  await page.getByTestId('confirm-receive').click()
  await page.getByText(/TRF-\d{4}-0001 received/).waitFor()
  assert.deepEqual(stock(ids.ngj), ['6.000', '5070.00'])
  assert.deepEqual(entryLines(`je.source_type='stock_transfers' AND je.source_id=${ids.trf} AND je.voucher_number NOT LIKE 'TRF-%'`), [['1301-02', '5070.00', '0.00'], ['1405', '0.00', '5070.00']])
  await go(page, `/inventory/warehouses/${ids.ngj}`)
  await page.locator('tbody tr', { hasText: 'Teer soybean oil 5L jar' }).getByText('6.000').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('D13 valuation agrees with the trial balance; D14 summary; phone widths', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/inventory/valuation')
  await page.getByTestId('tile-value').getByText('13,520.00').waitFor()
  assert.equal(await page.getByTestId('check-ledger_agrees').getAttribute('data-ok'), 'true')
  assert.deepEqual(sqlRows(`SELECT SUM(jl.debit) - SUM(jl.credit) FROM journal_lines jl JOIN ledgers l ON l.id = jl.ledger_id WHERE l.ledger_kind = 'inventory'`), [['13520.00']])
  await go(page, '/inventory/summary')
  await page.getByTestId('summary-tiles').waitFor()
  await page.getByTestId('tile-value').getByText('13,520.00').waitFor()

  await page.setViewportSize(VIEWPORTS.phone)
  for (const u of ['/inventory/summary', '/inventory/low-stock', '/inventory/valuation', `/inventory/products/${ids.oil}`, `/inventory/warehouses/${ids.tej}`,
    '/inventory/adjustments', `/inventory/adjustments/${ids.adj}`, '/inventory/transfers', `/inventory/transfers/${ids.trf}`, '/inventory/adjustments/new']) {
    await go(page, u); await page.waitForTimeout(400); await assertNoPageScroll(page, u)
  }
  assert.deepEqual(errors, [])
  await context.close()
})

test('D1 import: a file is checked, then the item is created with opening stock', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  const dir = mkdtempSync(join(tmpdir(), 'pluto-imp-'))
  const bad = join(dir, 'bad.csv'), good = join(dir, 'good.csv')
  writeFileSync(bad, `Name,Unit,Selling price\nRupchanda oil 1L,${ids.unit},abc\n`)
  writeFileSync(good, `Name,Unit,Selling price,Warehouse,Opening qty,Opening cost\nRupchanda oil 1L,${ids.unit},190,WH-NGJ,40,170.50\n`)
  await go(page, '/inventory/products')
  await page.getByTestId('import-products').click()
  await page.getByTestId('import-input').setInputFiles(bad)
  await page.getByTestId('check-import').click()
  await page.getByTestId('import-errors').getByText(/not a valid number/).waitFor()
  assert.equal(await page.getByTestId('run-import').isDisabled(), true)
  await page.getByTestId('import-input').setInputFiles(good)
  await page.getByTestId('check-import').click()
  await page.getByText('1 of 1 rows are ready').waitFor()
  await page.getByTestId('run-import').click()
  await page.getByText('1 item imported').waitFor()
  await page.locator('tbody tr', { hasText: 'Rupchanda oil 1L' }).waitFor()
  assert.deepEqual(sqlRows(`SELECT b.qty_on_hand, b.total_value FROM stock_balances b JOIN products p ON p.id = b.product_id WHERE p.name = 'Rupchanda oil 1L'`), [['40.000', '6820.00']])
  assert.deepEqual(errors, [])
  await context.close()
})

test('viewer can look but not adjust', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, VIEWER)
  await go(page, '/inventory/adjustments')
  await page.locator('tbody tr').first().waitFor()
  assert.equal(await page.getByTestId('new-document').count(), 0)
  await go(page, `/inventory/products/${ids.oil}`)
  await page.getByTestId('product-name').waitFor()
  assert.equal(await page.getByTestId('adjust-product').count(), 0)
  assert.equal((await api('POST', '/stock-adjustments', { adjustment_date: '2026-10-31', warehouse_id: ids.tej, reason: 'damaged', lines: [] })).status, 403)
  await context.close()
})

test('books integrity check passes', () => {
  const out = artisan(['pluto:integrity'])
  assert.doesNotMatch(out, /\d+ failed/, out)
})
