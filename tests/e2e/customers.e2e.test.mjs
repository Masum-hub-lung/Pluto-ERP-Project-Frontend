/**
 * End-to-end: the built SPA (served by Laravel at E2E_BASE_URL) against the real API and MySQL.
 * Normally started by scripts/run-e2e.sh (fresh MySQL database, one company, a user per tested role, server).
 * Run: E2E_PASSWORD=... scripts/run-e2e.sh
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertNoPageScroll, launch, newPage as open, signIn, signOut, OWNER, PASSWORD, STORE, VIEWER, VIEWPORTS } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)

test('sign-in: redirect, generic error, then success', async () => {
  const { context, page, errors } = await newPage()
  await page.goto('/customers')
  await page.waitForURL(/\/sign-in/)
  await page.getByLabel('Email').fill(OWNER)
  await page.getByLabel('Password').fill('definitely wrong')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('E-mail or password is incorrect').waitFor()
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/customers$/)
  await page.getByRole('heading', { name: 'Customers' }).waitFor()
  await page.getByText('No customers yet').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('customer workflow: validate, create, warn on duplicate, search, edit, conflict, deactivate', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)

  // B2: client-side validation with the API's messages
  await page.getByTestId('new-customer').click()
  await page.waitForURL(/\/customers\/new$/)
  await page.getByTestId('save-customer').click()
  await page.getByText('Fix 2 fields to save this customer').waitFor()
  await page.getByText('Enter the customer or supplier name').waitFor()
  await page.getByText('Enter a mobile number').waitFor()
  await page.getByLabel('Customer name').fill('Rahman Stores')
  await page.getByLabel('Mobile number').fill('0171145823')
  await page.getByTestId('save-customer').click()
  await page.getByText('Mobile numbers have 11 digits starting 01').waitFor()
  await page.getByLabel('Mobile number').fill('01711 458230')
  await page.getByLabel('Contact person').fill('Abdur Rahman')
  await page.getByLabel('District').selectOption('Dhaka')
  await page.getByLabel('Area or thana').fill('Moulvibazar')
  await page.getByLabel('Credit limit').fill('500000.00')
  // The terms load asynchronously (slower on the Docker E2E stack): wait for them, then the default must be chosen.
  await page.getByLabel('Payment terms').locator('option').nth(1).waitFor({ state: 'attached' })
  for (let i = 0; i < 50 && (await page.getByLabel('Payment terms').inputValue()) === ''; i++) await page.waitForTimeout(100)
  assert.equal(await page.getByLabel('Payment terms').inputValue() !== '', true, 'default payment term preselected')
  await page.getByTestId('save-customer').click()

  // B4: created with its code and ledger
  await page.waitForURL(/\/customers\/\d+$/)
  const firstUrl = page.url()
  await page.getByText(/Rahman Stores added as CUS-0001/).waitFor()
  assert.equal(await page.getByTestId('customer-code').textContent(), 'CUS-0001')
  assert.equal(await page.getByTestId('customer-balance').textContent(), '৳ 0.00 Dr')
  await page.getByText('01711-458230').first().waitFor()
  await page.getByText('Net 15 days').waitFor()
  await page.getByText('৳ 5,00,000.00').waitFor()
  await page.getByText('1201-001 · Sundry debtors').waitFor()

  // A second customer with the same name: saved, with the server's DUPLICATE_PARTY warning
  await page.goto('/customers/new')
  await page.getByLabel('Customer name').fill('Rahman Stores')
  await page.getByLabel('Mobile number').fill('01812000111')
  await page.getByTestId('save-customer').click()
  await page.getByText('Possible duplicate of CUS-0001 Rahman Stores.').waitFor()
  await page.waitForURL(/\/customers\/\d+$/)

  // B1: list, counts tile, search by code
  await page.goto('/customers')
  await page.getByRole('cell', { name: /CUS-0002/ }).waitFor()
  await page.getByText('2 active · 0 inactive').waitFor()
  assert.equal(await page.getByTestId('tile-customers').textContent(), '2')
  await page.getByLabel('Search').fill('CUS-0002')
  await page.waitForURL(/q=CUS-0002/)
  await page.getByRole('cell', { name: /CUS-0001/ }).waitFor({ state: 'detached' })
  await page.getByRole('cell', { name: /CUS-0002/ }).waitFor()

  // B3: edit with If-Match
  await page.goto(firstUrl)
  await page.getByTestId('edit-customer').click()
  await page.waitForURL(/\/edit$/)
  await page.getByLabel('Credit limit').fill('600000.00')
  await page.getByText('Unsaved changes').waitFor()
  await page.getByTestId('save-customer').click()
  await page.getByText('Changes saved').waitFor()
  await page.waitForURL(/\/customers\/\d+$/)
  await page.getByText('৳ 6,00,000.00').waitFor()

  // 409: someone else saves first; the form keeps the user's input and offers a reload
  await page.getByTestId('edit-customer').click()
  await page.waitForURL(/\/edit$/)
  const id = firstUrl.split('/').pop()
  const token = await page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' } })
    return (await r.json()).data.access_token
  })
  const company = await page.evaluate(() => localStorage.getItem('pluto.lastCompany'))
  const other = await page.request.patch(`/api/v1/parties/${id}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': company, 'If-Match': 'W/"2"', Accept: 'application/json' },
    data: { notes: 'Changed by a colleague' },
  })
  assert.equal(other.status(), 200)
  await page.getByLabel('Contact person').fill('Md. Abdur Rahman')
  await page.getByTestId('save-customer').click()
  await page.getByText('Someone else changed this record').waitFor()
  assert.equal(await page.getByLabel('Contact person').inputValue(), 'Md. Abdur Rahman', 'input preserved (BR-049)')
  await page.getByRole('button', { name: 'Reload' }).click()
  await page.getByText('Loaded the latest version').waitFor()
  assert.equal(await page.getByLabel('Contact person').inputValue(), 'Md. Abdur Rahman', 'input still kept after reload')
  await page.getByTestId('save-customer').click()
  await page.getByText('Changes saved').waitFor()
  await page.waitForURL(/\/customers\/\d+$/)
  await page.getByText('Md. Abdur Rahman').first().waitFor()

  // Deactivate, then see it under the Inactive filter
  await page.getByTestId('edit-customer').click()
  await page.getByRole('button', { name: 'Make inactive' }).click()
  await page.getByText('Rahman Stores is now inactive').waitFor()
  await page.waitForURL(/\/customers\/\d+$/)
  await page.getByText('Inactive', { exact: true }).waitFor()
  await page.goto('/customers?status=inactive')
  await page.getByRole('cell', { name: /CUS-0001/ }).waitFor()
  await page.getByRole('cell', { name: /CUS-0002/ }).waitFor({ state: 'detached' })

  // Session survives a reload (refresh cookie), and sign-out ends it
  await page.reload()
  await page.getByRole('cell', { name: /CUS-0001/ }).waitFor()
  await signOut(page)
  await page.goto('/customers')
  await page.waitForURL(/\/sign-in/)
  assert.deepEqual(errors, [])
  await context.close()
})

test('roles: viewer can read but not create; store keeper cannot open customers', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, VIEWER)
  await page.getByRole('cell', { name: /CUS-0002/ }).waitFor()
  assert.equal(await page.getByTestId('new-customer').count(), 0, 'no New customer button for Viewer')
  await page.goto('/customers/new')
  await page.getByTestId('state-denied').waitFor()
  await page.getByText('You don’t have access to adding customers').waitFor()
  await signOut(page)

  // R-35: a Store keeper lands on Inventory (not built yet), not on a 403; the sidebar shows only what the role may view.
  await signIn(page, STORE)
  assert.match(page.url(), /\/inventory$/)
  await page.getByTestId('state-not-in-release').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Sales' }).count(), 0, 'no Sales in the Store keeper sidebar')
  assert.equal(await page.getByRole('button', { name: 'Customers' }).count(), 0, 'no Customers in the Store keeper sidebar')
  await page.getByRole('button', { name: 'Inventory' }).first().waitFor()
  // Typing the address still gets the honest 403 page.
  await page.goto('/customers')
  await page.getByTestId('state-denied').waitFor()
  await page.getByText('Your role is').waitFor()
  await page.getByText('Store keeper', { exact: true }).first().waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('add form: Save and add another, then the discard-changes dialog', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)
  await page.goto('/customers/new')
  await page.getByLabel('Customer name').fill('Karim Distributors')
  await page.getByLabel('Mobile number').fill('01911223344')
  await page.getByRole('button', { name: 'Save and add another' }).click()
  await page.getByText(/Karim Distributors added as CUS-0003/).waitFor()
  // Stays on a cleared form with the default payment term again
  assert.match(page.url(), /\/customers\/new$/)
  assert.equal(await page.getByLabel('Customer name').inputValue(), '')
  assert.equal(await page.getByLabel('Mobile number').inputValue(), '')
  assert.notEqual(await page.getByLabel('Payment terms').inputValue(), '')

  // Unsaved input: Cancel asks first; "Keep editing" keeps the input, "Discard changes" leaves
  await page.getByLabel('Customer name').fill('Half-typed customer')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByText('Discard unsaved changes?').waitFor()
  await page.getByRole('button', { name: 'Keep editing' }).click()
  assert.equal(await page.getByLabel('Customer name').inputValue(), 'Half-typed customer')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Discard changes' }).click()
  await page.waitForURL(/\/customers$/)
  await page.getByRole('cell', { name: /CUS-0003/ }).waitFor()
  assert.equal(await page.getByRole('cell', { name: /Half-typed/ }).count(), 0)

  // No unsaved input: Cancel leaves at once
  await page.goto('/customers/new')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForURL(/\/customers$/)
  assert.deepEqual(errors, [])
  await context.close()
})

test('reactivate an inactive customer and delete one without history', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)

  // CUS-0001 was made inactive in the workflow test
  await page.goto('/customers?status=inactive')
  await page.getByRole('cell', { name: /CUS-0001/ }).click()
  await page.waitForURL(/\/customers\/\d+$/)
  await page.getByTestId('edit-customer').click()
  await page.getByText('This customer is inactive').waitFor()
  await page.getByRole('button', { name: 'Reactivate' }).click()
  await page.getByText('Rahman Stores is active again').waitFor()
  await page.goto('/customers?status=active')
  await page.getByRole('cell', { name: /CUS-0001/ }).waitFor()

  // CUS-0002 has no transactions: delete after typing its name
  await page.getByLabel('Search').fill('CUS-0002')
  await page.getByRole('cell', { name: /CUS-0002/ }).click()
  await page.waitForURL(/\/customers\/\d+$/)
  const url = page.url()
  await page.getByTestId('edit-customer').click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const confirm = page.getByRole('button', { name: 'Delete customer' })
  assert.equal(await confirm.isDisabled(), true, 'disabled until the name is typed')
  await page.getByLabel('Type the customer name to confirm').fill('Rahman Store')
  assert.equal(await confirm.isDisabled(), true)
  await page.getByLabel('Type the customer name to confirm').fill('Rahman Stores')
  await confirm.click()
  await page.getByText('Rahman Stores deleted').waitFor()
  await page.waitForURL(/\/customers$/)
  await page.getByRole('cell', { name: /CUS-0003/ }).waitFor()
  assert.equal(await page.getByRole('cell', { name: /CUS-0002/ }).count(), 0)

  // The deleted record and unknown pages show the 404 state
  await page.goto(url)
  await page.getByTestId('state-notfound').waitFor()
  await page.getByText('We couldn’t find this customer').waitFor()
  await page.goto('/no-such-page')
  await page.getByTestId('state-notfound').getByRole('button', { name: 'Customers' }).click()
  await page.waitForURL(/\/customers$/)
  assert.deepEqual(errors, [])
  await context.close()
})

// Responsive (P1.5-FE-05): the shell, the customer list, details and form at every width the team checks (CLAUDE.md §5.4).
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${name} ${viewport.width} px: shell, customer list, details and form fit the screen`, async () => {
    const narrow = viewport.width < 900 // phone bar + drawer instead of sidebar + top bar
    const phone = viewport.width < 640 // list rows become cards
    const { context, page, errors } = await newPage({ viewport, isMobile: phone, hasTouch: narrow })
    await signIn(page, OWNER)
    await assertNoPageScroll(page, `${name} landing page`)

    if (narrow) {
      const menu = page.getByRole('dialog', { name: 'Main menu' })
      await page.getByTestId('open-menu').click()
      await menu.waitFor()
      await assertNoPageScroll(page, `${name} drawer open`)
      await menu.locator('.lf-nav-item', { hasText: 'Settings' }).click()
      await page.waitForURL(/\/settings\/security$/)
      assert.ok(!(await menu.isVisible()), 'the drawer closes after navigating')
      await page.getByTestId('open-menu').click()
      await menu.waitFor()
      await menu.locator('.lf-nav-item', { hasText: 'Customers' }).click() // expands its sub-pages
      await menu.getByText('All customers', { exact: true }).click()
    } else {
      assert.ok(await page.locator('.lf-shell-side').isVisible(), 'sidebar shown from 900 px')
      await page.goto('/customers')
    }
    await page.waitForURL(/\/customers$/)

    const first = phone ? page.locator('.lf-cardrow', { hasText: 'CUS-0001' }) : page.getByRole('cell', { name: /CUS-0001/ })
    await first.waitFor()
    await assertNoPageScroll(page, `${name} customer list`)
    await first.click()
    await page.getByTestId('customer-code').waitFor()
    await assertNoPageScroll(page, `${name} customer details`)

    await page.goto('/customers/new')
    await page.getByLabel('Customer name').waitFor()
    await assertNoPageScroll(page, `${name} customer form`)
    await page.getByTestId('save-customer').click() // validation shows at this width too
    await page.getByText('Enter the customer or supplier name').waitFor()

    await signOut(page)
    assert.deepEqual(errors, [])
    await context.close()
  })
}
