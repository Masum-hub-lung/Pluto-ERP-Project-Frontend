/**
 * End-to-end for phase 14 (backlog P14.3-VAL-01; FR-010–FR-013; NFR-054; DEC-13) against the real API and MySQL.
 * The owner trades for the day through the API (a bank account, a bill, two invoices, one due today). Then in the UI:
 * - the owner lands on the dashboard; its revenue, expenses, net profit and money-owed figures equal the reports;
 * - TC-E2E-007: Ctrl K → the invoice number → open the invoice; Ctrl K → the same number → its voucher;
 * - Alt S opens a new invoice; the lenses open; a background export of the invoice list downloads a CSV;
 * - the overdue alert reaches the notifications centre and opens the invoice;
 * - Sales staff see sales but no profit, cash or balances, and never ledger results (DEC-13);
 * - phone widths fit; `pluto:integrity` passes.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { OWNER, SALES, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const dhaka = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const today = dhaka(new Date())
const tomorrow = dhaka(new Date(Date.now() + 86_400_000))
const monthStart = `${today.slice(0, 8)}01`

function artisan(args) {
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}

async function go(page, path) {
  await page.waitForLoadState('networkidle')
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

const ids = {}

test('owner trades for the day: a bank account, a bill, two invoices (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const ok = (r, s = 201) => assert.equal(r.status, s, JSON.stringify(r.body))
  const branch = (await api('GET', '/branches')).body.data[0]
  const warehouse = (await api('POST', '/warehouses', { code: 'WH-DSH', name: 'Dashboard depot', branch_id: branch.id })).body.data.id
  const unit = (await api('GET', '/units?per_page=100')).body.data[0]
  const income = (await api('GET', '/ledgers?purpose=income_for_product&per_page=100')).body.data[0]
  const oil = (await api('POST', '/products', { item_type: 'product', name: 'Teer soybean oil 5L', unit_id: unit.id, selling_price: '950.00', income_ledger_id: income.id })).body.data.id
  ok(await api('POST', '/money-accounts', { account_type: 'bank', bank_name: 'Pubali Bank', account_name: 'Meghna Traders Ltd.', account_number: '3301100045219', opening_balance: '500000.00' }))
  const supplier = (await api('POST', '/parties', { party_type: 'supplier', name: 'City Edible Oils', mobile: '01711000901' })).body.data.id
  const bill = await api('POST', '/purchase-bills', { party_id: supplier, supplier_bill_no: 'CEO-901', bill_date: today, warehouse_id: warehouse,
    lines: [{ product_id: oil, quantity: '100', unit_cost: '800.00' }] })
  ok(bill)
  ok(await api('POST', `/purchase-bills/${bill.body.data.id}/post`, {}), 200)
  const customer = (await api('POST', '/parties', { party_type: 'customer', name: 'Rahim Store', mobile: '01711000902' })).body.data.id
  for (const qty of ['20', '15']) {
    const inv = await api('POST', '/sales-invoices', { party_id: customer, invoice_date: today, due_date: today, warehouse_id: warehouse, lines: [{ product_id: oil, quantity: qty }] })
    ok(inv)
    const posted = await api('POST', `/sales-invoices/${inv.body.data.id}/post`, {})
    ok(posted, 200)
    ids.invoices = [...(ids.invoices ?? []), posted.body.data]
  }
  ids.invoice = ids.invoices[0]
  ids.voucher = Number(sqlRows(`SELECT id FROM journal_entries WHERE voucher_number='${ids.invoice.number}' AND entry_type='sales_invoice'`)[0][0])
  await context.close()
})

test('the owner lands on the dashboard and its figures equal the reports', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  await page.waitForURL(/\/dashboard$/)
  const pl = (await api('GET', `/reports/profit-and-loss?date_from=${monthStart}&date_to=${today}`)).body.data.totals
  assert.deepEqual([pl.revenue, pl.expenses, pl.net_profit], ['33250.00', '28000.00', '5250.00'])
  await page.getByTestId('kpi-revenue-value').getByText('৳ 33,250.00').waitFor()
  await page.getByTestId('kpi-expenses-value').getByText('৳ 28,000.00').waitFor()
  await page.getByTestId('kpi-net_profit-value').getByText('৳ 5,250.00').waitFor()
  await page.getByTestId('kpi-cash-value').getByText('৳ 5,00,000.00').waitFor()
  const aging = (await api('GET', '/reports/receivables-aging')).body.data.totals
  assert.equal(aging.total, '33250.00')
  await page.getByTestId('owed-receivable').getByText('৳ 33,250.00').first().waitFor()
  await page.getByTestId('owed-payable').getByText('৳ 80,000.00').first().waitFor()
  await page.getByTestId('chart-revenue-expenses').waitFor()
  await page.getByTestId('recent-transactions').getByText(ids.invoice.number).waitFor()
  // Today feed (PEP-478): the API's newest posting of the day is the first row and opens its voucher.
  const feed = (await api('GET', '/dashboard')).body.data.today
  assert.ok(feed.count > 0, 'the seed posted vouchers today')
  await page.getByTestId('today-feed').getByRole('button', { name: new RegExp(feed.items[0].voucher_number) }).first().waitFor()
  await page.getByText(`${feed.count} posted since midnight`).waitFor()

  await page.getByTestId('lens-nav').getByText('Financial', { exact: true }).click()
  await page.waitForURL(/\/dashboard\/financial$/)
  await page.getByTestId('ratios').getByText('Gross margin').waitFor()
  await go(page, '/dashboard/receivables')
  await page.getByTestId('lens-table').getByText('Rahim Store').waitFor()
  await go(page, '/dashboard?period=this_year')
  await page.getByTestId('kpi-revenue-value').getByText('৳ 33,250.00').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('TC-E2E-007: Ctrl K finds the invoice by number, opens it, then its voucher; Alt S opens a new invoice', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await page.waitForURL(/\/dashboard$/)
  await page.getByTestId('kpi-revenue-value').waitFor() // the shell and its shortcuts are ready
  await page.keyboard.press('Control+k')
  await page.getByTestId('palette-input').fill(ids.invoice.number)
  await page.getByTestId(`palette-sales_invoice-${ids.invoice.id}`).waitFor()
  await page.keyboard.press('Enter')
  await page.waitForURL(new RegExp(`/sales/invoices/${ids.invoice.id}$`))

  await page.getByText(ids.invoice.number).first().waitFor()
  await page.keyboard.press('Control+k')
  await page.getByTestId('palette-input').fill(ids.invoice.number)
  await page.getByTestId(`palette-voucher-${ids.voucher}`).click()
  await page.waitForURL(new RegExp(`/accounting/vouchers/${ids.voucher}$`))
  await page.getByText(ids.invoice.number).first().waitFor()

  await page.locator('main').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Alt+s')
  await page.waitForURL(/\/sales\/invoices\/new$/)

  await go(page, `/search?q=${encodeURIComponent('Rahim')}`)
  await page.getByTestId('results-party').getByText('Rahim Store').waitFor()
  await go(page, `/search?q=${encodeURIComponent(ids.invoice.number)}`)
  await page.getByTestId('results-sales_invoice').getByText(ids.invoice.number, { exact: true }).waitFor()
  await page.getByTestId('results-voucher').getByText(ids.invoice.number, { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('the invoice list exports in the background and downloads a CSV', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/sales/invoices')
  await page.getByTestId('export-list').click()
  const download = page.waitForEvent('download')
  await page.getByText('CSV', { exact: true }).click()
  const file = await download
  assert.match(file.suggestedFilename(), /^sales-invoices-\d{8}-\d{4}\.csv$/)
  const text = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'))
  assert.ok(text.includes(ids.invoice.number), 'the invoice is in the file')
  await page.getByText('Export ready').first().waitFor()
  assert.deepEqual(sqlRows("SELECT kind, status FROM export_jobs ORDER BY id DESC LIMIT 1"), [['list', 'complete']])
  assert.deepEqual(errors, [])
  await context.close()
})

test('the overdue alert reaches the notifications centre and opens the invoice', async () => {
  artisan(['pluto:alerts:run', `--date=${tomorrow}`])
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/notifications?tab=alerts')
  const item = page.getByText(`${ids.invoice.number} is overdue`)
  await item.waitFor()
  await item.click()
  await page.waitForURL(new RegExp(`/sales/invoices/${ids.invoice.id}$`))
  await go(page, '/notifications?tab=unread')
  await page.getByText(`${ids.invoices[1].number} is overdue`).waitFor()
  await page.getByTestId('centre-read-all').click()
  await page.getByText('You are all caught up').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('DEC-13: Sales staff see sales but no profit, cash or balances, and no ledger results', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, SALES)
  await page.waitForURL(/\/dashboard$/)
  await page.getByTestId('kpi-sales-value').getByText('৳ 33,250.00').waitFor()
  for (const k of ['kpi-revenue', 'kpi-net_profit', 'kpi-cash', 'widget-money_owed', 'widget-cash_position', 'widget-revenue_vs_expenses']) {
    assert.equal(await page.getByTestId(k).count(), 0, k)
  }
  const tabs = await page.getByTestId('lens-nav').textContent()
  assert.ok(!/Financial|Receivables|Cash and bank/.test(tabs ?? ''), tabs)
  await go(page, '/dashboard/financial')
  await page.getByTestId('state-denied').getByText('reports.financial').waitFor()
  await go(page, '/dashboard')
  await page.getByTestId('kpi-sales-value').waitFor()

  await page.keyboard.press('Control+k')
  await page.getByTestId('palette-input').fill('Sales')
  await page.getByTestId('palette-input').fill(ids.invoice.number)
  await page.getByTestId(`palette-sales_invoice-${ids.invoice.id}`).waitFor()
  assert.equal(await page.locator('[data-testid^="palette-ledger-"]').count(), 0)
  assert.equal(await page.locator('[data-testid^="palette-voucher-"]').count(), 0)
  assert.deepEqual(errors.filter((e) => !/403/.test(e)), [])
  await context.close()
})

test('phone widths fit', async () => {
  const { context, page, errors } = await newPage({ viewport: VIEWPORTS.phone })
  await signIn(page, OWNER)
  for (const u of ['/dashboard', '/dashboard/financial', '/dashboard/sales', '/dashboard/expenses', '/dashboard/receivables', '/dashboard/payables', '/dashboard/cash',
    '/dashboard/inventory', '/search?q=Rahim', '/notifications']) {
    await go(page, u); await page.waitForTimeout(400); await assertNoPageScroll(page, u)
  }
  assert.deepEqual(errors, [])
  await context.close()
})

test('books integrity check passes', () => {
  const out = artisan(['pluto:integrity'])
  assert.doesNotMatch(out, /\d+ failed/, out)
})
