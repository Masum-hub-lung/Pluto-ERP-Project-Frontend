import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activePath, landingPath, visibleNav } from '../../src/app/nav'

// A role's permissions; plan modules (PEP-498, `module:*`) are all included unless a test says otherwise.
const role = (perms: string[]) => (p: string) => p.startsWith('module:') || perms.includes(p)
// View permissions of the backend's RoleTemplates (plus parties.create for Owner).
const STORE = role(['inventory.view', 'purchases.view', 'inventory.create', 'inventory.edit'])
const OWNER = role(['dashboard.view', 'sales.view', 'purchases.view', 'lc.view', 'parties.view', 'parties.create', 'inventory.view', 'banking.view', 'accounting.view', 'reports.view'])
const VIEWER = role(['dashboard.view', 'sales.view', 'purchases.view', 'lc.view', 'parties.view', 'inventory.view', 'banking.view', 'accounting.view', 'reports.view'])

const labels = (can: (p: string) => boolean) => visibleNav(can).flatMap((s) => s.items.map((i) => i.label))

test('a Store keeper sees only Purchases and Inventory (and personal Settings)', () => {
  assert.deepEqual(labels(STORE), ['Purchases', 'Inventory', 'Settings'])
  const inv = visibleNav(STORE).flatMap((s) => s.items).find((i) => i.label === 'Inventory')!
  assert.equal(inv.children!.length, 9)
})

test('Owner sees every module; Viewer loses only create sub-pages', () => {
  assert.deepEqual(labels(OWNER), ['Dashboard', 'Sales', 'Purchases', 'LC Management', 'Customers', 'Suppliers', 'Inventory', 'Cash and bank', 'Income', 'Expenses', 'Accounting', 'Reports', 'Settings'])
  const cust = (can: (p: string) => boolean) => visibleNav(can).flatMap((s) => s.items).find((i) => i.label === 'Customers')!.children!.map((c) => c.label)
  assert.deepEqual(cust(OWNER), ['All customers', 'Add customer', 'Outstanding'])
  assert.deepEqual(cust(VIEWER), ['All customers', 'Outstanding'])
})

test('active item is the longest matching path on segment boundaries', () => {
  assert.equal(activePath('/customers/12/edit'), '/customers')
  assert.equal(activePath('/customers/new'), '/customers/new')
  assert.equal(activePath('/inventory/products/5'), '/inventory/products')
  assert.equal(activePath('/salesfoo'), null)
})

test('landing: built modules first, else customers, else the first permitted module', () => {
  assert.equal(landingPath(OWNER), '/dashboard') // the dashboard (P14) is home for every role that may view it
  assert.equal(landingPath(role(['sales.view', 'parties.view'])), '/sales') // without dashboard.view: Sales (P10)
  assert.equal(landingPath(role(['parties.view'])), '/customers')
  assert.equal(landingPath(STORE), '/inventory')
  assert.equal(landingPath(role([])), '/settings/security')
})

test('PEP-498: a plan without LC hides the whole LC portal; without LC finance only its pages go', () => {
  const owner = ['dashboard.view', 'lc.view', 'lc.create', 'accounting.view']
  const lc = (modules: string[]) => visibleNav((p) => (p.startsWith('module:') ? modules.includes(p.slice(7)) : owner.includes(p)))
    .flatMap((s) => s.items).find((i) => i.label === 'LC Management')
  assert.equal(lc([]), undefined)
  const noFinance = lc(['lc_management'])!.children!.map((c) => c.path)
  assert.ok(noFinance.includes('/lc/list'))
  for (const p of ['/lc/banks', '/lc/loans', '/lc/fx-revaluation']) assert.ok(!noFinance.includes(p), p)
  assert.ok(lc(['lc_management', 'lc_finance'])!.children!.some((c) => c.path === '/lc/loans'))
})
