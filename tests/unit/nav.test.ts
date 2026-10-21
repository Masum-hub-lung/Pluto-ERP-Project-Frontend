import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activePath, landingPath, visibleNav } from '../../src/app/nav'

const role = (perms: string[]) => (p: string) => perms.includes(p)
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
  assert.deepEqual(cust(OWNER), ['All customers', 'Add customer'])
  assert.deepEqual(cust(VIEWER), ['All customers'])
})

test('active item is the longest matching path on segment boundaries', () => {
  assert.equal(activePath('/customers/12/edit'), '/customers')
  assert.equal(activePath('/customers/new'), '/customers/new')
  assert.equal(activePath('/inventory/products/5'), '/inventory/products')
  assert.equal(activePath('/salesfoo'), null)
})

test('landing: built modules first, else customers, else the first permitted module', () => {
  assert.equal(landingPath(OWNER), '/customers')
  assert.equal(landingPath(STORE), '/inventory')
  assert.equal(landingPath(role([])), '/settings/security')
})
