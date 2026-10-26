/**
 * End-to-end for phase 8 (backlog P8.3-VAL-01; TC-E2E-002 without the A6/G12 steps until P12/P14; FR-052): a supplier's
 * bill (C4 → F4) is paid from F4's "Record payment" (F5 + Pur-DlgPay) and shows as paid; a payment larger than the
 * bank balance is refused (BR-031); an Accountant payment above ৳ 50,000 waits for approval and the Owner approves it
 * (BR-007), after which it settles the oldest open bill; the books stay consistent.
 * Named vendor-payments (the backlog's pay-a-supplier) so it runs after purchase-bill and suppliers, whose empty
 * states it would otherwise fill; files run alphabetically on one shared E2E database.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { ACCOUNTANT, OWNER, apiFor, launch, newPage as open, signIn } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

function artisan(args) {
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}

async function go(page, path) {
  await page.waitForLoadState('networkidle')
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

const ids = {}

test('owner sets up a supplier with two bills and a bank account (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const branch = (await api('GET', '/branches')).body.data[0]
  ids.warehouse = (await api('POST', '/warehouses', { code: 'WH-PAY', name: 'Payments depot', branch_id: branch.id })).body.data.id
  const supplier = await api('POST', '/parties', { party_type: 'supplier', name: 'Jamuna Oil Mills', mobile: '01711000888' })
  assert.equal(supplier.status, 201, JSON.stringify(supplier.body))
  ids.supplier = supplier.body.data.id
  const unit = (await api('GET', '/units?per_page=100')).body.data[0]
  const income = (await api('GET', '/ledgers?purpose=income_for_product&per_page=100')).body.data[0]
  const product = (await api('POST', '/products', { item_type: 'product', name: 'Jamuna soybean oil 5L', unit_id: unit.id, selling_price: '900.00', income_ledger_id: income.id })).body.data.id
  for (const [no, qty] of [['JOM-1', '100'], ['JOM-2', '700']]) {
    const bill = await api('POST', '/purchase-bills', { party_id: ids.supplier, supplier_bill_no: no, bill_date: today, warehouse_id: ids.warehouse,
      lines: [{ product_id: product, quantity: qty, unit_cost: '100.00' }] })
    assert.equal(bill.status, 201, JSON.stringify(bill.body))
    assert.equal((await api('POST', `/purchase-bills/${bill.body.data.id}/post`, {})).status, 200)
    ids[no] = bill.body.data.id
  }
  const bank = await api('POST', '/money-accounts', { account_type: 'bank', bank_name: 'Pubali Bank', account_name: 'Meghna Traders Ltd.', account_number: '2201100045219', opening_balance: '100000.00' })
  assert.equal(bank.status, 201, JSON.stringify(bank.body))
  ids.bank = bank.body.data.id
  await context.close()
})

test('TC-E2E-002: pay a bill from F4 → F5 → the bill is paid', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, ACCOUNTANT)
  await go(page, `/purchases/bills/${ids['JOM-1']}?tab=payments`)
  await page.getByTestId('record-payment').click()
  await page.waitForURL(/\/purchases\/payments\/new/)
  await page.getByTestId('payment-form').waitFor()
  await page.getByTestId('open-bills').getByText(/BILL-/).first().waitFor()
  await page.waitForFunction(() => document.querySelector('#rc-amount')?.value === '10000.00') // the bill balance (server figure) becomes the amount
  await page.locator('#rc-account').selectOption(String(ids.bank))
  await page.getByTestId('save-payment').click()
  await page.getByRole('button', { name: 'Save payment' }).last().click()
  await page.waitForURL(/\/purchases\/payments\/\d+$/)
  await page.getByTestId('payment-status').getByText('Posted').waitFor()
  assert.match(await page.getByTestId('payment-number').innerText(), /^PV-\d{4}-\d{4}$/)
  await page.getByTestId('payment-allocations').getByText(/BILL-/).waitFor()
  await go(page, `/purchases/bills/${ids['JOM-1']}`)
  await page.getByText(/Paid/).first().waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('BR-031: a payment larger than the bank balance is refused', async () => {
  const { context, page } = await newPage()
  await signIn(page, OWNER)
  await go(page, `/purchases/payments/new?party_id=${ids.supplier}`)
  await page.getByTestId('payment-form').waitFor()
  await page.getByLabel('Amount paid (৳)').fill('500000')
  await page.locator('#rc-account').selectOption(String(ids.bank))
  await page.getByTestId('apply-mode').getByText('Keep as advance').click()
  await page.getByTestId('save-payment').click()
  await page.getByRole('button', { name: 'Save payment' }).last().click()
  await page.getByText('More than the account holds').waitFor()
  assert.match(page.url(), /\/purchases\/payments\/new/, 'nothing saved')
  await context.close()
})

test('TC-PUR-006: an Accountant payment above the limit waits; the Owner approves; it settles the oldest bill', async () => {
  let paymentId
  {
    const { context, page, errors } = await newPage()
    await signIn(page, ACCOUNTANT)
    await go(page, `/purchases/payments/new?party_id=${ids.supplier}`)
    await page.getByTestId('open-bills').waitFor()
    await page.getByLabel('Amount paid (৳)').fill('70000')
    await page.locator('#rc-account').selectOption(String(ids.bank))
    await page.getByTestId('save-payment').click()
    await page.getByRole('button', { name: 'Save payment' }).last().click()
    await page.waitForURL(/\/purchases\/payments\/\d+$/)
    await page.getByTestId('payment-status').getByText('Awaiting approval').waitFor()
    paymentId = Number(/payments\/(\d+)/.exec(page.url())[1])
    assert.deepEqual(errors, [])
    await context.close()
  }
  {
    const { context, page, errors } = await newPage()
    const api = apiFor(page)
    await signIn(page, OWNER)
    await go(page, `/purchases/payments/${paymentId}`)
    await page.getByTestId('open-approval').click()
    await page.getByTestId('approve').click()
    await page.getByText(/approved and posted/).waitFor()
    const bill = (await api('GET', `/purchase-bills/${ids['JOM-2']}`)).body.data
    assert.equal(bill.balance_due, '0.00', 'settled on approval, oldest first')
    const p = (await api('GET', `/supplier-payments/${paymentId}`)).body.data
    assert.equal(p.status, 'posted')
    assert.equal(p.payment.unapplied_amount, '0.00')
    assert.deepEqual(errors, [])
    await context.close()
  }
  assert.match(artisan(['pluto:integrity']), /All books are consistent/)
})
