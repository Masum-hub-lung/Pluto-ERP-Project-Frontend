/**
 * End-to-end for phase 13 (backlog P13.3-VAL-01, income and expenses with attachments) against the real API and MySQL.
 * The owner sets up a bank account and an expense category with a ৳ 5,000 monthly budget (API). Then through the UI:
 * - I6: an expense of ৳ 4,800 with a PDF receipt posts EXP-… (Dr category, Cr bank) and the receipt is on the voucher;
 *   a renamed .exe is refused by the server (415, BR-051) and an 11 MB PDF before uploading;
 * - the budget warning shows for the next expense in that category ("Save and add another");
 * - a recurring expense makes a draft on its next run (pluto:recurring:run), nothing posted until someone posts it (BR-048);
 * - I5 lists the lines with the receipt state; I4 and I9 show the same totals as the books; phone widths fit;
 *   `pluto:integrity` passes.
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
const dhaka = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const today = dhaka(new Date())
const yesterday = dhaka(new Date(Date.now() - 86_400_000))

function artisan(args) {
  return execFileSync('docker', ['compose', '--profile', 'e2e', 'exec', '-T', 'app-e2e', 'php', 'artisan', ...args], { cwd: process.env.BACKEND_DIR ?? '../backend', encoding: 'utf8' })
}

async function go(page, path) {
  await page.waitForLoadState('networkidle')
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

const dir = mkdtempSync(join(tmpdir(), 'pluto-ie-'))
const file = (name, content) => { const p = join(dir, name); writeFileSync(p, content); return p }
const receipt = file('fuel-receipt.pdf', '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
const fakeExe = file('invoice.pdf', Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), Buffer.alloc(300), Buffer.from('This program cannot be run in DOS mode')]))
const bigPdf = file('scan.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024, 65)]))

const ids = {}
const balance = (ledger) => sqlRows(`SELECT COALESCE(SUM(debit) - SUM(credit), 0) FROM journal_lines WHERE ledger_id=${ledger} AND is_posted=1`)[0][0]

test('owner sets up a bank account and an expense category with a monthly budget (API)', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  const bank = await api('POST', '/money-accounts', { account_type: 'bank', bank_name: 'Sonali Bank', account_name: 'Meghna Traders Ltd.', account_number: '0012345678', opening_balance: '100000.00' })
  assert.equal(bank.status, 201, JSON.stringify(bank.body))
  ids.bank = bank.body.data
  const cat = await api('POST', '/ie-categories', { kind: 'expense', name: 'Fuel', create_ledger: true, monthly_budget: '5000.00', warn_at_percent: '90' })
  assert.equal(cat.status, 201, JSON.stringify(cat.body))
  ids.fuel = cat.body.data
  await context.close()
})

test('I6 expense with a PDF receipt; a renamed .exe and an 11 MB PDF are refused; the budget warning shows next time', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/expenses/new')
  await page.getByLabel('Amount (৳)').fill('4800')
  await page.locator('#ie-category').selectOption(String(ids.fuel.id))
  await page.locator('#ie-account').selectOption(String(ids.bank.id))
  await page.getByLabel('Paid to').fill('Meghna Filling Station')

  // BR-051: the content is checked by the server (a renamed .exe), the size before uploading
  await page.getByTestId('ie-attachments-input').setInputFiles(fakeExe)
  await page.getByText(/is not a JPG, PNG or PDF/).first().waitFor()
  await page.getByTestId('ie-attachments-input').setInputFiles(bigPdf)
  await page.getByText(/11\.0 MB; files may be up to 10 MB/).waitFor()
  assert.deepEqual(sqlRows('SELECT COUNT(*) FROM attachments'), [['0']])
  await page.getByTestId('ie-attachments-input').setInputFiles(receipt)
  await page.getByTestId('ie-attachments-list').getByText('fuel-receipt.pdf').waitFor()

  await page.getByTestId('save-add-another').click()
  await page.getByText(/EXP-.* saved/).first().waitFor()
  const v = sqlRows("SELECT id, voucher_number FROM journal_entries WHERE entry_type='expense' ORDER BY id DESC LIMIT 1")[0]
  ids.voucher = Number(v[0])
  assert.match(v[1], /^EXP-/)
  assert.equal(balance(ids.bank.ledger_id), '95200.00')
  assert.equal(balance(ids.fuel.ledger_id), '4800.00')
  assert.deepEqual(sqlRows(`SELECT attachable_type, attachable_id, original_name, mime_type FROM attachments`), [['voucher', String(ids.voucher), 'fuel-receipt.pdf', 'application/pdf']])

  // Same category kept for the next one: 96 % of the budget is used — a warning, not a block
  await page.getByTestId('ie-budget').getByText(/Near the budget|Over budget/).waitFor()
  await page.getByTestId('ie-budget').getByText(/4,800\.00 of ৳ 5,000\.00 used/).waitFor()
  assert.deepEqual(errors.filter((e) => !/415/.test(e)), [])
  await context.close()
})

test('the voucher shows its receipt (H13); I5 lists the line with the receipt state', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, `/accounting/vouchers/${ids.voucher}`)
  await page.getByTestId('voucher-attachments').getByText('fuel-receipt.pdf').waitFor()
  await go(page, '/expenses/list')
  const row = page.locator('tbody tr', { hasText: 'Meghna Filling Station' })
  await row.getByText('Attached').waitFor()
  await page.getByTestId('ie-total').getByText('৳ 4,800.00').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('a recurring expense makes a draft on its next run and posts only when someone posts it (BR-048)', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/expenses/new')
  await page.getByLabel('Amount (৳)').fill('300')
  await page.getByLabel('Date').fill(yesterday)
  await page.locator('#ie-category').selectOption(String(ids.fuel.id))
  await page.locator('#ie-account').selectOption(String(ids.bank.id))
  await page.getByLabel('Paid to').fill('Generator diesel')
  await page.getByText('Recurring expense').click()
  await page.getByLabel('Repeats').selectOption('weekly')
  await page.getByLabel('Next on').fill(today)
  await page.getByTestId('save-ie').click()
  await page.waitForURL(/\/accounting\/vouchers\/\d+$/)
  assert.equal(balance(ids.bank.ledger_id), '94900.00')

  artisan(['pluto:recurring:run'])
  const drafts = sqlRows(`SELECT id, status, entry_date FROM journal_entries WHERE entry_type='expense' AND status='draft'`)
  assert.equal(drafts.length, 1, 'one draft for today')
  assert.equal(drafts[0][2], today)
  assert.equal(balance(ids.bank.ledger_id), '94900.00', 'nothing posted automatically')

  await go(page, '/expenses/recurring')
  await page.locator('tbody tr', { hasText: 'Fuel — Generator diesel' }).getByText('Weekly').waitFor()
  await go(page, `/accounting/vouchers/${drafts[0][0]}`)
  await page.getByTestId('post-voucher').click()
  await page.getByTestId('voucher-status').getByText(/Posted/i).waitFor()
  assert.equal(balance(ids.bank.ledger_id), '94600.00')
  assert.deepEqual(errors, [])
  await context.close()
})

test('I4 overview and I9 report agree with the books', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  const total = balance(ids.fuel.ledger_id) // 4,800 + 300 + 300
  assert.equal(total, '5400.00')
  await go(page, '/expenses?period=this_month')
  await page.getByTestId('tile-total').getByText('৳ 5,400.00').waitFor()
  await page.getByTestId('tile-budget').getByText('108.00 %').waitFor()
  await go(page, '/expenses/report')
  await page.getByTestId('tile-report-total').getByText('৳ 5,400.00').waitFor()
  await page.getByTestId('ie-report').getByText('Fuel').first().waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('phone widths fit', async () => {
  const { context, page, errors } = await newPage({ viewport: VIEWPORTS.phone })
  await signIn(page, OWNER)
  for (const u of ['/expenses', '/expenses/list', '/expenses/new', '/expenses/categories', '/expenses/recurring', '/expenses/report', '/income', '/income/new']) {
    await go(page, u); await page.waitForTimeout(400); await assertNoPageScroll(page, u)
  }
  assert.deepEqual(errors, [])
  await context.close()
})

test('books integrity check passes', () => {
  const out = artisan(['pluto:integrity'])
  assert.doesNotMatch(out, /\d+ failed/, out)
})
