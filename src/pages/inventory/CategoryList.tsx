import { TreePage, type TreeConfig } from './TreePage'

/** D5 Product categories (Inv-Categories.dc.html; backlog P3.2-FE-03): two-level tree with code prefixes, items and stock value. */
const CONFIG: TreeConfig = {
  kind: 'product-categories', title: 'Product categories', noun: 'category', icon: 'folder-tree', categories: true,
  description: 'Group products for lists and reports. A code prefix makes new product codes, e.g. OIL-0001.',
  emptyText: 'Add categories such as Edible oils or Rice. Sub-categories go one level below them.',
}

export function CategoryList() {
  return <TreePage config={CONFIG} />
}
