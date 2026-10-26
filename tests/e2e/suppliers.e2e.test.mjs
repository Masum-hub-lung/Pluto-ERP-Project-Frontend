/**
 * End-to-end for phase 2 (backlog P2.3-VAL-01): suppliers C1–C4 and bulk deactivate on both party lists (P2.2-FE-05),
 * against the real API and MySQL. Runs after customers.e2e.test.mjs on the same fresh database (scripts/e2e.sh).
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { apiFor, assertNoPageScroll, launch, newPage as open, signIn, signOut, sqlRows, ACCOUNTANT, OWNER, SALES, STORE, VIEWER, VIEWPORTS } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)

test('supplier workflow: validate, group, local and international, duplicate, filters, edit, conflict, status, delete', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)

  // Sidebar: Suppliers → C1 empty state
  await page.locator('.lf-shell-side .lf-nav-item', { hasText: 'Suppliers' }).click()
  await page.waitForURL(/\/suppliers$/)
  await page.getByRole('heading', { name: 'Suppliers' }).waitFor()
  await page.getByText('No suppliers yet').waitFor()

  // C2: client-side validation
  await page.getByTestId('new-supplier').click()
  await page.waitForURL(/\/suppliers\/new$/)
  await page.getByTestId('save-supplier').click()
  await page.getByText('Fix 2 fields to save this supplier').waitFor()
  await page.getByText('Enter a mobile number').waitFor()

  // "Add group…" creates a group and selects it; a duplicate name shows the API error; Enter does not submit the form
  await page.locator('#f-group').selectOption('__add__')
  await page.locator('#new-group-name').fill('Edible oils')
  await page.getByRole('button', { name: 'Add group' }).click()
  await page.waitForFunction(() => document.querySelector('#f-group')?.selectedOptions[0]?.textContent === 'Edible oils')
  await page.locator('#f-group').selectOption('__add__')
  await page.locator('#new-group-name').fill('Edible oils')
  await page.getByRole('button', { name: 'Add group' }).click()
  await page.getByText('A supplier group with this name already exists').waitFor()
  await page.locator('#new-group-name').press('Enter')
  await page.waitForTimeout(300)
  assert.match(page.url(), /\/suppliers\/new$/, 'Enter in the dialog must not submit the supplier form')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

  // Local supplier with purchase ledger and bank → C4 with its code and its own ledger under 2101
  await page.getByLabel('Supplier name').fill('Bengal Edible Oils')
  await page.locator('#f-category').selectOption('manufacturer')
  await page.getByLabel('Mobile number').fill('01911-222333')
  await page.getByLabel('District').selectOption('Dhaka')
  await page.getByLabel('Area or thana').fill('Tejgaon')
  await page.locator('#f-ledger').click()
  await page.locator('#f-ledger').fill('5101')
  await page.getByRole('option', { name: /5101/ }).first().click()
  await page.getByLabel('Bank').fill('Dutch-Bangla Bank')
  await page.getByLabel('Account number').fill('1171100012345')
  await page.getByLabel('Branch').fill('Tejgaon')
  await page.getByTestId('save-supplier').click()
  await page.waitForURL(/\/suppliers\/\d+$/)
  const localUrl = page.url()
  await page.getByText(/Bengal Edible Oils added as SUP-0001/).waitFor()
  assert.equal(await page.getByTestId('supplier-code').textContent(), 'SUP-0001')
  await page.getByText('2101-001 · Sundry creditors').waitFor()
  await page.getByText('Dutch-Bangla Bank · Tejgaon').waitFor()

  // Same name again: saved, with the DUPLICATE_PARTY warning
  await page.goto('/suppliers/new')
  await page.getByLabel('Supplier name').fill('Bengal Edible Oils')
  await page.getByLabel('Mobile number').fill('01811-000999')
  await page.getByTestId('save-supplier').click()
  await page.getByText('Possible duplicate of SUP-0001 Bengal Edible Oils.').waitFor()
  await page.waitForURL(/\/suppliers\/\d+$/)

  // International supplier: no mobile needed, currency follows the country
  await page.goto('/suppliers/new')
  await page.getByLabel('Supplier name').fill('Guangzhou Packaging')
  await page.locator('#f-country').selectOption('CN')
  assert.equal(await page.locator('#f-currency').inputValue(), 'CNY')
  await page.getByLabel('Port of loading').fill('Guangzhou (Nansha)')
  await page.getByTestId('save-supplier').click()
  await page.waitForURL(/\/suppliers\/\d+$/)
  const intlUrl = page.url()
  await page.getByText('Guangzhou (Nansha)').waitFor()
  await page.getByText('CNY').first().waitFor()

  // C1: tile, search, country filter; filters survive a reload
  await page.goto('/suppliers')
  await page.getByText('3 active · 0 inactive').waitFor()
  await page.getByLabel('Search').fill('Guangzhou')
  await page.waitForURL(/q=Guangzhou/)
  await page.getByRole('cell', { name: /SUP-0001/ }).waitFor({ state: 'detached' })
  await page.getByRole('cell', { name: /SUP-0003/ }).waitFor()
  await page.goto('/suppliers?country=CN')
  await page.getByRole('cell', { name: /SUP-0003/ }).waitFor()
  assert.equal(await page.getByRole('cell', { name: /SUP-0001/ }).count(), 0, 'country filter drops BD suppliers')
  await page.reload()
  await page.getByRole('cell', { name: /SUP-0003/ }).waitFor()
  assert.equal(await page.getByLabel('Country').inputValue(), 'CN')

  // C3: edit with If-Match
  await page.goto(localUrl)
  await page.getByTestId('edit-supplier').click()
  await page.waitForURL(/\/edit$/)
  await page.waitForFunction(() => /5101/.test(document.querySelector('#f-ledger')?.value ?? ''))
  await page.getByLabel('Contact person').fill('Nasir Uddin')
  await page.getByTestId('save-supplier').click()
  await page.getByText('Changes saved').waitFor()
  await page.waitForURL(/\/suppliers\/\d+$/)
  await page.getByText('Nasir Uddin').first().waitFor()

  // 409: someone else saves first; the user's input is kept, Reload then Save applies it
  await page.getByTestId('edit-supplier').click()
  await page.waitForURL(/\/edit$/)
  await page.getByLabel('Contact person').waitFor()
  const id = localUrl.split('/').pop()
  const current = await api('GET', `/parties/${id}`)
  assert.equal(current.status, 200)
  const other = await api('PATCH', `/parties/${id}`, { notes: 'Changed by a colleague' }, { 'X-If-Match': `W/"${current.body.data.version}"` })
  assert.equal(other.status, 200, JSON.stringify(other.body))
  await page.getByLabel('Contact person').fill('Md. Nasir Uddin')
  await page.getByTestId('save-supplier').click()
  await page.getByText('Someone else changed this record').waitFor()
  assert.equal(await page.getByLabel('Contact person').inputValue(), 'Md. Nasir Uddin', 'input preserved (BR-049)')
  await page.getByRole('button', { name: 'Reload' }).click()
  await page.getByText('Loaded the latest version').waitFor()
  await page.getByTestId('save-supplier').click()
  await page.getByText('Changes saved').waitFor()
  await page.waitForURL(/\/suppliers\/\d+$/)
  await page.getByText('Md. Nasir Uddin').first().waitFor()

  // Make inactive from the form → Inactive filter → reactivate from the C4 header
  await page.getByTestId('edit-supplier').click()
  await page.getByRole('button', { name: 'Make inactive' }).click()
  await page.getByText('Bengal Edible Oils is now inactive').waitFor()
  await page.goto('/suppliers?status=inactive')
  await page.getByRole('cell', { name: /SUP-0001/ }).waitFor()
  assert.equal(await page.getByRole('cell', { name: /SUP-0002/ }).count(), 0)
  await page.getByRole('cell', { name: /SUP-0001/ }).click()
  await page.waitForURL(/\/suppliers\/\d+$/)
  await page.getByTestId('toggle-supplier').click()
  await page.getByText('Bengal Edible Oils is active again').waitFor()
  await page.goto('/suppliers?status=active')
  await page.getByRole('cell', { name: /SUP-0001/ }).waitFor()

  // The Bills tab lists the supplier's bills (P6.2-FE-06); Activity loads and lives in the URL
  await page.goto(localUrl)
  await page.getByRole('tab', { name: 'Bills' }).click()
  await page.getByTestId('party-bills').waitFor()
  await page.getByRole('tab', { name: 'Activity' }).click()
  await page.getByRole('region', { name: 'Activity' }).waitFor()
  assert.match(page.url(), /tab=activity/)

  // Delete the international supplier (no history) after typing its name → 404 afterwards
  await page.goto(`${intlUrl}/edit`)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const confirm = page.getByRole('button', { name: 'Delete supplier' })
  assert.equal(await confirm.isDisabled(), true, 'disabled until the name is typed')
  await page.getByLabel('Type the supplier name to confirm').fill('Guangzhou Packaging')
  await confirm.click()
  await page.getByText('Guangzhou Packaging deleted').waitFor()
  await page.waitForURL(/\/suppliers$/)
  await page.goto(intlUrl)
  await page.getByText('We couldn’t find this supplier').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

/** A list row by the text in it (a name also appears in the row's checkbox and edit-button labels, so not a cell). */
const row = (page, text) => page.locator('tbody tr', { hasText: text })

test('bulk deactivate: selection survives page changes, failures are named, works on customers too', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  await page.goto('/suppliers')
  await page.getByRole('cell', { name: /SUP-0001/ }).waitFor()

  // The customer half below needs customers; each E2E file starts from a fresh company (scripts/e2e.sh).
  for (const [name, mobile] of [['Rahim Store', '01711000301'], ['Selim Traders', '01711000302'], ['Karim Distributors', '01711458230']]) {
    const c = await api('POST', '/parties', { party_type: 'customer', name, mobile })
    assert.equal(c.status, 201, JSON.stringify(c.body))
  }

  // 25 more suppliers make a second page (25 per page)
  for (let i = 1; i <= 25; i++) {
    const r = await api('POST', '/parties', { party_type: 'supplier', name: `Bulk Supplier ${String(i).padStart(2, '0')}`, mobile: `0171100${String(i).padStart(4, '0')}` })
    assert.equal(r.status, 201, JSON.stringify(r.body))
  }
  await page.goto('/suppliers?sort=name')
  await row(page, 'Bulk Supplier 01').waitFor()

  // Page 1: pick two rows; page 2: pick one more; the bar counts all three
  await page.getByLabel('Select Bulk Supplier 01').check()
  await page.getByLabel('Select Bulk Supplier 02').check()
  await page.getByTestId('selection-count').getByText('2 selected').waitFor()
  await page.getByRole('button', { name: 'Next page' }).click()
  await page.getByText('(2 on other pages)').waitFor()
  const lastRow = page.locator('tbody tr').first()
  const lastName = (await lastRow.getByRole('checkbox').getAttribute('aria-label')).replace(/^Select /, '')
  await lastRow.getByRole('checkbox').check()
  await page.getByText('3 selected').waitFor()
  await page.getByRole('button', { name: 'Previous page' }).click()
  assert.equal(await page.getByLabel('Select Bulk Supplier 01').isChecked(), true, 'selection kept after paging back')

  // "Select all on this page" adds the page; "Clear this page" removes only it
  await page.getByRole('button', { name: 'Select all on this page' }).click()
  await page.getByText('26 selected').waitFor()
  await page.getByRole('button', { name: 'Clear this page' }).click()
  await page.getByText('1 selected').waitFor()
  await page.getByLabel('Select Bulk Supplier 01').check()
  await page.getByLabel('Select Bulk Supplier 02').check()

  // One of the three disappears before the action: the toast names it, the other two are deactivated
  const gone = (await api('GET', '/parties?type=supplier&q=Bulk%20Supplier%2002')).body.data[0]
  assert.equal((await api('DELETE', `/parties/${gone.id}`)).status, 204)
  await page.getByTestId('bulk-deactivate').click()
  await page.getByText('Make 3 suppliers inactive?').waitFor()
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click()
  await page.getByText('2 deactivated, 1 could not be').waitFor()
  await page.getByText(/Bulk Supplier 02: /).waitFor()
  assert.equal(await page.getByTestId('selection-count').count(), 0, 'selection cleared after the action')
  await page.goto('/suppliers?status=inactive')
  await row(page, 'Bulk Supplier 01').waitFor()
  await row(page, lastName).waitFor()

  // Customers: the same bar on B1
  await page.goto('/customers')
  await page.getByRole('cell', { name: /CUS-0003/ }).waitFor()
  await page.getByLabel('Select Karim Distributors').check()
  await page.getByTestId('bulk-deactivate').click()
  await page.getByText('Make 1 customer inactive?').waitFor()
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click()
  await page.getByText('1 customer deactivated').waitFor()
  await page.goto('/customers?status=inactive')
  await page.getByRole('cell', { name: /CUS-0003/ }).waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('roles: viewer reads suppliers without New or selection; store keeper is denied', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, VIEWER)
  await page.goto('/suppliers')
  await page.getByRole('cell', { name: /SUP-0001/ }).waitFor()
  assert.equal(await page.getByTestId('new-supplier').count(), 0, 'no New supplier button for Viewer')
  assert.equal(await page.getByRole('checkbox').count(), 0, 'no selection column for Viewer')
  await page.getByRole('cell', { name: /SUP-0001/ }).click()
  await page.getByTestId('supplier-code').waitFor()
  assert.equal(await page.getByTestId('edit-supplier').count(), 0, 'no Edit for Viewer')
  await page.goto('/suppliers/new')
  await page.getByTestId('state-denied').waitFor()
  await signOut(page)

  await signIn(page, STORE)
  assert.equal(await page.getByRole('button', { name: 'Suppliers' }).count(), 0, 'no Suppliers in the Store keeper sidebar')
  await page.goto('/suppliers')
  await page.getByTestId('state-denied').waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('roles: accountant edits but cannot delete; sales staff adds but cannot edit', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)

  // Accountant (parties.create + edit, no delete): New, selection column, Edit and Make inactive; no Delete
  await signIn(page, ACCOUNTANT)
  await page.goto('/suppliers')
  await page.getByRole('cell', { name: /SUP-0001/ }).waitFor()
  await page.getByTestId('new-supplier').waitFor()
  assert.ok(await page.getByRole('checkbox').count() > 0, 'selection column for Accountant')
  await page.getByRole('cell', { name: /SUP-0001/ }).click()
  await page.getByTestId('toggle-supplier').waitFor()
  await page.getByTestId('edit-supplier').click()
  await page.waitForURL(/\/edit$/)
  await page.getByLabel('Notes').fill('Checked by the accountant')
  await page.getByTestId('save-supplier').click()
  await page.getByText('Changes saved').waitFor()
  await page.getByTestId('edit-supplier').click()
  await page.getByRole('button', { name: 'Make inactive' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Delete', exact: true }).count(), 0, 'no Delete for Accountant')
  const id = page.url().split('/').at(-2)
  assert.equal((await api('DELETE', `/parties/${id}`)).status, 403, 'the API refuses the delete too')
  await signOut(page)

  // Sales staff (parties.view + create, no edit): adds a supplier, then sees it read-only
  await signIn(page, SALES)
  await page.goto('/suppliers')
  await page.getByRole('cell', { name: /SUP-0001/ }).waitFor()
  assert.equal(await page.getByRole('checkbox').count(), 0, 'no selection column for Sales staff')
  await page.getByTestId('new-supplier').click()
  await page.getByLabel('Supplier name').fill('Padma Paper Mills')
  await page.getByLabel('Mobile number').fill('01712-345678')
  await page.getByTestId('save-supplier').click()
  await page.waitForURL(/\/suppliers\/\d+$/)
  await page.getByText(/Padma Paper Mills added as SUP-\d{4}/).waitFor()
  assert.equal(await page.getByTestId('edit-supplier').count(), 0, 'no Edit for Sales staff')
  assert.equal(await page.getByTestId('toggle-supplier').count(), 0, 'no Make inactive for Sales staff')
  const created = page.url().split('/').pop()
  await page.goto(`/suppliers/${created}/edit`)
  await page.getByTestId('state-denied').waitFor()
  assert.equal((await api('PATCH', `/parties/${created}`, { notes: 'x' }, { 'X-If-Match': 'W/"1"' })).status, 403, 'the API refuses the edit too')
  assert.deepEqual(errors, [])
  await context.close()
})

test('database: every supplier has its own ledger under 2101, and the changes are audited', () => {
  const ledgers = sqlRows(`SELECT p.code, l.code, g.code FROM parties p JOIN ledgers l ON l.id = p.ledger_id
    JOIN account_groups g ON g.id = l.account_group_id WHERE p.party_type = 'supplier'`)
  assert.ok(ledgers.length >= 27, `suppliers in the database: ${ledgers.length}`)
  for (const [party, ledger, group] of ledgers) {
    assert.equal(group, '2101', `${party} ledger ${ledger} is under ${group}`)
    assert.match(ledger, /^2101-\d{3}$/)
  }
  assert.equal(new Set(ledgers.map((r) => r[1])).size, ledgers.length, 'one ledger per supplier')
  const actions = sqlRows(`SELECT DISTINCT a.action FROM audit_logs a JOIN parties p ON p.id = a.auditable_id
    WHERE a.auditable_type = 'parties' AND p.party_type = 'supplier'`).map((r) => r[0])
  for (const a of ['created', 'updated', 'deactivated', 'deleted']) assert.ok(actions.includes(a), `audit has "${a}" (got ${actions.join(', ')})`)
  assert.equal(sqlRows(`SELECT COUNT(*) FROM audit_logs WHERE auditable_type = 'party_groups' AND action = 'created'`)[0][0], '1')
})

// Responsive (CLAUDE.md §5.4): supplier list, details and form at every width.
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${name} ${viewport.width} px: supplier list, details and form fit the screen`, async () => {
    const phone = viewport.width < 640
    const { context, page, errors } = await newPage({ viewport, isMobile: phone, hasTouch: viewport.width < 900 })
    await signIn(page, OWNER)
    await page.goto('/suppliers')
    const first = phone ? page.locator('.lf-cardrow', { hasText: 'SUP-0001' }) : page.getByRole('cell', { name: /SUP-0001/ })
    await first.waitFor()
    await assertNoPageScroll(page, `${name} supplier list`)
    await first.click()
    await page.getByTestId('supplier-code').waitFor()
    await assertNoPageScroll(page, `${name} supplier details`)
    await page.goto('/suppliers/new')
    await page.getByLabel('Supplier name').waitFor()
    await assertNoPageScroll(page, `${name} supplier form`)
    assert.deepEqual(errors, [])
    await context.close()
  })
}
