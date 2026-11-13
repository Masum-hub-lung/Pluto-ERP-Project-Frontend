/**
 * Screenshot checks of the main screens (A+ redesign, PEP-481). For each screen, light and dark, at 1440, 1024 and
 * 390 px it takes a full-page screenshot into test-results/screens/ (CI keeps them as an artifact so a reviewer can
 * look at every screen of a run) and checks the A+ "design contract" that a pixel diff would only catch noisily:
 *  - the page renders its heading with no page error and no sideways page scroll;
 *  - the shell paints the theme's paper colour (light #f6f4ef, dark #0b1320) and the page title uses the serif face;
 *  - primary buttons use the navy brand (light) / ledger blue (dark), never the retired teal;
 *  - cards keep the A+ radius and a visible border, and amounts in tables are tabular figures.
 * Data is the fresh E2E company, so lists show their empty states; detail screens are covered by the module files.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { OWNER, apiFor, assertNoPageScroll, launch, newPage as open, signIn } from './helpers.mjs'

const OUT = 'test-results/screens'
mkdirSync(OUT, { recursive: true })

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })

/** The screens people use every day. */
export const MAIN_SCREENS = [
  '/dashboard', '/customers', '/customers/new', '/suppliers', '/sales/invoices', '/sales/invoices/new', '/sales/payments/new',
  '/purchases/bills', '/purchases/bills/new', '/inventory/products', '/banking', '/accounting/vouchers', '/accounting/vouchers/new/journal',
  '/reports/trial-balance', '/reports/profit-and-loss', '/lc/list', '/settings/company',
]
const WIDTHS = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]
const THEME = {
  light: { paper: 'rgb(246, 244, 239)', brand: ['rgb(31, 58, 95)'] },
  dark: { paper: 'rgb(11, 19, 32)', brand: ['rgb(127, 166, 217)'] },
}
const RETIRED_TEAL = /rgb\(1[0-9], 1[0-4][0-9], 1[2-4][0-9]\)/ // the old teal brand family

async function settle(page) {
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .lf-skeleton'), null, { timeout: 5_000 }).catch(() => {})
  await page.evaluate(() => document.fonts?.ready)
}

/** The A+ design contract on the current page; returns readable problems. */
async function contract(page, theme, where) {
  const s = await page.evaluate(() => {
    const css = (el, p) => (el ? getComputedStyle(el)[p] : null)
    const shell = document.querySelector('.lf-shell')
    const h1 = document.querySelector('h1')
    const primary = [...document.querySelectorAll('.lf-btn-primary')].filter((b) => b.offsetParent)
    const cards = [...document.querySelectorAll('.lf-card')].filter((c) => c.offsetParent).slice(0, 5)
    const amounts = [...document.querySelectorAll('.lf-table td.is-num')].slice(0, 5)
    return {
      paper: css(shell, 'backgroundColor'), h1: h1?.textContent?.trim() ?? '', h1Font: css(h1, 'fontFamily'),
      primary: primary.map((b) => css(b, 'backgroundColor')),
      cards: cards.map((c) => ({ radius: parseFloat(css(c, 'borderTopLeftRadius')), border: css(c, 'borderTopStyle') })),
      amounts: amounts.map((a) => css(a, 'fontVariantNumeric')),
    }
  })
  const p = []
  if (!s.h1) p.push(`${where}: no page heading`)
  if (s.paper !== THEME[theme].paper) p.push(`${where}: shell background ${s.paper}, expected ${THEME[theme].paper}`)
  if (s.h1 && !/Newsreader/i.test(s.h1Font ?? '')) p.push(`${where}: heading font ${s.h1Font}, expected the serif (Newsreader)`)
  for (const bg of s.primary) {
    if (RETIRED_TEAL.test(bg)) p.push(`${where}: primary button uses the retired teal ${bg}`)
    else if (!THEME[theme].brand.includes(bg)) p.push(`${where}: primary button ${bg}, expected the brand ${THEME[theme].brand.join(' or ')}`)
  }
  for (const c of s.cards) if (c.radius < 8 || c.border === 'none') p.push(`${where}: card radius ${c.radius}px / border ${c.border}`)
  for (const a of s.amounts) if (!/tabular-nums/.test(a ?? '')) p.push(`${where}: amount cell without tabular figures (${a})`)
  return p
}

for (const theme of ['light', 'dark']) {
  test(`PEP-481: main screens match the A+ design contract (${theme})`, async () => {
    const { context, page, errors } = await open(browser, { viewport: WIDTHS[0] })
    const api = apiFor(page)
    await signIn(page, OWNER)
    const prefs = (await api('GET', '/me/preferences')).body?.data ?? {}
    assert.equal((await api('PUT', '/me/preferences', { ...prefs, theme })).status, 200)
    const problems = []
    try {
      for (const size of WIDTHS) {
        await page.setViewportSize(size)
        for (const path of MAIN_SCREENS) {
          const where = `${path} @${size.width} ${theme}`
          await page.goto(path)
          await settle(page)
          await page.screenshot({ path: `${OUT}/${theme}-${size.width}${path.replace(/\W+/g, '_')}.png`, fullPage: true })
          try { await assertNoPageScroll(page, where) } catch (e) { problems.push(e.message) }
          problems.push(...await contract(page, theme, where))
        }
      }
    } finally {
      await api('PUT', '/me/preferences', { ...prefs }) // leave the owner's theme as it was
      await context.close()
    }
    assert.deepEqual(problems, [])
    assert.deepEqual(errors, [])
  })
}
