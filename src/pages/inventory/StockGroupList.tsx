import { TreePage, type TreeConfig } from './TreePage'

/** D6 Stock groups (Inv-Groups.dc.html; backlog P3.2-FE-04): the reporting hierarchy used for stock valuation (GAP-20). */
const CONFIG: TreeConfig = {
  kind: 'stock-groups', title: 'Stock groups', noun: 'stock group', icon: 'layers',
  description: 'A reporting hierarchy for stock valuation. Categories organise lists; stock groups organise reports.',
  emptyText: 'Add groups such as Trading goods or Packaging materials, nested as deep as your reports need.',
}

export function StockGroupList() {
  return <TreePage config={CONFIG} />
}
