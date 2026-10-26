/**
 * End-to-end for phase 7 (backlog P7.3-VAL-01; TC-ACC-*, FR-073, FR-082): an unbalanced journal cannot be posted and
 * "Put difference on last line" takes the server's difference; a balanced journal posts and is reversed; an
 * Accountant journal above ৳ 1,00,000 waits for approval, the Accountant cannot approve it (BR-008), the Owner
 * approves it from the bell and it posts; a voucher into a locked period is refused naming the period; the chart
 * of accounts still balances and `pluto:integrity` passes. Runs last (alphabetically) on the shared E2E database.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { ACCOUNTANT, OWNER, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn } from './helpers.mjs'

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

async function pick(page, label, text) {
  const input = page.getByLabel(label, { exact: true })
  await input.click()
  await input.fill(text)
  await page.getByRole('option').filter({ hasText: text }).first().click()
}

async function journal(page, debit, credit, narration) {
  await go(page, '/accounting/vouchers/new/journal')
  await page.getByTestId('voucher-editor').waitFor()
  await pick(page, 'Ledger, line 1', '6501')
  await page.getByLabel('Debit, line 1').fill(debit)
  await pick(page, 'Ledger, line 2', '1509')
  await page.getByLabel('Credit, line 2').fill(credit)
  await page.getByLabel('Narration', { exact: true }).fill(narration)
}

const ids = {}

test('TC-ACC-001: an unbalanced journal cannot be posted; a balanced one posts and is reversed', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, ACCOUNTANT)
  await journal(page, '5000', '4000', 'Depreciation of vans, October')
  await page.getByTestId('balance-status').getByText(/Out of balance by ৳ 1,000\.00/).waitFor()
  assert.equal(await page.getByTestId('post-voucher').isDisabled(), true, 'Post is disabled while out of balance')
  await page.getByTestId('put-difference').click()
  assert.equal(await page.getByLabel('Credit, line 3').inputValue(), '1000.00', 'the difference is the server figure')
  await page.getByLabel('Remove line 3').click()
  await page.getByLabel('Credit, line 2').fill('5000')
  await page.getByTestId('balance-status').getByText('Balanced', { exact: true }).waitFor()
  await page.getByTestId('balance-status').getByText('Taka five thousand only').waitFor()
  await page.getByTestId('post-voucher').click()
  await page.waitForURL(/\/accounting\/vouchers\/\d+$/)
  ids.posted = Number(/vouchers\/(\d+)/.exec(page.url())[1])
  await page.getByTestId('voucher-status').getByText('Posted').waitFor()
  assert.match(await page.getByTestId('voucher-number').innerText(), /^JV-\d{4}-\d{4}$/)

  await page.getByTestId('reverse-voucher').click()
  await page.getByLabel('Reason').fill('Entered twice')
  await page.getByTestId('confirm-reverse').click()
  await page.waitForURL((u) => /\/accounting\/vouchers\/\d+$/.test(u.pathname) && !u.pathname.endsWith(`/${ids.posted}`))
  await page.getByText('This entry reverses').waitFor()
  await go(page, `/accounting/vouchers/${ids.posted}`)
  await page.getByTestId('voucher-status').getByText('Reversed').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('TC-ACC-009/010: an Accountant journal above ৳ 1,00,000 waits for approval and cannot be self-approved', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, ACCOUNTANT)
  await journal(page, '150000', '150000', 'Year-end depreciation')
  await page.getByText('Needs approval').waitFor()
  await page.getByRole('button', { name: 'Submit for approval' }).click()
  await page.waitForURL(/\/accounting\/vouchers\/\d+$/)
  ids.submitted = Number(/vouchers\/(\d+)/.exec(page.url())[1])
  ids.submittedNumber = await page.getByTestId('voucher-number').innerText()
  await page.getByTestId('voucher-status').getByText('Awaiting approval').waitFor()
  await page.getByTestId('open-approval').click()
  await page.getByText('You submitted this voucher').waitFor()
  assert.equal(await page.getByTestId('approve').count(), 0, 'no Approve button for the requester')
  const v = await api('GET', `/vouchers/${ids.submitted}`)
  ids.approval = v.body.data.approval.id
  const self = await api('POST', `/approvals/${ids.approval}/approve`, {})
  assert.equal(self.status, 403)
  assert.equal(self.body.code, 'self_approval_forbidden')
  assert.deepEqual(errors, [])
  await context.close()
})

test('the Owner approves from the bell and the voucher posts', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await page.getByRole('button', { name: /[1-9]\d* notifications/ }).first().click()
  await page.getByTestId('notification-panel').getByText(`${ids.submittedNumber} waits for your approval`).first().click()
  await page.getByTestId('approval-drawer').getByTestId('approval-amount').getByText('1,50,000.00').waitFor()
  await page.getByTestId('approve').click()
  await page.getByText(`${ids.submittedNumber} approved and posted`).waitFor()
  await go(page, `/accounting/vouchers/${ids.submitted}`)
  await page.getByTestId('voucher-status').getByText('Posted').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('TC-ACC-004: a voucher into a locked period is refused, naming the period', async () => {
  const { context, page } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  await go(page, '/settings/financial-years')
  await page.getByText(/^FY \d{4}-\d{2}$/).first().waitFor()
  const years = (await api('GET', '/fiscal-years')).body.data
  const periods = years.flatMap((y) => y.periods).sort((a, b) => a.start_date.localeCompare(b.start_date))
  const target = periods.find((p) => p.status !== 'locked' && p.end_date < today)
  if (!target) { await context.close(); return } // the year started this month: nothing earlier to lock
  const locked = []
  for (const p of periods.filter((x) => x.start_date <= target.start_date && x.status !== 'locked')) {
    const r = await api('POST', `/accounting-periods/${p.id}/lock`, { note: 'E2E' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    locked.push(p)
  }
  try {
    const ledgers = (await api('GET', '/ledgers?q=650&per_page=5')).body.data
    const acc = (await api('GET', '/ledgers?q=1509&per_page=5')).body.data
    const r = await api('POST', '/vouchers', { entry_type: 'journal', action: 'post', date: target.start_date, confirm_backdated: true,
      lines: [{ ledger_id: ledgers[0].id, debit: '100.00' }, { ledger_id: acc[0].id, credit: '100.00' }] })
    assert.equal(r.status, 422)
    assert.equal(r.body.code, 'period_locked')
    assert.equal(r.body.period, target.name)
  } finally {
    for (const p of locked.reverse()) assert.equal((await api('POST', `/accounting-periods/${p.id}/unlock`, { reason: 'E2E clean-up' })).status, 200)
  }
  await context.close()
})

test('the chart of accounts balances, pages fit a phone, and pluto:integrity passes', async () => {
  const { context, page, errors } = await newPage({ viewport: VIEWPORTS.phone ?? { width: 390, height: 844 } })
  await signIn(page, OWNER)
  for (const p of ['/accounting', '/accounting/chart', '/accounting/vouchers', '/accounting/vouchers/new/payment']) {
    await go(page, p)
    await page.waitForLoadState('networkidle')
    await assertNoPageScroll(page, p)
  }
  await go(page, '/accounting/chart')
  await page.getByTestId('coa-check').getByText('The books balance').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
  const out = artisan(['pluto:integrity'])
  assert.match(out, /All books are consistent/)
})
