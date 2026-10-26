/**
 * End-to-end: 2-step verification through the UI (S1 second step, K14 2-step row) against the real API.
 * Uses the Viewer account so the customer tests' Owner is unaffected. Run by scripts/run-e2e.sh.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { apiFor, launch, newPage, signIn, signOut, sql, totp, OWNER, PASSWORD, VIEWER } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })

// Each E2E file starts from a fresh company (scripts/e2e.sh): the customer list this file opens needs one customer.
test('owner adds a customer (API)', async () => {
  const { context, page } = await newPage(browser)
  const api = apiFor(page)
  await signIn(page, OWNER)
  const r = await api('POST', '/parties', { party_type: 'customer', name: 'Karim Distributors', mobile: '01711458230' })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  await context.close()
})

test('turn on 2-step, sign in with a code and with recovery codes, then turn it off', async () => {
  const { context, page, errors } = await newPage(browser)
  await signIn(page, VIEWER)

  // K14 from the profile menu
  await page.getByTestId('profile-menu').click()
  await page.getByRole('menuitem', { name: /Settings/ }).click()
  await page.waitForURL(/\/settings\/security$/)
  await page.getByRole('heading', { name: 'Security' }).waitFor()
  await page.getByText('Off', { exact: true }).first().waitFor()

  // Set-up: QR and key, a wrong code is refused, the right one shows 10 recovery codes once
  await page.getByTestId('two-factor-switch').locator('label').click()
  await page.getByText('Turn on 2-step verification').waitFor()
  assert.ok((await page.getByTestId('two-factor-qr').getAttribute('src')).startsWith('data:image/svg+xml;base64,'))
  const secret = (await page.getByTestId('two-factor-secret').textContent()).replace(/\s/g, '')
  assert.match(secret, /^[A-Z2-7]{32}$/)
  const wrong = totp(secret) === '000000' ? '111111' : '000000'
  await page.getByLabel('Code from the app').fill(wrong)
  await page.getByRole('button', { name: 'Turn on' }).click()
  await page.getByText('That code is not valid').waitFor()
  await page.getByLabel('Code from the app').fill(totp(secret))
  await page.getByRole('button', { name: 'Turn on' }).click()
  await page.getByText('Save your recovery codes').waitFor()
  const codes = (await page.getByTestId('recovery-codes').locator('li').allTextContents()).map((c) => c.trim())
  assert.equal(codes.length, 10)
  for (const c of codes) assert.match(c, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
  await page.getByRole('button', { name: 'I’ve saved them' }).click()
  await page.getByText('2-step verification is on').waitFor()
  await page.getByText('On', { exact: true }).first().waitFor()

  // Sign in: password, then the code (the next time step, as the app would show 30 s later)
  await signOut(page)
  await signIn(page, VIEWER, { expect2fa: true })
  await page.getByLabel('Authenticator code').fill('12345')
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.getByText('The code has 6 digits').waitFor()
  await page.getByLabel('Authenticator code').fill(wrong)
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.getByText('That code is not valid. Check your authenticator app and try again.').waitFor()
  await page.getByLabel('Authenticator code').fill(totp(secret, 1))
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.waitForURL(/\/customers/)
  await page.getByRole('heading', { name: 'Customers', exact: true }).waitFor()

  // A reload keeps the session (the refresh token carries the second factor)
  await page.reload()
  await page.getByRole('heading', { name: 'Customers', exact: true }).waitFor()

  // Recovery code: works once
  await signOut(page)
  await signIn(page, VIEWER, { expect2fa: true })
  await page.getByRole('button', { name: 'Use a recovery code' }).click()
  await page.getByLabel('Recovery code').fill(codes[0])
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.waitForURL(/\/customers/)
  await signOut(page)
  await signIn(page, VIEWER, { expect2fa: true })
  await page.getByRole('button', { name: 'Use a recovery code' }).click()
  await page.getByLabel('Recovery code').fill(codes[0])
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.getByText('That recovery code is not valid or was already used').waitFor()
  await page.getByLabel('Recovery code').fill(codes[1].toLowerCase())
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.waitForURL(/\/customers/)

  // Turn off: needs the password
  await page.goto('/settings/security')
  await page.getByTestId('two-factor-switch').locator('label').click()
  await page.getByText('Turn off 2-step verification?').waitFor()
  await page.getByLabel('Password').fill('not the password')
  await page.getByRole('button', { name: 'Turn off', exact: true }).click()
  await page.getByText('The password is not correct').waitFor()
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Turn off', exact: true }).click()
  await page.getByText('2-step verification is off').waitFor()

  // Back to password-only sign-in
  await signOut(page)
  await signIn(page, VIEWER)
  await page.getByRole('heading', { name: 'Customers', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('cancelling the set-up keeps 2-step off; other settings sections are placeholders', async () => {
  const { context, page, errors } = await newPage(browser)
  await signIn(page, VIEWER)
  await page.goto('/settings/security')
  await page.getByTestId('two-factor-switch').locator('label').click()
  await page.getByText('Turn on 2-step verification').waitFor()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByText('Turn on 2-step verification').waitFor({ state: 'detached' })
  assert.equal(await page.getByTestId('two-factor-switch').getByRole('switch').isChecked(), false, 'switch returns to off')
  await page.reload()
  await page.getByText('Off', { exact: true }).first().waitFor()

  // Other settings sections are honest placeholders
  await page.getByRole('button', { name: 'Company profile' }).click()
  await page.getByTestId('state-not-in-release').waitFor()
  await page.getByText('Settings › Company profile is not in this release yet').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('a company that requires 2-step sends a password-only sign-in to Security until it is on', async () => {
  sql('UPDATE company_settings SET require_two_factor = 1 WHERE company_id = 1')
  try {
    const { context, page, errors } = await newPage(browser)
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(OWNER)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    // The customer list is refused by the API (403 two_factor_required_by_company): the app opens Security
    await page.waitForURL(/\/settings\/security$/)
    await page.getByText('Your company requires 2-step verification').waitFor()
    await page.goto('/customers')
    await page.waitForURL(/\/settings\/security$/)

    await page.getByTestId('two-factor-switch').locator('label').click()
    const secret = (await page.getByTestId('two-factor-secret').textContent()).replace(/\s/g, '')
    await page.getByLabel('Code from the app').fill(totp(secret))
    await page.getByRole('button', { name: 'Turn on' }).click()
    await page.getByRole('button', { name: 'I’ve saved them' }).click()
    await page.getByText('2-step verification is on').waitFor()
    assert.equal(await page.getByText('Your company requires 2-step verification').count(), 0)

    // The same sign-in now counts as 2-step: customers open without signing in again
    await page.goto('/customers')
    await page.getByRole('heading', { name: 'Customers', exact: true }).waitFor()
    await page.getByRole('cell', { name: /CUS-0001/ }).waitFor()

    // While required, it cannot be turned off
    await page.goto('/settings/security')
    await page.getByTestId('two-factor-switch').locator('label').click()
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Turn off', exact: true }).click()
    await page.getByRole('dialog').getByText('Your company requires 2-step verification').waitFor()
    assert.equal(await page.getByText('Sign in again with your authenticator code').count(), 0, 'not mistaken for a sign-in problem')
    assert.deepEqual(errors, [])
    await context.close()
  } finally {
    sql('UPDATE company_settings SET require_two_factor = 0 WHERE company_id = 1')
    // The Owner had to turn 2-step on and could not turn it off while it was required: switch it off again so the files
    // that run after this one (vendor-payments, vouchers) can sign in as the Owner with the password only.
    sql(`UPDATE users SET two_factor_secret = NULL, two_factor_recovery_codes = NULL, two_factor_confirmed_at = NULL WHERE email = '${OWNER}'`)
  }
})
