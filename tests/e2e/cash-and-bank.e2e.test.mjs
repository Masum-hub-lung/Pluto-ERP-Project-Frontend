/**
 * End-to-end for phase 12 (backlog P12.3-VAL-01, cash and bank) against the real API and MySQL. The owner sets up a cash
 * box and two bank accounts (API). Then through the UI:
 * - G9: ৳ 1,00,000 from Sonali to Dutch-Bangla with a ৳ 50 bank charge → Dr Dutch-Bangla 1,00,000, Dr 6702 50, Cr Sonali 1,00,050 (TC-BNK-001).
 * - G8: moving more cash than the cash box holds is refused (BR-031, TC-BNK-002).
 * - G2: a cash count ৳ 500 short records a journal that waits for approval; the Finance manager approves it (BR-058).
 * - G10: a statement is imported (the same file twice is refused), suggestions accepted, the bank charge recorded, and
 *   the reconciliation finishes at zero (TC-E2E-004 reconcile step).
 * - G12: the bank book shows a supplier payment (TC-E2E-002 finish). G1 and G13 load; phone widths fit; `pluto:integrity` passes.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OWNER, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const FINANCE = 'finance@e2e.pluto.test'

function artisan(args, env = {}) {
  const e = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', ...e, 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}

async function go(page, path) {
  await page.waitForLoadState('networkidle')
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

const ids = {}
const balance = (ledger) => sqlRows(`SELECT COALESCE(SUM(debit) - SUM(credit), 0) FROM journal_lines WHERE ledger_id=${ledger} AND is_posted=1`)[0][0]

test('owner sets up a cash box, two bank accounts, a supplier and a finance manager (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const add = async (body) => { const r = await api('POST', '/money-accounts', body); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.data }
  ids.cash = await add({ account_type: 'cash', name: 'Head office cash', opening_balance: '20000.00' })
  ids.sonali = await add({ account_type: 'bank', bank_name: 'Sonali Bank', account_name: 'Meghna Traders Ltd.', account_number: '0012345678', opening_balance: '250000.00' })
  ids.dbbl = await add({ account_type: 'bank', bank_name: 'Dutch-Bangla Bank', account_name: 'Meghna Traders Ltd.', account_number: '1051100045219', opening_balance: '0.00' })
  const sup = await api('POST', '/parties', { party_type: 'supplier', name: 'Bengal Edible Oils', mobile: '01711000777' })
  ids.supplier = sup.body.data.id
  // A Finance manager to approve the cash-count difference (the counter may not approve their own)
  artisan(['pluto:user:add', '1', FINANCE, '--role=finance', '--name=E2E finance'], { PLUTO_USER_PASSWORD: process.env.E2E_PASSWORD })
  await context.close()
})

test('G9 bank transfer of ৳ 1,00,000 with a ৳ 50 charge; G8 cash transfer above the balance is refused', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/banking')
  await page.getByTestId('banking-tiles').waitFor()
  await page.getByTestId('go-transfer').click()
  await page.waitForURL(/\/banking\/bank-transfer/)
  await page.locator('#v-acc').selectOption(String(ids.sonali.id))
  await page.getByLabel('Account, line 1').selectOption(String(ids.dbbl.id))
  await page.getByLabel('Amount, line 1').fill('100000')
  await page.locator('#v-charge').fill('50')
  await page.getByTestId('posting-preview').getByText('6702').waitFor()
  await page.getByTestId('post-voucher').click()
  await page.waitForURL(/\/accounting\/vouchers\/\d+$/)
  assert.equal(balance(ids.sonali.ledger_id), '149950.00')
  assert.equal(balance(ids.dbbl.ledger_id), '100000.00')
  const v = Number(/vouchers\/(\d+)/.exec(page.url())[1])
  assert.deepEqual(sqlRows(`SELECT g.code, l.debit, l.credit FROM journal_lines l JOIN ledgers g ON g.id = l.ledger_id WHERE l.journal_entry_id=${v} AND g.code='6702'`), [['6702', '50.00', '0.00']])

  await go(page, '/banking/cash-transfer')
  await page.locator('#v-acc').selectOption(String(ids.cash.id))
  await page.getByLabel('Account, line 1').selectOption(String(ids.sonali.id))
  await page.getByLabel('Amount, line 1').fill('20000.01')
  await page.getByTestId('post-voucher').click()
  await page.getByText(/BR-031/).first().waitFor()
  assert.equal(balance(ids.cash.ledger_id), '20000.00')
  assert.deepEqual(errors.filter((e) => !/422/.test(e)), [])
  await context.close()
})

test('G2 cash count ৳ 500 short waits for approval, then posts', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, `/banking/accounts/${ids.cash.id}`)
  await page.getByTestId('account-name').waitFor()
  await page.getByTestId('count-cash').click()
  await page.getByLabel('Count of ৳ 1000').fill('19')
  await page.getByLabel('Count of ৳ 500').fill('1')
  await page.getByTestId('save-count').click()
  await page.getByText(/short/).first().waitFor()
  assert.equal(balance(ids.cash.ledger_id), '20000.00', 'nothing posts before approval (BR-058)')
  const request = sqlRows("SELECT id FROM approval_requests WHERE status='pending' ORDER BY id DESC LIMIT 1")[0][0]
  await context.close()

  const fin = await newPage()
  const api = apiFor(fin.page)
  await signIn(fin.page, FINANCE)
  const r = await api('POST', `/approvals/${request}/approve`, { comment: 'Drawer checked' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(balance(ids.cash.ledger_id), '19500.00')
  assert.deepEqual(errors, [])
  await fin.context.close()
})

test('G10 import a statement (twice refused), reconcile to zero and finish; G12 shows the supplier payment', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  // A supplier payment from Sonali (F5 path through the API)
  const pay = await api('POST', '/vouchers', { entry_type: 'payment', action: 'post', date: today,
    payment: { money_account_id: ids.sonali.id, method: 'bank_transfer', party_id: ids.supplier, transaction_reference: 'BEFTN-77' },
    lines: [{ ledger_id: sqlRows(`SELECT ledger_id FROM parties WHERE id=${ids.supplier}`)[0][0], amount: '30000.00' }] })
  assert.equal(pay.status, 201, JSON.stringify(pay.body))
  // Statement: the transfer out (with charge), the supplier payment and a service charge of 115
  const dir = mkdtempSync(join(tmpdir(), 'pluto-st-'))
  const file = join(dir, 'sonali.csv')
  writeFileSync(file, `Date,Particulars,Ref No,Withdrawal,Deposit\n${today},TRF TO DBBL,,100050.00,\n${today},BEFTN BENGAL,BEFTN-77,30000.00,\n${today},SMS CHARGE,,115.00,\n`)

  await go(page, `/banking/accounts/${ids.sonali.id}`)
  await page.getByTestId('import-statement').click()
  await page.getByTestId('statement-input').setInputFiles(file)
  await page.getByTestId('run-statement-import').click()
  await page.getByText('3 statement lines imported').waitFor()
  await page.getByTestId('import-statement').click()
  await page.getByTestId('statement-input').setInputFiles(file)
  await page.getByTestId('run-statement-import').click()
  await page.getByText('Already imported', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel' }).last().click()

  await page.getByTestId('reconcile').click()
  await page.locator('#rec-balance').fill('119835.00') // 250,000 − 100,050 − 30,000 − 115
  await page.getByTestId('start-reconcile').click()
  await page.waitForURL(/\/banking\/reconcile\/\d+$/)
  await page.getByTestId('accept-all').click()
  await page.getByText(/2 suggestions accepted/).waitFor()
  await page.getByTestId('statement-lines').locator('li', { hasText: 'SMS CHARGE' }).getByTestId('create-entry').click()
  await page.getByTestId('confirm-create-entry').click()
  await page.getByText('Entry recorded and matched').waitFor()
  await page.getByTestId('rec-difference').getByText('0.00').waitFor()
  await page.getByTestId('finish-rec').click()
  await page.getByRole('button', { name: 'Finish', exact: true }).last().click()
  await page.getByText('Reconciliation finished').waitFor()
  assert.deepEqual(sqlRows(`SELECT status FROM bank_reconciliations ORDER BY id DESC LIMIT 1`), [['finished']])
  assert.deepEqual(sqlRows(`SELECT last_reconciled_on FROM money_accounts WHERE id=${ids.sonali.id}`), [[today]])

  await go(page, `/banking/bank-book?account=${ids.sonali.id}`)
  await page.getByTestId('book-lines').getByText('Bengal Edible Oils').waitFor()
  await page.getByTestId('book-closing').getByText('1,19,835.00').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('G1 and G13 load; phone widths fit', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/banking/transactions')
  await page.locator('tbody tr', { hasText: 'Bengal Edible Oils' }).waitFor()
  await page.setViewportSize(VIEWPORTS.phone)
  for (const u of ['/banking', `/banking/accounts/${ids.cash.id}`, `/banking/accounts/${ids.sonali.id}`, '/banking/received', '/banking/bank-transfer', '/banking/cash-book',
    '/banking/bank-book', '/banking/transactions']) {
    await go(page, u); await page.waitForTimeout(400); await assertNoPageScroll(page, u)
  }
  assert.deepEqual(errors, [])
  await context.close()
})

test('books integrity check passes', () => {
  const out = artisan(['pluto:integrity'])
  assert.doesNotMatch(out, /\d+ failed/, out)
})
