/**
 * End-to-end for phase 15 (backlog P15.3-VAL-01; TC-E2E-005; BR-059–BR-062; NFR-011) against the real API, MySQL and
 * Mailpit. In the UI:
 * - TC-E2E-005: create a company → add a tax rule → change the invoice design → invite a user (e-mail) → they accept
 *   and land in the company → a custom role is made and given to them;
 * - deactivating a signed-in user signs them out on their next step; the last Owner cannot be demoted;
 * - "Forgot password" e-mails a link that sets a new password;
 * - dark theme across the main pages; the restore drill brings back the snapshot; phone widths fit.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { OWNER, PASSWORD, VIEWER, VIEWPORTS, apiFor, assertNoPageScroll, launch, newPage as open, signIn, sqlRows } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'
const stamp = Date.now().toString(36)
const INVITEE = `rahim.${stamp}@e2e.pluto.test`

async function go(page, path) {
  await page.waitForLoadState('networkidle')
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
  await page.waitForURL((u) => u.pathname + u.search === path, { waitUntil: 'commit' })
}

/** The newest e-mail to `to` (polls Mailpit up to 15 s); returns its text. */
async function mailTo(to, subject) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    const list = (await r.json()).messages ?? []
    const m = list.find((x) => !subject || x.Subject.includes(subject))
    if (m) return (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()).Text
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error(`No e-mail to ${to}`)
}

const ids = {}

test('TC-E2E-005: create a company, add a tax rule, design the invoice, invite a user who joins, give them a new role', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/companies/new')
  await page.getByLabel('Legal name').fill(`Padma Agro ${stamp}`)
  await page.getByLabel('Business type').selectOption('partnership')
  await page.getByTestId('create-company').click()
  await page.waitForURL((u) => u.pathname === '/dashboard')
  ids.company = Number(sqlRows(`SELECT id FROM companies WHERE legal_name='Padma Agro ${stamp}'`)[0][0])
  const api = apiFor(page)
  assert.equal((await api('GET', '/company')).body.data.id, ids.company, 'the new company is the active one')

  await go(page, '/settings/tax')
  await page.getByTestId('add-tax-rule').click()
  await page.getByLabel('Rule name').fill('VAT 15%')
  await page.getByLabel('Rate (%)').fill('15')
  await page.getByTestId('save-tax-rule').click()
  await page.getByTestId('tax-rules').getByText('VAT 15%', { exact: true }).waitFor()
  assert.deepEqual(sqlRows(`SELECT rate FROM tax_rules WHERE company_id=${ids.company}`), [['15.0000']])

  await go(page, '/settings/invoice')
  await page.getByRole('radio', { name: 'Accent #1A4D8F' }).click()
  await page.getByLabel('Footer note').fill('Thank you for your business')
  await page.getByTestId('save-settings').click()
  await page.getByText('Invoice design saved').waitFor()
  assert.deepEqual(sqlRows(`SELECT invoice_accent_color, invoice_footer_note FROM company_settings WHERE company_id=${ids.company}`), [['#1A4D8F', 'Thank you for your business']])

  await go(page, '/settings/users')
  await page.getByTestId('invite-user').click()
  await page.getByLabel('Email address').fill(INVITEE)
  await page.getByLabel('Name', { exact: true }).fill('Rahim Uddin')
  await page.getByLabel('Role').selectOption({ label: 'Sales staff' })
  await page.getByTestId('send-invite').click()
  await page.getByTestId('invitations').getByText(INVITEE).waitFor()
  const mail = await mailTo(INVITEE, 'invited you')
  ids.token = mail.match(/\/invite\/([A-Za-z0-9]+)/)[1]

  const guest = await newPage()
  await guest.page.goto(`/invite/${ids.token}`)
  await guest.page.getByRole('heading', { name: `Join Padma Agro ${stamp}` }).waitFor()
  await guest.page.getByLabel('Your name').fill('Rahim Uddin')
  await guest.page.getByLabel('Choose a password').fill('Green-Paddy-Field-9')
  await guest.page.getByLabel('Confirm password').fill('Green-Paddy-Field-9')
  await guest.page.getByTestId('join-company').click()
  await guest.page.waitForURL((u) => !u.pathname.startsWith('/invite'))
  await guest.page.waitForLoadState('networkidle')
  assert.notEqual(new URL(guest.page.url()).pathname, '/sign-in', 'signed in by accepting')
  assert.equal(await guest.page.evaluate(() => localStorage.getItem('pluto.lastCompany')), String(ids.company), 'opened the company that invited them')
  assert.deepEqual(sqlRows(`SELECT m.status FROM company_users m JOIN users u ON u.id=m.user_id WHERE u.email='${INVITEE}' AND m.company_id=${ids.company}`), [['active']])
  ids.guest = guest

  await go(page, '/settings/roles')
  await page.getByTestId('new-role').click()
  const dialog = page.getByTestId('new-role-dialog')
  await dialog.locator('#nr-name').fill('Cashier')
  await dialog.locator('#nr-pay').fill('25000')
  await page.getByTestId('create-role').click()
  await page.getByRole('tab', { name: /^Cashier/, selected: true }).waitFor()
  await page.getByTestId('perm-banking.view').check()
  await page.getByTestId('perm-sales.view').check()
  await page.getByTestId('save-role').click()
  await page.getByText('Cashier saved').waitFor()
  await go(page, '/settings/users')
  await page.getByTestId('users-table').getByText('Rahim Uddin').click()
  await page.getByLabel('Role').selectOption({ label: 'Cashier' })
  await page.getByTestId('save-member').click()
  await page.getByText('Rahim Uddin updated').waitFor()
  assert.deepEqual(sqlRows(`SELECT r.name FROM company_users m JOIN roles r ON r.id=m.role_id JOIN users u ON u.id=m.user_id WHERE u.email='${INVITEE}'`), [['Cashier']])
  assert.deepEqual(errors, [])
  await context.close()
})

test('deactivating a signed-in user signs them out; the last Owner cannot be demoted', async () => {
  const { context, page } = await newPage()
  await signIn(page, OWNER)
  const api = apiFor(page)
  await page.evaluate((id) => localStorage.setItem('pluto.lastCompany', String(id)), ids.company)
  await page.goto('/settings/users')
  await page.getByTestId('users-table').getByText('Rahim Uddin').click()
  await page.getByTestId('deactivate-user').click()
  await page.getByRole('button', { name: 'Deactivate' }).last().click()
  await page.getByText('Rahim Uddin is deactivated').waitFor()

  const guest = ids.guest.page
  await guest.goto('/sales/invoices')
  await guest.waitForURL((u) => u.pathname === '/sign-in')
  await ids.guest.context.close()

  const members = (await api('GET', '/users')).body.data
  const owner = members.find((m) => m.role_name === 'Owner')
  const finance = (await api('GET', '/roles')).body.data.find((r) => r.slug === 'finance')
  const r = await api('PATCH', `/users/${owner.id}`, { role_id: finance.id }, { 'X-If-Match': `W/"${owner.version}"` })
  assert.equal(r.status, 409)
  assert.equal(r.body.code, 'last_owner')
  await context.close()
})

test('forgot password e-mails a link that sets a new password', async () => {
  const { context, page, errors } = await newPage()
  await page.goto('/sign-in')
  await page.getByTestId('forgot-password').click()
  await page.getByLabel('Email').fill(VIEWER)
  await page.getByTestId('send-reset').click()
  await page.getByText('Check your e-mail').waitFor()
  const link = (await mailTo(VIEWER, 'Reset your Pluto password')).match(/\/reset-password\?\S+/)[0]
  await page.goto(link)
  await page.locator('#rp-password').fill('Calm-Harbour-2026')
  await page.locator('#rp-confirm').fill('Calm-Harbour-2026')
  await page.getByTestId('set-password').click()
  await page.getByRole('heading', { name: 'Password changed' }).waitFor()
  const r = await page.request.post('/api/v1/auth/login', { data: { email: VIEWER, password: 'Calm-Harbour-2026' } })
  assert.equal(r.status(), 200)
  const old = await page.request.post('/api/v1/auth/login', { data: { email: VIEWER, password: PASSWORD } })
  assert.equal(old.status(), 401)
  assert.deepEqual(errors.filter((e) => !/40[01]/.test(e)), [])
  await context.close()
})

test('dark theme across the main pages', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await go(page, '/settings/appearance')
  await page.getByTestId('theme-dark').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  for (const u of ['/dashboard', '/sales/invoices', '/customers', '/inventory/products', '/accounting/vouchers', '/reports', '/settings/company', '/settings/roles']) {
    await go(page, u); await page.waitForTimeout(300)
    assert.equal(await page.locator('.lf-shell').getAttribute('data-theme'), 'dark', u)
  }
  await go(page, '/settings/appearance')
  await page.getByTestId('theme-light').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  assert.deepEqual(errors, [])
  await context.close()
})

test('restore drill: a backup brings the company back to the snapshot', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  const api = apiFor(page)
  await go(page, '/settings/backup')
  await page.getByTestId('backup-now').click()
  await page.getByText('Backup taken').waitFor()
  const backup = (await api('GET', '/backups')).body.data[0]
  const party = await api('POST', '/parties', { party_type: 'customer', name: 'After the backup', mobile: '01711999001' })
  assert.equal(party.status, 201, JSON.stringify(party.body))
  await page.reload()
  await page.getByTestId(`restore-${backup.id}`).click()
  await page.getByLabel('Type RESTORE to confirm').fill('RESTORE')
  await page.getByTestId('confirm-restore').click()
  await page.getByText('Restore started').waitFor()
  await page.waitForTimeout(1000)
  assert.equal((await api('GET', `/parties/${party.body.data.id}`)).status, 404, 'the customer made after the backup is gone')
  assert.equal((await api('GET', '/backups')).body.data[0].kind, 'pre_restore')
  assert.deepEqual(errors, [])
  await context.close()
})

test('phone widths fit', async () => {
  const { context, page, errors } = await newPage({ viewport: VIEWPORTS.phone })
  await signIn(page, OWNER)
  for (const u of ['/settings/company', '/settings/preferences', '/settings/region', '/settings/invoice', '/settings/tax', '/settings/users', '/settings/roles',
    '/settings/notifications', '/settings/appearance', '/settings/security', '/settings/backup']) {
    await go(page, u); await page.waitForTimeout(400); await assertNoPageScroll(page, u)
  }
  assert.deepEqual(errors, [])
  await context.close()
})
