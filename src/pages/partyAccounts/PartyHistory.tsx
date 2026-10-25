import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { PartyTransaction } from '../../api/contract.gen'
import { useParty, type PartyType } from '../../api/parties'
import { usePartyTransactions } from '../../api/partyAccounts'
import { ds, type DataColumn } from '../../ds'
import { useListParams } from '../../lib/useListParams'
import { ListCard } from '../../components/ListCard'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { NotFound } from '../../components/states'
import { shortDate } from '../purchases/BillList'
import { DOC_LABEL, STATUS_LABEL } from './links'

/**
 * B5/C5 Party history (backlog P6.2-FE-07): every invoice or bill and every receipt or payment of the party with its
 * status, from GET /parties/{id}/transactions; filters in the URL; a row opens the document.
 */
export function PartyHistory({ type }: { type: PartyType }) {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const party = useParty(id)
  const { get, set, search, setSearch, page } = useListParams()
  const docType = get('document_type'), from = get('date_from'), to = get('date_to'), q = get('q')
  const list = usePartyTransactions(id, { q: q || undefined, document_type: docType || undefined, date_from: from || undefined, date_to: to || undefined, page, per_page: 25 })
  const { PageHeader, DataTable, Input, Select, Field, Badge, Button, EmptyState } = ds()
  const back = type === 'customer' ? '/customers' : '/suppliers'

  if ((party.error instanceof ApiError && party.error.status === 404) || (party.data && party.data.party.party_type !== type)) {
    return <NotFound what={`this ${type}`} back={back} backLabel={type === 'customer' ? 'Customers' : 'Suppliers'} />
  }
  if (party.error) return <ProblemBanner error={party.error} onRetry={() => void party.refetch()} />
  if (!party.data) return <PageSkeleton template="list" />
  const p = party.data.party
  const tone = (s: string) => (s === 'paid' || s === 'applied' ? 'positive' : s === 'cancelled' ? 'negative' : s === 'draft' ? 'neutral' : s === 'unapplied' ? 'accent' : 'info')
  const rows = (list.data?.data ?? []).map((t: PartyTransaction) => ({ id: `${t.type}-${t.id}`, url: t.url, kind: DOC_LABEL[t.type] ?? t.type, number: t.number, date: shortDate(t.date),
    reference: t.reference ?? '', due: t.due_date ? shortDate(t.due_date) : '', amount: t.amount, status: t.status }))
  const columns: DataColumn[] = [
    { key: 'date', label: 'Date' }, { key: 'kind', label: 'Type' }, { key: 'number', label: 'Number', mono: true }, { key: 'reference', label: 'Reference', mono: true },
    { key: 'due', label: 'Due' }, { key: 'amount', label: 'Amount (৳)', type: 'amount' },
    { key: 'status', label: 'Status', render: (v: string) => <Badge tone={tone(v) as never} dot>{STATUS_LABEL[v] ?? v}</Badge> },
  ]
  const types = type === 'customer' ? ['sales_invoice', 'receipt'] : ['purchase_bill', 'payment']

  return (
    <>
      <PageHeader eyebrow={p.name} title="History" description={`${p.code} · documents and payments`}
        actions={<Button variant="ghost" icon="arrow-left" onClick={() => navigate(`${back}/${p.id}`)}>Back to {type}</Button>} />
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="History" meta={list.data?.meta} onPage={(n) => set({ page: n === 1 ? null : String(n) })}
        cards={{ columns, rows, loading: list.isPending, onOpen: (r) => navigate(r.url), mobileColumns: ['number', 'kind', 'date', 'amount'], badgeKey: 'status',
          empty: <EmptyState icon="list-tree" title="Nothing yet" description={`Invoices, bills and payments of ${p.name} appear here.`} /> }}
        toolbar={<>
          <div style={{ flex: '1 1 240px', maxWidth: 340 }}><Input icon="search" placeholder="Search number or reference" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" /></div>
          <div style={{ width: 200 }}><Select aria-label="Type" value={docType} onChange={(e) => set({ document_type: e.target.value || null })}
            options={[{ value: '', label: 'All types' }, ...types.map((t) => ({ value: t, label: DOC_LABEL[t]! }))]} /></div>
        </>}
        filters={<>
          <Field label="From" htmlFor="ph-from"><Input id="ph-from" type="date" value={from} onChange={(e) => set({ date_from: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="ph-to"><Input id="ph-to" type="date" value={to} onChange={(e) => set({ date_to: e.target.value || null })} /></Field>
        </>}>
        <DataTable caption="History" columns={columns} rows={rows} loading={list.isPending} onRowClick={(r: { url: string }) => navigate(r.url)} />
      </ListCard>
    </>
  )
}
