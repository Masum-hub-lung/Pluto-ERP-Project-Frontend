/**
 * End-to-end for phase 9 (backlog P9.3-VAL-01; FR-076; 06 §17; DEC-13): after a month of trading through the real
 * forms' APIs (a bank account, a supplier bill paid in part, two customer invoices received in part), the financial
 * statements agree with themselves and with the books — TB debits = credits, P&L net profit = income − expenses,
 * the balance sheet balances, cash flow closing = cash and bank, aging totals = party ledgers — every report opens at
 * the four widths without sideways scroll, an Excel export downloads a real .xlsx, and Sales staff see no financial
 * report (DEC-13: no cards in J1, 403 on the statements).
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { ACCOUNTANT, OWNER, SALES, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

async function go(page, path) {
  await page.waitForLoadState('networkidle')
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

const REPORTS = [
  ['/reports/trial-balance', 'Trial balance', 'balanced'], ['/reports/profit-and-loss', 'Profit and loss', 'net_profit'],
  ['/reports/balance-sheet', 'Balance sheet', 'balanced'], ['/reports/cash-flow', 'Cash flow statement', 'cash_reconciled'],
  ['/reports/receivables-aging', 'Receivables aging', 'party_balances'], ['/reports/payables-aging', 'Payables aging', 'party_balances'],
]

test('owner trades for a month: bank, a bill paid in part, invoices received in part (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const ok = (r, s = 201) => assert.equal(r.status, s, JSON.stringify(r.body))
  const branch = (await api('GET', '/branches')).body.data[0]
  const warehouse = (await api('POST', '/warehouses', { code: 'WH-RPT', name: 'Reports depot', branch_id: branch.id })).body.data.id
  const unit = (await api('GET', '/units?per_page=100')).body.data[0]
  const income = (await api('GET', '/ledgers?purpose=income_for_product&per_page=100')).body.data[0]
  const oil = (await api('POST', '/products', { item_type: 'product', name: 'Teer soybean oil 5L', unit_id: unit.id, selling_price: '950.00', income_ledger_id: income.id })).body.data.id
  const bank = await api('POST', '/money-accounts', { account_type: 'bank', bank_name: 'Pubali Bank', account_name: 'Meghna Traders Ltd.', account_number: '3301100045219', opening_balance: '500000.00' })
  ok(bank)
  const supplier = (await api('POST', '/parties', { party_type: 'supplier', name: 'City Edible Oils', mobile: '01711000901' })).body.data.id
  const bill = await api('POST', '/purchase-bills', { party_id: supplier, supplier_bill_no: 'CEO-901', bill_date: today, warehouse_id: warehouse,
    lines: [{ product_id: oil, quantity: '100', unit_cost: '800.00' }] })
  ok(bill)
  ok(await api('POST', `/purchase-bills/${bill.body.data.id}/post`, {}), 200)
  ok(await api('POST', '/supplier-payments', { party_id: supplier, date: today, amount: '30000.00', money_account_id: bank.body.data.id, method: 'bank_transfer', auto_allocate: true }))
  const customer = (await api('POST', '/parties', { party_type: 'customer', name: 'Rahim Store', mobile: '01711000902' })).body.data.id
  for (const qty of ['20', '15']) {
    const inv = await api('POST', '/sales-invoices', { party_id: customer, invoice_date: today, warehouse_id: warehouse, lines: [{ product_id: oil, quantity: qty }] })
    ok(inv)
    ok(await api('POST', `/sales-invoices/${inv.body.data.id}/post`, {}), 200)
  }
  ok(await api('POST', '/customer-receipts', { party_id: customer, date: today, amount: '10000.00', money_account_id: bank.body.data.id, method: 'bank_transfer', auto_allocate: true }))
  await context.close()
})

test('the statements agree with themselves and with the books (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, ACCOUNTANT)
  const report = async (path, query = '') => { const r = await api('GET', `/reports/${path}${query}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.data }
  const allOk = (r) => assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.message), [], r.title)

  const tb = await report('trial-balance')
  assert.equal(tb.totals.debit, tb.totals.credit, 'TB debits = credits')
  allOk(tb)
  const pl = await report('profit-and-loss', `?date_from=${today}&date_to=${today}`)
  allOk(pl)
  assert.equal(pl.totals.net_profit, '5250.00', 'sales 35 × 950 = 33,250 − cost 35 × 800 = 28,000')
  const bs = await report('balance-sheet')
  allOk(bs)
  assert.equal(bs.totals.assets, bs.totals.liabilities_and_equity)
  const cf = await report('cash-flow')
  allOk(cf)
  const book = (await api('GET', '/money-accounts')).body.data.find((a) => a.bank_name === 'Pubali Bank')
  assert.equal(cf.totals.closing_cash, book.book_balance, 'closing cash = the bank book balance (5,00,000 − 30,000 + 10,000)')
  const ar = await report('receivables-aging')
  allOk(ar)
  assert.equal(ar.totals.total, '23250.00')
  const ap = await report('payables-aging')
  allOk(ap)
  assert.equal(ap.totals.total, '50000.00')
  await context.close()
})

test('every report opens at four widths with its green checks; Excel export downloads', async () => {
  const { context, page, errors } = await newPage({ acceptDownloads: true })
  await signIn(page, ACCOUNTANT)
  await go(page, '/reports')
  await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor()
  for (const [path] of REPORTS) assert.ok(await page.getByTestId(`report-${path}`).isVisible(), `J1 lists ${path}`)
  for (const [name, size] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(size)
    await assertNoPageScroll(page, `/reports at ${name}`)
    const cramped = await page.locator('[data-testid^="report-/"]').evaluateAll((cards) => cards
      .filter((c) => c.clientWidth < 200 || c.scrollWidth > c.clientWidth || [...c.querySelectorAll('*')].some((x) => x.getBoundingClientRect().right > c.getBoundingClientRect().right + 1))
      .map((c) => `${c.dataset.testid} (${c.clientWidth}px)`))
    assert.deepEqual(cramped, [], `J1 cards keep their text inside at ${name}`)
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/reports-${name}.png`, fullPage: true })
  }
  await page.setViewportSize(VIEWPORTS.desktop)
  await page.getByLabel('Find a report').fill('aging')
  await page.getByTestId('report-/reports/payables-aging').waitFor()
  assert.equal(await page.getByTestId('report-/reports/trial-balance').count(), 0, 'search narrows the cards')
  await page.getByTestId('report-/reports/payables-aging').click()
  await page.waitForURL(/\/reports\/payables-aging/)

  for (const [path, title, check] of REPORTS) {
    await go(page, path)
    await page.getByRole('region', { name: title }).waitFor()
    assert.equal(await page.getByTestId(`check-${check}`).getAttribute('data-ok'), 'true', `${title}: ${await page.getByTestId(`check-${check}`).innerText()}`)
    for (const [name, size] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(size)
      await assertNoPageScroll(page, `${path} at ${name}`)
    }
    await page.setViewportSize(VIEWPORTS.desktop)
  }

  await go(page, '/reports/trial-balance')
  await page.getByRole('region', { name: 'Trial balance' }).waitFor()
  await page.getByText('Cash in hand').or(page.getByText('Pubali Bank')).first().waitFor()
  await page.getByTestId('export-menu').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Excel/ }).click()])
  assert.match(download.suggestedFilename(), /^trial-balance-\d{8}\.xlsx$/)
  const stream = await download.createReadStream()
  const chunks = []
  for await (const c of stream) chunks.push(c)
  assert.equal(Buffer.concat(chunks).subarray(0, 2).toString(), 'PK', 'an .xlsx is a zip package Excel opens')
  assert.deepEqual(errors, [])
  await context.close()
})

test('DEC-13: Sales staff see no financial report', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, SALES)
  await go(page, '/reports')
  await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor()
  for (const [path] of REPORTS) assert.equal(await page.getByTestId(`report-${path}`).count(), 0, `no ${path} card`)
  await go(page, '/reports/trial-balance')
  await page.getByTestId('state-denied').waitFor()
  assert.equal((await api('GET', '/reports/balance-sheet')).status, 403)
  await context.close()
})
