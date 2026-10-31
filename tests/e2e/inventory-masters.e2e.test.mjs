/**
 * End-to-end for phase 3 (backlog P3.3-VAL-01): inventory masters D1–D3, D5–D7 against the real API and MySQL —
 * warehouses with their 1301 ledgers, the category tree, an inline unit, products with reorder levels per warehouse,
 * a service, edit with a concurrent change, delete without history, and what each role may see and do (BR-052).
 * Runs on the fresh E2E database after customers.e2e.test.mjs (scripts/e2e.sh); stock stays 0 until P4.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { apiFor, assertNoPageScroll, launch, newPage as open, signIn, sql, sqlRows, OWNER, SALES, STORE, VIEWER, VIEWPORTS } from './helpers.mjs'

let browser
before(async () => { browser = await launch() })
after(async () => { await browser?.close() })
const newPage = (options) => open(browser, options)
const row = (page, text) => page.locator('tbody tr', { hasText: text })
/** The income account is preselected (4101) once the ledger list arrives; saving before that is correctly refused. */
async function incomeReady(page) {
  for (let i = 0; i < 100 && !/4101/.test(await page.getByLabel('Income account').inputValue()); i++) await page.waitForTimeout(100)
  assert.match(await page.getByLabel('Income account').inputValue(), /4101/, 'income account preselected')
}
const headers = async (page) => (await page.locator('thead th').allInnerTexts()).map((h) => h.trim().toUpperCase())

test('owner sets up warehouses, a category tree, a unit, a product with reorder levels and a service', async () => {
  const { context, page, errors } = await newPage()
  await signIn(page, OWNER)

  // D7: two warehouses; each shows its own inventory ledger (the first takes the seeded 1301-01)
  await page.goto('/inventory/warehouses')
  await page.getByText('No warehouses yet').waitFor()
  for (const [name, code] of [['Tejgaon warehouse', 'WH-TEJ'], ['Narayanganj depot', 'wh-ngj']]) {
    await page.getByTestId(name === 'Tejgaon warehouse' ? 'empty-new-warehouse' : 'new-warehouse').click()
    await page.getByLabel('Warehouse name').fill(name)
    await page.getByLabel('Code').fill(code)
    await page.getByTestId('save-warehouse').click()
    await page.getByText(`${name} added`).waitFor()
  }
  await row(page, 'WH-NGJ').getByText('1301-02').waitFor() // the ledger list refreshes after the save
  assert.match(await row(page, 'WH-TEJ').innerText(), /Head office[\s\S]*1301-01/)

  // D5: a two-level tree; the child sits right under its parent, indented
  await page.goto('/inventory/categories')
  await page.getByTestId('empty-new-product-categories').click()
  await page.getByLabel('Category name').fill('Edible oils')
  await page.getByLabel('Code prefix').fill('oil')
  await page.getByTestId('save-node').click()
  await row(page, 'Edible oils').waitFor()
  await page.getByTestId('new-product-categories').click()
  await page.getByLabel('Category name').fill('Soybean oil')
  await page.getByLabel('Parent category').selectOption({ label: 'Edible oils' })
  await page.getByTestId('save-node').click()
  await row(page, 'Soybean oil').waitFor()
  assert.deepEqual((await page.locator('tbody tr td:first-child').allInnerTexts()).map((t) => t.replace('└', '').trim()), ['Edible oils', 'Soybean oil'])
  assert.equal(await row(page, 'Edible oils').locator('td').nth(1).innerText(), 'OIL')

  // D2: a product in the sub-category (code from the parent's prefix), a unit added inline, reorder levels in both warehouses
  await page.goto('/inventory/products')
  await page.getByTestId('new-product').click()
  await page.waitForURL(/\/inventory\/products\/new$/)
  await page.getByTestId('save-product').click()
  await page.getByText('Enter the item name').waitFor()
  await page.getByLabel('Item name').fill('Soybean oil 5L jar')
  await page.getByLabel('Category').selectOption({ label: '— Soybean oil' })
  assert.equal(await page.getByLabel('Item code').getAttribute('placeholder'), 'OIL-…')
  await page.locator('#p-unit').selectOption({ label: 'Add unit…' })
  await page.getByLabel('Unit name').fill('can')
  await page.getByRole('button', { name: 'Add unit', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#p-unit')?.selectedOptions[0]?.textContent === 'can')
  await page.getByLabel('Selling price').fill('920.00')
  await page.getByLabel('Wholesale price').fill('900.00')
  await page.getByLabel('Purchase cost').fill('845.5')
  await incomeReady(page)
  await page.getByLabel('Reorder level, Tejgaon warehouse').fill('20')
  await page.getByLabel('Reorder quantity, Tejgaon warehouse').fill('50')
  await page.getByLabel('Reorder level, Narayanganj depot').fill('10')
  await page.getByLabel('Reorder quantity, Narayanganj depot').fill('30')
  await page.getByTestId('save-product').click()
  await page.getByText('Soybean oil 5L jar added as OIL-0001').waitFor()
  await page.waitForURL(/\/inventory\/products$/)

  // D2 service variant: no stock sections, an expense account
  await page.getByTestId('new-product').click()
  await page.getByText('Service', { exact: true }).click()
  await page.getByRole('heading', { name: 'New service' }).waitFor()
  assert.equal(await page.getByText('Stock by warehouse').count(), 0)
  await page.getByLabel('Item name').fill('Delivery charge')
  await page.locator('#p-unit').selectOption({ label: 'pcs' })
  await page.getByLabel('Selling price').fill('500.00')
  await incomeReady(page)
  await page.getByLabel('Expense account').fill('6105')
  await page.getByRole('option', { name: /6105/ }).first().click()
  await page.getByTestId('save-product').click()
  await page.getByText('Delivery charge added as PRD-0001').waitFor()

  // D1: both listed with their figures; the type filter lives in the URL
  await page.waitForURL(/\/inventory\/products$/)
  // Cost is the moving-average cost, 0 until purchase bills post (P4); on hand 0, so out of stock.
  assert.match(await row(page, 'OIL-0001').innerText(), /Soybean oil[\s\S]*can[\s\S]*0\.00[\s\S]*920\.00[\s\S]*0\.000[\s\S]*Out of stock/)
  assert.match(await row(page, 'PRD-0001').innerText(), /Service/)
  await page.goto('/inventory/products?type=service')
  await row(page, 'PRD-0001').waitFor()
  assert.equal(await row(page, 'OIL-0001').count(), 0)
  assert.deepEqual(errors, [])
  await context.close()
})

test('edit with a concurrent change keeps the input; an unused item deletes, a used one is made inactive', async () => {
  const { context, page, errors } = await newPage()
  const api = apiFor(page)
  await signIn(page, OWNER)
  await page.goto('/inventory/products')
  await row(page, 'OIL-0001').getByRole('button', { name: /^Edit / }).click() // a row opens D4; the pencil opens the form
  await page.waitForURL(/\/inventory\/products\/\d+\/edit$/)
  const id = page.url().split('/').at(-2)
  assert.equal(await page.getByLabel('Reorder level, Tejgaon warehouse').inputValue(), '20')
  assert.match(await page.getByTestId('on-hand').innerText(), /^0\.000 can/)

  // Someone else saves first (API, If-Match on the current version); our save then gets 409 and keeps the input
  const current = await api('GET', `/products/${id}`)
  const other = await api('PATCH', `/products/${id}`, { wholesale_price: '890.00' }, { 'X-If-Match': `W/"${current.body.data.version}"` })
  assert.equal(other.status, 200, JSON.stringify(other.body))
  await page.getByLabel('Selling price').fill('950.00')
  await page.getByTestId('save-product').click()
  await page.getByText('Someone else changed this record').waitFor()
  assert.equal(await page.getByLabel('Selling price').inputValue(), '950.00', 'input preserved (BR-049)')
  await page.getByRole('button', { name: 'Reload' }).click()
  await page.getByText('Loaded the latest version').waitFor()
  await page.getByTestId('save-product').click()
  await page.getByText('Changes saved').waitFor()
  await page.waitForURL(/\/inventory\/products$/)
  await row(page, 'OIL-0001').getByText('950.00').waitFor()

  // An item never used deletes after typing its name
  await page.goto('/inventory/products/new')
  await page.getByLabel('Item name').fill('Sample sachet')
  await page.locator('#p-unit').selectOption({ label: 'pcs' })
  await page.getByLabel('Selling price').fill('5')
  await incomeReady(page)
  await page.getByTestId('save-product').click()
  await page.waitForURL(/\/inventory\/products$/)
  await row(page, 'Sample sachet').getByRole('button', { name: /^Edit / }).click() // the row itself opens D4; Delete is on the form
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByLabel('Type the item name to confirm').fill('Sample sachet')
  await page.getByRole('button', { name: 'Delete item' }).click()
  await page.getByText('Sample sachet deleted').waitFor()
  await row(page, 'Sample sachet').waitFor({ state: 'detached' })

  // A used item (here: one stock movement, as posting will create from P4) cannot be deleted; it is made inactive instead (TC-INV-006)
  const wh = sqlRows("SELECT id FROM warehouses WHERE code = 'WH-TEJ'")[0][0]
  sql(`INSERT INTO stock_movements (company_id, product_id, warehouse_id, movement_type, moved_on, quantity_in, unit_cost, value_in, qty_balance_after,
    avg_cost_after, source_type, source_id, created_at) VALUES (1, ${id}, ${wh}, 'adjustment_in', CURDATE(), 1, 845, 845, 1, 845, 'e2e_check', 0, NOW())`)
  try {
    await page.goto(`/inventory/products/${id}/edit`)
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByLabel('Type the item name to confirm').fill('Soybean oil 5L jar')
    await page.getByRole('button', { name: 'Delete item' }).click()
    await page.getByText('This item cannot be deleted').waitFor()
    await page.getByTestId('deactivate-instead').click()
    await page.getByText('Soybean oil 5L jar is now inactive').waitFor()
    await page.getByTestId('reactivate-product').click()
    await page.getByText('Soybean oil 5L jar is active again').waitFor()
  } finally {
    sql("DELETE FROM stock_movements WHERE source_type = 'e2e_check'")
  }

  // The activity of OIL-0001 shows the changes
  await page.goto(`/inventory/products/${id}/edit`)
  await page.getByText('Activity', { exact: true }).waitFor()
  await page.getByText(/Selling price|selling_price/i).first().waitFor()
  assert.deepEqual(errors, [])
  await context.close()
})

test('roles: Store keeper adds and edits without costs; Sales staff and Viewer only read', async () => {
  const { context, page, errors } = await newPage()

  // Store keeper (inventory.create/edit, no view_costs): lands on products, no cost or value anywhere (BR-052, TC-AUTH-010)
  await signIn(page, STORE)
  await page.waitForURL(/\/inventory\/products$/)
  await row(page, 'OIL-0001').waitFor()
  const h = await headers(page)
  assert.ok(!h.some((x) => x.includes('COST') || x.includes('VALUE')), `no cost columns: ${h}`)
  await page.getByTestId('new-product').click()
  await page.getByLabel('Item name').waitFor()
  assert.equal(await page.getByLabel('Purchase cost').count(), 0, 'no purchase cost field')
  await page.getByLabel('Item name').fill('Mustard oil 1L bottle')
  await page.getByLabel('Category').selectOption({ label: 'Edible oils' })
  await page.locator('#p-unit').selectOption({ label: 'pcs' })
  await page.getByLabel('Selling price').fill('260.00')
  await incomeReady(page)
  await page.getByTestId('save-product').click()
  await page.getByText('Mustard oil 1L bottle added as OIL-0002').waitFor()
  await row(page, 'OIL-0002').click()
  await page.getByTestId('product-name').getByText('Mustard oil 1L bottle').waitFor() // D4 (P11)
  assert.equal(await page.getByTestId('tile-value').count(), 0, 'no stock value on D4 without inventory.view_costs')
  await page.getByTestId('edit-product').click()
  await page.getByTestId('on-hand').waitFor()
  assert.equal(await page.getByText(/avg cost/).count(), 0, 'no value or average cost on the edit page')
  await page.goto('/inventory/warehouses')
  await row(page, 'WH-TEJ').waitFor()
  assert.ok(!(await headers(page)).includes('INVENTORY LEDGER'), 'ledger codes need accounting.view')
  await page.getByTestId('profile-menu').click()
  await page.getByRole('menuitem', { name: /Sign out/ }).click()
  await page.waitForURL(/\/sign-in/)

  // Sales staff and Viewer: read the lists (with costs), cannot add or edit
  for (const who of [SALES, VIEWER]) {
    await signIn(page, who)
    await page.goto('/inventory/products')
    await row(page, 'OIL-0001').waitFor()
    assert.ok((await headers(page)).includes('COST (৳)'), `${who} sees costs`)
    assert.equal(await page.getByTestId('new-product').count(), 0, `${who}: no New item`)
    await row(page, 'OIL-0001').click()
    await page.getByTestId('product-name').waitFor()
    assert.match(page.url(), /\/inventory\/products\/\d+$/, `${who}: a row opens the details, not the edit form`)
    assert.equal(await page.getByTestId('edit-product').count(), 0, `${who}: no Edit`)
    await page.goto('/inventory/products/new')
    await page.getByTestId('state-denied').waitFor()
    await page.goto('/inventory/categories')
    await row(page, 'Edible oils').waitFor()
    assert.equal(await page.getByTestId('new-product-categories').count(), 0)
    assert.equal(await page.getByRole('button', { name: /^Edit / }).count(), 0)
    await page.goto('/inventory/warehouses')
    await row(page, 'WH-TEJ').waitFor()
    assert.equal(await page.getByTestId('new-warehouse').count(), 0)
    await page.getByTestId('profile-menu').click()
    await page.getByRole('menuitem', { name: /Sign out/ }).click()
    await page.waitForURL(/\/sign-in/)
  }
  assert.deepEqual(errors, [])
  await context.close()
})

test('database: one inventory ledger under 1301 per warehouse; reorder settings per warehouse; none for services', () => {
  const ledgers = sqlRows(`SELECT w.code, l.code, g.code FROM warehouses w JOIN ledgers l ON l.id = w.inventory_ledger_id
    JOIN account_groups g ON g.id = l.account_group_id ORDER BY w.code`)
  assert.deepEqual(ledgers, [['WH-NGJ', '1301-02', '1301'], ['WH-TEJ', '1301-01', '1301']])
  assert.equal(sqlRows(`SELECT COUNT(*) FROM ledgers WHERE ledger_kind = 'inventory'`)[0][0], '2', 'no stray inventory ledgers')
  const settings = sqlRows(`SELECT w.code, s.reorder_level, s.reorder_qty FROM product_warehouse_settings s JOIN products p ON p.id = s.product_id
    JOIN warehouses w ON w.id = s.warehouse_id WHERE p.code = 'OIL-0001' ORDER BY w.code`)
  assert.deepEqual(settings, [['WH-NGJ', '10.000', '30.000'], ['WH-TEJ', '20.000', '50.000']])
  assert.equal(sqlRows(`SELECT COUNT(*) FROM product_warehouse_settings s JOIN products p ON p.id = s.product_id WHERE p.item_type = 'service'`)[0][0], '0')
  assert.equal(sqlRows(`SELECT COUNT(*) FROM stock_balances`)[0][0], '0', 'no stock before P4')
  const audited = sqlRows(`SELECT DISTINCT auditable_type FROM audit_logs WHERE auditable_type IN ('warehouses', 'product_categories', 'units', 'products')`).map((r) => r[0]).sort()
  assert.deepEqual(audited, ['product_categories', 'products', 'units', 'warehouses'])
})

// Responsive (CLAUDE.md §5.4): the inventory pages at every width.
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${name} ${viewport.width} px: products, product form, categories and warehouses fit the screen`, async () => {
    const phone = viewport.width < 640
    const { context, page, errors } = await newPage({ viewport, isMobile: phone, hasTouch: viewport.width < 900 })
    await signIn(page, OWNER)
    await page.goto('/inventory/products')
    await (phone ? page.locator('.lf-cardrow', { hasText: 'OIL-0001' }) : row(page, 'OIL-0001')).waitFor()
    await assertNoPageScroll(page, `${name} product list`)
    await page.goto('/inventory/products/new')
    await page.getByLabel('Item name').waitFor()
    await assertNoPageScroll(page, `${name} product form`)
    for (const [path, text] of [['/inventory/categories', 'Edible oils'], ['/inventory/warehouses', 'WH-TEJ']]) {
      await page.goto(path)
      await (phone ? page.locator('.lf-cardrow', { hasText: text }) : row(page, text)).waitFor()
      await assertNoPageScroll(page, `${name} ${path}`)
    }
    assert.deepEqual(errors, [])
    await context.close()
  })
}
