import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PageMeta } from '../../api/contract.gen'
import { useWarehouses } from '../../api/inventory'
import { useParty } from '../../api/parties'
import { ds, type DataColumn } from '../../ds'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../ListCard'
import { PartyPicker } from '../pickers/PartyPicker'
import { ProblemBanner } from '../ProblemBanner'

/**
 * List template of the trade documents (E13 quotations, F11 purchase orders, E15/F13 returns and notes; backlog P10,
 * GAP-24): status tabs, search, party and date filters in the URL, the API's page of documents, a row opens the document.
 * The caller supplies the query hook (its filters arrive ready), the columns and how a row is built.
 */
export interface DocListConfig<T> {
  title: string
  description: string
  label: string
  /** Party filter (trade documents); stock documents filter by warehouse instead. */
  partyType?: 'customer' | 'supplier'
  warehouseFilter?: boolean
  tabs: { value: string; label: string }[]
  /** Extra filters per tab (e.g. status). */
  tabFilters?: Record<string, Record<string, string>>
  dateLabels?: [string, string]
  searchPlaceholder: string
  columns: DataColumn[]
  mobileColumns: string[]
  toRow: (doc: T) => Record<string, unknown> & { id: number }
  open: (row: { id: number }) => string
  useList: (f: Record<string, string | number | undefined>) => { data?: { data: T[]; meta: PageMeta }; isPending: boolean; error: unknown; refetch: () => unknown }
  newAction?: { label: string; path: string }
  emptyTitle: string
  emptyDescription: string
  rowActions?: (row: Record<string, unknown> & { id: number }) => ReactNode
  /** Content above the tabs (e.g. a switch between returns and notes). */
  above?: ReactNode
}

export function DocumentList<T>({ cfg }: { cfg: DocListConfig<T> }) {
  const { PageHeader, Button, Input, Tabs, DataTable, EmptyState, Field, Select } = ds()
  const navigate = useNavigate()
  const { get, set, search, setSearch, page } = useListParams()
  const tab = get('tab', 'all')
  const q = get('q')
  const partyId = Number(get('party_id')) || 0
  const from = get('date_from'), to = get('date_to')
  const party = useParty(partyId)
  const warehouseId = Number(get('warehouse_id')) || 0
  const warehouses = useWarehouses()
  const list = cfg.useList({ ...(cfg.tabFilters?.[tab] ?? (tab === 'all' ? {} : { status: tab })), q: q || undefined, party_id: partyId || undefined, warehouse_id: warehouseId || undefined,
    date_from: from || undefined, date_to: to || undefined, page, per_page: 25 })
  const rows = (list.data?.data ?? []).map(cfg.toRow)
  const filtered = !!(q || tab !== 'all' || partyId || warehouseId || from || to)
  const clear = () => { setSearch(''); set({ q: null, tab: null, party_id: null, warehouse_id: null, date_from: null, date_to: null }) }
  const create = cfg.newAction ? () => navigate(cfg.newAction!.path) : undefined
  const empty = filtered
    ? <EmptyState icon="search" title={`Nothing matches${q ? ` “${q}”` : ' these filters'}`} description="Check the spelling or clear the filters."
        action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
    : <EmptyState icon="file-text" title={cfg.emptyTitle} description={cfg.emptyDescription}
        action={create ? <Button variant="primary" icon="plus" onClick={create}>{cfg.newAction!.label}</Button> : undefined} />

  return (
    <>
      <PageHeader title={cfg.title} description={cfg.description}
        actions={create ? <Button variant="primary" icon="plus" onClick={create} data-testid="new-document">{cfg.newAction!.label}</Button> : undefined} />
      {cfg.above}
      <div style={{ marginBottom: 12, overflowX: 'auto' }} data-testid="doc-tabs">
        <Tabs key={tab} items={cfg.tabs} value={tab} onChange={(v) => set({ tab: v === 'all' ? null : v })} />
      </div>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label={cfg.label} meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns: cfg.columns, rows, loading: list.isPending, onOpen: (r) => navigate(cfg.open(r)), mobileColumns: cfg.mobileColumns, badgeKey: 'status', empty }}
        toolbar={<>
          <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
            <Input icon="search" placeholder={cfg.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          </div>
          {cfg.partyType && (
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <PartyPicker type={cfg.partyType} value={partyId ? party.data?.party ?? null : null} onChange={(p) => set({ party_id: p ? String(p.id) : null })}
                aria-label={cfg.partyType === 'customer' ? 'Customer' : 'Supplier'} />
            </div>
          )}
          {cfg.warehouseFilter && (
            <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
              <Select aria-label="Warehouse" value={warehouseId ? String(warehouseId) : ''} onChange={(e) => set({ warehouse_id: e.target.value || null })}
                options={[{ value: '', label: 'All warehouses' }, ...(warehouses.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))]} />
            </div>
          )}
        </>}
        filters={<>
          <Field label={cfg.dateLabels?.[0] ?? 'From'} htmlFor="doc-from"><Input id="doc-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label={cfg.dateLabels?.[1] ?? 'To'} htmlFor="doc-to"><Input id="doc-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
        </>}>
        <DataTable caption={cfg.label} columns={cfg.columns} rows={rows} loading={list.isPending} emptyState={empty}
          onRowClick={(r: { id: number }) => navigate(cfg.open(r))} rowActions={cfg.rowActions as never} />
      </ListCard>
    </>
  )
}
