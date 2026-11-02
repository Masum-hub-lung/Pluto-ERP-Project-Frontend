/**
 * Accessibility and responsive audit (backlog P17.2-FE-01; TC-FE-006, TC-FE-007; NFR-050, NFR-051):
 * - axe-core (WCAG 2.0/2.1 A and AA) on every built page, signed out and as the Owner: no serious or critical issue;
 *   moderate and minor ones are listed in the output for the record;
 * - every page fits 1440, 1200, 1024 and 390 px without sideways page scroll;
 * - keyboard only: sign in, open the command palette (Ctrl K), go to a page, and the focused element is always visible.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { OWNER, PASSWORD, assertNoPageScroll, launch, newPage as open, signIn } from './helpers.mjs'

const require = createRequire(import.meta.url)
const AXE = require.resolve('axe-core/axe.min.js')

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)

/** Every built page without a record id (router.tsx); detail pages are covered by their module E2E files. */
export const PAGES = [
  '/dashboard', '/search?q=oil', '/notifications',
  '/customers', '/customers/new', '/customers/outstanding', '/suppliers', '/suppliers/new', '/suppliers/outstanding',
  '/inventory', '/inventory/summary', '/inventory/products', '/inventory/products/new', '/inventory/categories', '/inventory/stock-groups',
  '/inventory/warehouses', '/inventory/movements', '/inventory/adjustments', '/inventory/adjustments/new', '/inventory/transfers', '/inventory/transfers/new',
  '/inventory/low-stock', '/inventory/valuation',
  '/sales', '/sales/invoices', '/sales/invoices/new', '/sales/quotations', '/sales/quotations/new', '/sales/payments', '/sales/payments/new',
  '/sales/returns', '/sales/returns/new', '/sales/credit-notes/new',
  '/purchases', '/purchases/bills', '/purchases/bills/new', '/purchases/orders', '/purchases/orders/new', '/purchases/payments', '/purchases/payments/new',
  '/purchases/returns', '/purchases/returns/new', '/purchases/debit-notes/new',
  '/lc', '/lc/list', '/lc/new', '/lc/amendments', '/lc/documents', '/lc/charges', '/lc/banks', '/lc/loans', '/lc/fx-revaluation', '/lc/reports',
  '/banking', '/banking/accounts', '/banking/accounts/new', '/banking/transactions', '/banking/cash-book', '/banking/bank-book',
  '/banking/received', '/banking/paid', '/banking/cash-transfer', '/banking/bank-transfer',
  '/income', '/income/list', '/income/new', '/income/categories', '/income/report',
  '/expenses', '/expenses/list', '/expenses/new', '/expenses/categories', '/expenses/recurring', '/expenses/report',
  '/accounting', '/accounting/chart', '/accounting/ledgers', '/accounting/ledgers/new', '/accounting/vouchers', '/accounting/vouchers/new/journal',
  '/reports', '/reports/trial-balance', '/reports/profit-and-loss', '/reports/balance-sheet', '/reports/cash-flow', '/reports/general-ledger',
  '/reports/receivables-aging', '/reports/payables-aging', '/reports/sales', '/reports/sales-returns', '/reports/purchases', '/reports/purchase-returns',
  '/settings/company', '/settings/preferences', '/settings/region', '/settings/invoice', '/settings/tax', '/settings/users', '/settings/roles',
  '/settings/notifications', '/settings/appearance', '/settings/backup', '/settings/security', '/settings/financial-years', '/settings/accounting',
]

async function settle(page) {
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .lf-skeleton'), null, { timeout: 5_000 }).catch(() => {})
}

/** axe on the current page; returns the serious/critical violations and logs the rest. */
async function audit(page, where) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE })
  const result = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))
  })
  const blocking = result.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  for (const v of result.filter((x) => !blocking.includes(x))) console.log(`  [axe ${v.impact}] ${where}: ${v.id} — ${v.help} (${v.nodes.join(' | ')})`)
  return blocking.map((v) => `${where}: ${v.id} (${v.impact}) — ${v.help} — ${v.nodes.join(' | ')}`)
}

test('TC-FE-006: signed-out pages have no serious accessibility issues', async () => {
  const { context, page } = await newPage()
  const problems = []
  for (const path of ['/sign-in', '/forgot-password']) {
    await page.goto(path)
    await settle(page)
    problems.push(...await audit(page, path))
  }
  await context.close()
  assert.deepEqual(problems, [])
})

/** Pages grouped by module, so each test stays well inside the per-test time limit. */
const GROUPS = PAGES.reduce((g, p) => { const k = p.split('/')[1].split('?')[0]; (g[k] ??= []).push(p); return g }, {})

for (const [module, paths] of Object.entries(GROUPS)) {
  test(`TC-FE-006: ${module} pages as the Owner have no serious accessibility issues`, async () => {
    const { context, page } = await newPage({ viewport: { width: 1440, height: 900 } })
    await signIn(page, OWNER)
    const problems = []
    for (const path of paths) {
      await page.goto(path)
      await settle(page)
      problems.push(...await audit(page, path))
    }
    await context.close()
    assert.deepEqual(problems, [])
  })
}

for (const width of [1440, 1200, 1024, 390]) {
  test(`TC-FE-007: every page fits ${width} px`, async () => {
    const problems = []
    const { context, page } = await newPage({ viewport: { width, height: width === 390 ? 844 : 900 } })
    await signIn(page, OWNER)
    for (const path of PAGES) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await assertNoPageScroll(page, `${width}px ${path}`).catch((e) => problems.push(e.message))
    }
    await context.close()
    assert.deepEqual(problems, [])
  })
}

test('keyboard only: sign in, Ctrl K to a page, focus always visible', async () => {
  const { context, page, errors } = await newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('/sign-in')
  await settle(page)
  const focusVisible = () => page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return true
    // The design system may draw the ring on the field's wrapper (.lf-input:focus-within), so look two levels up too.
    for (let n = el, i = 0; n && i < 3; n = n.parentElement, i++) {
      const s = getComputedStyle(n)
      if ((s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none') return true
    }
    return false
  })
  // Tab to the e-mail field, type, Tab to the password, type, Enter.
  for (let i = 0; i < 6 && !(await page.evaluate(() => document.activeElement?.getAttribute('type') === 'email')); i++) await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('type')), 'email', 'the e-mail field is reachable by Tab')
  assert.ok(await focusVisible(), 'focused e-mail field shows a focus ring')
  await page.keyboard.type(OWNER)
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('type')), 'password')
  await page.keyboard.type(PASSWORD)
  await page.keyboard.press('Enter')
  // Wait for the landing page itself: '/' redirects to the dashboard and remounts the shell.
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in') && u.pathname !== '/')
  await settle(page)
  // Command palette by keyboard.
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog').waitFor()
  await page.keyboard.type('Suppliers')
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/suppliers/)
  // Tab through the first 25 stops: each focused element is visible and shows focus.
  const hidden = []
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    const ok = await focusVisible()
    if (!ok) hidden.push(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)))
  }
  assert.deepEqual(hidden, [], 'every focused element shows a focus indicator')
  assert.deepEqual(errors, [])
  await context.close()
})
