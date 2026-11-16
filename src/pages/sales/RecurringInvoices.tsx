import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { RecurringInvoice, SalesInvoice } from '../../api/contract.gen'
import { useRecurringInvoices, useRepeatInvoice, useUpdateRecurringInvoice } from '../../api/recurringInvoices'
import { useSession } from '../../auth/session'
import { useToast } from '../../app/toast'
import { ListCard } from '../../components/ListCard'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { ds } from '../../ds'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useListParams } from '../../lib/useListParams'

/**
 * PEP-517 repeating sales invoices: the "Repeat this invoice" dialog on E5 and the "Repeating invoices" page (pause,
 * resume, end). Every run date the server writes a draft invoice for someone to check and post; nothing posts by itself.
 */
type Frequency = RecurringInvoice['frequency']

export const FREQUENCIES: Array<{ value: Frequency; label: string }> = [
  { value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' }, { value: 'yearly', label: 'Every year' },
]

/** A date (YYYY-MM-DD) one step later; months keep the day or fall back to the month's last day (31 Jan → 28 Feb), like the server. */
export function nextDate(date: string, frequency: Frequency): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  if (frequency === 'weekly') {
    const t = new Date(Date.UTC(y, m - 1, d + 7))
    return t.toISOString().slice(0, 10)
  }
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

export function scheduleLine(r: Pick<RecurringInvoice, 'frequency' | 'ends_type' | 'ends_after_count' | 'ends_on'>): string {
  const how = FREQUENCIES.find((f) => f.value === r.frequency)?.label ?? r.frequency
  if (r.ends_type === 'after_count') return `${how}, ${r.ends_after_count} times in all`
  if (r.ends_type === 'on_date' && r.ends_on) return `${how}, until ${shortDate(r.ends_on)}`
  return `${how}, until stopped`
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function RepeatDialog({ inv, onClose }: { inv: SalesInvoice; onClose: () => void }) {
  const { Button, Field, Input, Select, Segmented } = ds()
  const toast = useToast()
  const navigate = useNavigate()
  const repeat = useRepeatInvoice(inv.id)
  const idem = useIdempotencyKey()
  const [frequency, setFrequency] = useState<Frequency>('monthly')
  const [next, setNext] = useState(nextDate(inv.invoice_date, 'monthly'))
  const [touched, setTouched] = useState(false)
  const [ends, setEnds] = useState<'never' | 'after_count' | 'on_date'>('never')
  const [count, setCount] = useState('12')
  const [until, setUntil] = useState('')
  const [error, setError] = useState<unknown>(null)
  const fieldError = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)

  async function save() {
    setError(null)
    try {
      const r = await repeat.mutateAsync({ idempotencyKey: idem.key, input: { frequency, next_run_on: next, ends_type: ends,
        ends_after_count: ends === 'after_count' ? Number(count) : null, ends_on: ends === 'on_date' ? until || null : null } })
      idem.reset()
      toast({ tone: 'positive', title: `${inv.number} will repeat`, description: `${scheduleLine(r)}. The first draft is written on ${shortDate(r.next_run_on)}.` })
      onClose()
      navigate('/sales/recurring')
    } catch (e) {
      setError(e)
    }
  }

  return (
    <ResponsiveDialog title={`Repeat ${inv.number}`} tone="info" width={520} onClose={onClose} testId="repeat-dialog"
      description={`On each date Pluto writes a draft invoice for ${inv.party.name} with the same items and prices. You check it and post it; nothing posts by itself.`}
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button>
        <Button variant="primary" icon="repeat" loading={repeat.isPending} disabled={repeat.isPending} onClick={() => void save()} data-testid="confirm-repeat">Repeat</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ProblemBanner error={error instanceof ApiError && Object.keys(error.fieldErrors).length ? null : error} />
        <Field label="How often" htmlFor="rep-freq">
          <Select id="rep-freq" value={frequency} options={FREQUENCIES}
            onChange={(e) => { const f = e.target.value as Frequency; setFrequency(f); if (!touched) setNext(nextDate(inv.invoice_date, f)) }} />
        </Field>
        <Field label="Next invoice date" htmlFor="rep-next" error={fieldError('next_run_on')}>
          <Input id="rep-next" type="date" value={next} onChange={(e) => { setTouched(true); setNext(e.target.value) }} />
        </Field>
        <Field label="Ends">
          <Segmented value={ends} onChange={(v: string) => setEnds(v as typeof ends)} aria-label="Ends"
            options={[{ value: 'never', label: 'When I stop it' }, { value: 'after_count', label: 'After a number' }, { value: 'on_date', label: 'On a date' }]} />
        </Field>
        {ends === 'after_count' && (
          <Field label="Invoices in all (this one included)" htmlFor="rep-count" error={fieldError('ends_after_count')}>
            <Input id="rep-count" type="number" min={2} max={999} value={count} onChange={(e) => setCount(e.target.value)} />
          </Field>
        )}
        {ends === 'on_date' && (
          <Field label="Last date" htmlFor="rep-until" error={fieldError('ends_on')}>
            <Input id="rep-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        )}
      </div>
    </ResponsiveDialog>
  )
}

export function RecurringInvoiceList() {
  const { PageHeader, DataTable, EmptyState, Badge, Button, Tabs } = ds()
  const { can } = useSession()
  const toast = useToast()
  const navigate = useNavigate()
  const { get, set, page } = useListParams()
  const tab = get('tab') === 'stopped' ? 'stopped' : 'active'
  const list = useRecurringInvoices({ active: tab === 'active' ? 'true' : 'false', page })
  const update = useUpdateRecurringInvoice()

  async function toggle(r: RecurringInvoice) {
    try {
      await update.mutateAsync({ id: r.id, version: r.version, input: { is_active: !r.is_active } })
      toast({ tone: 'positive', title: r.is_active ? 'Paused' : 'Running again', description: `${r.party.name}: ${r.is_active ? 'no more drafts until you resume it' : `next draft on ${shortDate(r.next_run_on)}`}.` })
    } catch (e) {
      toast({ tone: 'negative', title: 'Not changed', description: e instanceof Error ? e.message : 'Try again in a moment.' })
    }
  }

  const rows = (list.data?.data ?? []).map((r) => ({
    id: r.id, customer: r.party.name, from: r.source_invoice_number ?? '—', schedule: scheduleLine(r),
    next: r.is_active ? shortDate(r.next_run_on) : '—', done: `${r.occurrences_done} so far`, last: r.last_invoice_number ?? '—',
    status: <Badge tone={r.is_active ? 'positive' : 'neutral'} dot>{r.is_active ? 'Running' : 'Stopped'}</Badge>,
    actions: can('sales.edit') ? <Button size="sm" variant="secondary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); void toggle(r) }} data-testid={`toggle-${r.id}`}>{r.is_active ? 'Pause' : 'Resume'}</Button> : null,
    item: r,
  }))
  const columns = [
    { key: 'customer', label: 'Customer' }, { key: 'from', label: 'From invoice', mono: true }, { key: 'schedule', label: 'How often' },
    { key: 'next', label: 'Next draft' }, { key: 'done', label: 'Invoices' }, { key: 'last', label: 'Latest', mono: true },
    { key: 'status', label: 'Status' }, { key: 'actions', label: '', align: 'right' as const },
  ]
  const empty = <EmptyState icon="repeat" title={tab === 'active' ? 'No repeating invoices yet' : 'Nothing stopped'}
    description="Open an invoice you send regularly (rent, a service contract, a monthly supply) and choose Repeat. Pluto writes a draft on each date for you to post." />

  return (
    <>
      <PageHeader title="Repeating invoices" description="Invoices Pluto writes as drafts on a schedule; check and post each one from Drafts." />
      <div style={{ marginBottom: 12 }}>
        <Tabs key={tab} value={tab} onChange={(v) => set({ tab: v === 'active' ? null : v })} items={[{ value: 'active', label: 'Running' }, { value: 'stopped', label: 'Paused or ended' }]} />
      </div>
      <ProblemBanner error={list.error} onRetry={() => void list.refetch()} />
      <ListCard label="Repeating invoices" meta={list.data?.meta} onPage={(p) => set({ page: p === 1 ? null : String(p) })}
        cards={{ columns, rows, loading: list.isPending, mobileColumns: ['customer', 'schedule', 'next', 'actions'], badgeKey: 'status', empty,
          onOpen: (r) => { const id = (r.item as RecurringInvoice).last_invoice_id; if (id) navigate(`/sales/invoices/${id}`) } }}>
        <DataTable columns={columns} rows={rows} loading={list.isPending} emptyState={empty}
          onRowClick={(r: (typeof rows)[number]) => { if (r.item.last_invoice_id) navigate(`/sales/invoices/${r.item.last_invoice_id}`) }} />
      </ListCard>
    </>
  )
}
