/**
 * End-to-end for LC finance inside the LC portal (backlog P16.6-VAL-01; TC-LC-014..016; BR-066–BR-068) against the real API
 * and MySQL, to the taka:
 * - Banks and limits: the owner sets Sonali Bank's LC limit ৳ 40,00,000 (warn), 9 % a year, 90 days, actual/360;
 *   the LC (US$ 38,400 × 121.50 = ৳ 46,65,600 planned) is over it and carries LC_LIMIT_EXCEEDED;
 * - FX revaluation: the open import bill (US$ 38,400 at 121.50) at a closing 123.00 → loss ৳ 57,600, reversed next day;
 * - LC-DlgPay as bank finance (LTR) on today − 30: Dr supplier 46,88,640 / Cr margin 9,33,120 / Cr 2303 37,55,520;
 * - repay ৳ 17,55,520 today: interest 30 days × 9 % / 360 on 37,55,520 = ৳ 28,166.40 (the API's quote in the dialog);
 * - reverse that repayment, then repay in full: interest ৳ 28,166.40 again; the loan is repaid; 2303 is zero;
 * - loans and exposure reports open; Viewer reads only; phone widths fit; `pluto:integrity` passes.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { OWNER, VIEWER, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const dhaka = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const day = (offset) => dhaka(new Date(Date.now() + offset * 86_400_000))
const today = day(0)

function artisan(args) {
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}
const ledgerBalance = (code, asOf) => sqlRows(`SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) FROM journal_lines l JOIN ledgers g ON g.id = l.ledger_id
  WHERE g.code = '${code}' AND l.is_posted = 1${asOf ? ` AND l.entry_date <= '${asOf}'` : ''}`)[0][0]

const ids = {}

test('masters, an opened LC and its open import bill (API)', async () => {
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
  await context.close()
})

test('TC-LC-014: Banks and limits in the LC portal; the LC over the limit is flagged', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  await page.goto('/lc/banks')
  await page.getByRole('heading', { name: 'Banks and limits' }).waitFor()
  await page.getByText('No bank limits yet').waitFor()
  await page.getByTestId('add-facility').click()
  await page.locator('#fac-bank').selectOption(String(ids.bank))
  await page.locator('#fac-lc').fill('4000000.00')
  await page.locator('#fac-rate').fill('9')
  await page.locator('#fac-tenor').fill('90')
  await page.getByTestId('save-facility').click()
  await page.getByText(/limits saved/).waitFor()
  await page.getByTestId('facilities').getByText('9.0000 % · 90 days · actual/360').waitFor()

  const lc = await api('POST', '/letters-of-credit', { party_id: ids.supplier, goods_description: '20,000 kg crude palm oil', quantity: '20000', quantity_unit: 'kg', tenor: 'sight',
    incoterm: 'CFR Chattogram', currency_code: 'USD', amount: '38400.00', tolerance_pct: '5', planning_rate: '121.50', margin_pct: '20', margin_account_id: ids.bank,
    issuing_bank_account_id: ids.bank, expiry_date: day(60) })
  assert.equal(lc.status, 201, JSON.stringify(lc.body))
  ids.lc = lc.body.data.id
  const sub = await api('POST', `/letters-of-credit/${ids.lc}/transition`, { action: 'submit' }, { 'X-If-Match': 'W/"1"' })
  assert.equal(sub.status, 200, JSON.stringify(sub.body))
  const opened = await api('POST', `/letters-of-credit/${ids.lc}/transition`, { action: 'mark_opened', bank_reference: 'SBL/LC/2026/0419', date: today }, { 'X-If-Match': `W/"${sub.body.data.version}"` })
  assert.equal(opened.status, 200, JSON.stringify(opened.body))
  assert.ok(opened.body.data.flags.some((f) => f.code === 'LC_LIMIT_EXCEEDED'), JSON.stringify(opened.body.data.flags))
  ids.lcNumber = opened.body.data.lc_number

  await page.reload()
  await page.getByTestId('facilities').getByText('46,65,600.00').waitFor()
  await page.getByTestId('facilities').getByText('Over limit').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('TC-LC-016: FX revaluation of the open import bill in the LC portal', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const bill = await api('POST', '/purchase-bills', { party_id: ids.supplier, supplier_bill_no: 'SEO-CI-88', bill_date: day(-5), warehouse_id: ids.warehouse, letter_of_credit_id: ids.lc,
    lines: [{ product_id: ids.oil, quantity: '20000', unit_cost: '1.92' }] })
  assert.equal(bill.status, 201, JSON.stringify(bill.body))
  const posted = await api('POST', `/purchase-bills/${bill.body.data.id}/post`, {})
  assert.equal(posted.status, 200, JSON.stringify(posted.body))
  assert.equal(posted.body.data.total, '4665600.00')

  await page.goto('/lc/fx-revaluation')
  await page.getByRole('heading', { name: 'FX revaluation' }).waitFor()
  await page.getByText('No revaluations yet').waitFor()
  await page.locator('#fx-date').fill(day(-1))
  await page.locator('#fx-rate-0').fill('123.00')
  await page.getByTestId('fx-preview').click()
  await page.getByTestId('fx-total').getByText('৳ 57,600.00').waitFor()
  await page.getByTestId('fx-result').getByText('38400.00').first().waitFor()
  await page.getByTestId('fx-post').click()
  await page.getByText(/Revaluation of .* posted/).waitFor()
  await page.getByTestId('fx-history').getByText('USD 123.00').waitFor()
  assert.equal(ledgerBalance('6603', day(-1)), '57600.00')
  assert.equal(ledgerBalance('6603'), '0.00', 'reversed the next day')
  assert.deepEqual(errors, [])
  await context.close()
})

test('TC-LC-015: a financed LC payment opens an LTR; repay, reverse and repay in full', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const margin = await api('POST', '/lc-charges', { letter_of_credit_id: ids.lc, charge_type: 'margin_deposit', charge_date: day(-30), amount: '933120.00', status: 'paid', paid_from_account_id: ids.bank })
  assert.equal(margin.status, 201, JSON.stringify(margin.body))

  // LC-DlgPay as bank finance (LTR), dated today − 30, with the facility's terms.
  await page.goto(`/lc/${ids.lc}`)
  await page.getByTestId('lc-record-payment').click()
  await page.locator('#pay-rate').fill('122.10')
  await page.locator('#pay-date').fill(day(-30))
  await page.locator('#pay-margin').fill('933120.00')
  await page.getByRole('radio', { name: 'Bank finance (PAD/LTR)' }).click()
  await page.getByTestId('pay-loan-terms').getByText('(9.0000 %, 90 days, actual/360)').waitFor()
  await page.locator('#pay-account').selectOption(String(ids.bank))
  await page.getByTestId('save-lc-payment').click()
  await page.getByText('LTR loan opened').waitFor()
  assert.equal(ledgerBalance('2303'), '-3755520.00')
  await page.goto(`/lc/${ids.lc}?tab=money`)
  await page.getByTestId('lc-payments').getByRole('link', { name: 'Bank finance (LTR)' }).click()
  await page.waitForURL(/\/lc\/loans\/\d+$/)
  ids.loan = Number(new URL(page.url()).pathname.split('/').pop())
  await page.getByTestId('loan-number').getByText(`${ids.lcNumber}/L1`).waitFor()
  await page.getByTestId('loan-outstanding').getByText('৳ 37,55,520.00').waitFor()
  await page.getByTestId('loan-interest').getByText('৳ 28,166.40').waitFor()

  // Part repayment: 30 days × 9 % / 360 on 37,55,520 = ৳ 28,166.40, quoted by the API.
  await page.getByTestId('repay-loan').click()
  await page.getByTestId('quote-total').getByText('৳ 28,166.40').waitFor()
  await page.locator('#rep-principal').fill('1755520.00')
  await page.getByTestId('save-repayment').click()
  await page.getByText(/Principal ৳ 17,55,520.00 · interest ৳ 28,166.40/).waitFor()
  await page.getByTestId('loan-outstanding').getByText('৳ 20,00,000.00').waitFor()
  assert.equal(ledgerBalance('6601'), '28166.40')

  // Reverse it: the loan owes ৳ 37,55,520 again from the start date.
  const first = (await api('GET', `/lc-loans/${ids.loan}`)).body.data.repayments[0]
  await page.getByTestId(`reverse-repayment-${first.id}`).click()
  await page.locator('#reason-input').fill('Bank debited the wrong account')
  await page.getByRole('dialog').getByRole('button', { name: 'Reverse', exact: true }).click()
  await page.getByText('Repayment reversed').waitFor()
  await page.getByTestId('loan-outstanding').getByText('৳ 37,55,520.00').waitFor()
  assert.deepEqual([ledgerBalance('2303'), ledgerBalance('6601')], ['-3755520.00', '0.00'])

  // Repay in full (the principal defaults to what is outstanding).
  await page.getByTestId('repay-loan').click()
  await page.getByTestId('quote-total').getByText('৳ 28,166.40').waitFor()
  await page.getByTestId('save-repayment').click()
  await page.getByText(`${ids.lcNumber}/L1 repaid in full`).waitFor()
  await page.getByText('Repaid').first().waitFor()
  assert.deepEqual([ledgerBalance('2303'), ledgerBalance('6601')], ['0.00', '28166.40'])

  // Loans list and the LC reports in the portal.
  await page.goto('/lc/loans?status=repaid')
  await page.getByTestId('loans').getByText(`${ids.lcNumber}/L1`).waitFor()
  await page.goto('/lc/reports/loans?segment=all')
  await page.getByTestId('lc-report-loans').getByText(`${ids.lcNumber}/L1`).waitFor()
  await page.goto('/lc/reports/exposure')
  await page.getByTestId('lc-report-exposure').getByText('Sonali Bank', { exact: false }).first().waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('Viewer reads LC finance only; phone widths fit; books are consistent', async () => {
  const { context, page } = await newPage()
  await signIn(page, VIEWER)
  await page.goto(`/lc/loans/${ids.loan}`)
  await page.getByTestId('loan-number').waitFor()
  assert.equal(await page.getByTestId('repay-loan').count(), 0)
  await page.goto('/lc/banks')
  await page.getByTestId('facilities').waitFor()
  assert.equal(await page.getByTestId('add-facility').count(), 0)
  await context.close()

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const { context: c, page: p } = await newPage({ viewport })
    await signIn(p, OWNER)
    for (const path of ['/lc/banks', '/lc/loans', `/lc/loans/${ids.loan}`, '/lc/fx-revaluation']) {
      await p.goto(path)
      await p.getByRole('heading').first().waitFor()
      await assertNoPageScroll(p, `${path} @ ${name}`)
    }
    await c.close()
  }
  const out = artisan(['pluto:integrity'])
  assert.doesNotMatch(out, /\d+ failed/, out)
})
