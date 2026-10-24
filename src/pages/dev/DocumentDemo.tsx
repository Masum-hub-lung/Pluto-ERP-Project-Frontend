import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { ApiError } from '../../api/client'
import type { DocumentCalculation, Party } from '../../api/contract.gen'
import { useTaxRules, useWarehouses } from '../../api/inventory'
import { DocumentFooter } from '../../components/document/DocumentFooter'
import { DocumentHeader } from '../../components/document/DocumentHeader'
import { LineGrid } from '../../components/document/LineGrid'
import { completeIndexes, emptyLine, mapResults, type LineValues } from '../../components/document/lines'
import { PartyPanel } from '../../components/document/PartyPanel'
import { PostDialog } from '../../components/document/PostDialog'
import { TotalsPanel } from '../../components/document/TotalsPanel'
import { useCalculate } from '../../components/document/useCalculate'
import { ds } from '../../ds'

/**
 * Development-only page (/dev/document, only in dev builds; backlog P4.4-FE-03/04): the document editor parts with a
 * canned "calculate" — the figures are fixed sample answers, not computed here, so the grid's layout, keyboard
 * add/remove, the party card and the post dialog's refusals can be tried without a bill. "Post" fails once with a
 * canned back-dated refusal, then succeeds.
 */
const canned = (n: number): DocumentCalculation => ({
  lines: Array.from({ length: n }, (_, i) => ({ line_no: i + 1, gross: '1000.00', discount_amount: '0.00', tax_amount: '0.00', line_total: '1000.00', available_qty: '18.000' })),
  warnings: [], subtotal: `${n}000.00`, discount_total: '0.00', tax_total: '0.00', rounding_adjustment: '0.00', total: `${n}000.00`,
  amount_in_words: `Taka ${n} thousand only (sample)`, effects: ['Stock in: sample effect', 'Supplier balance goes up (sample)'],
})

const backdated = () => new ApiError({ type: 'about:blank', title: 'Back-dated document', status: 422, code: 'backdated_confirmation_required', detail: 'The date is 10 days before today (sample).' } as never)

export function DocumentDemo() {
  const { PageHeader, Card } = ds()
  const taxRules = useTaxRules()
  const warehouses = useWarehouses()
  const [party, setParty] = useState<Party | null>(null)
  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState('')
  const { control, register, watch, setValue, formState: { errors } } = useForm<{ lines: LineValues[]; date: string; due_date: string; warehouse_id: string }>({
    defaultValues: { lines: [emptyLine()], date: '2026-10-24', due_date: '', warehouse_id: '' },
  })
  const lines = watch('lines')
  const indexes = completeIndexes(lines)
  const calc = useCalculate(indexes.length ? indexes.length : null, async (n: number) => canned(n))
  return (
    <>
      <PageHeader eyebrow="Development" title="Document editor" description="Document editor parts with a canned calculation (sample figures)." />
      <Card title="Header">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
          <PartyPanel type="supplier" party={party} onChange={setParty} calc={calc.result} />
          <DocumentHeader register={register} errors={{}} warehouses={warehouses.data ?? []} />
        </div>
      </Card>
      <div style={{ height: 16 }} />
      {/* Lines take the full width (nine columns); the totals sit below on the right, as on the bill editor. */}
      <Card title="Lines">
        <LineGrid control={control} register={register} watch={watch} setValue={setValue} errors={errors} side="purchase"
          results={mapResults(calc.result?.lines, indexes)} taxRules={taxRules.data ?? []} defaultPrice={(p) => p.last_purchase_cost ?? p.selling_price} />
      </Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><aside style={{ width: 'min(100%, 380px)' }}><TotalsPanel {...calc} /></aside></div>
      <p data-testid="dev-line-count">{lines.length} rows · {indexes.length} complete{posted && ` · ${posted}`}</p>
      <DocumentFooter onCancel={() => setPosted('cancelled')} onSaveDraft={() => setPosted('saved')} primary={{ label: 'Save and post', onClick: () => setPosting(true), testId: 'save-post' }} />
      {posting && (
        <PostDialog title="Post this bill?" number="PB-SAMPLE" calc={calc.result} total={calc.result?.total} onClose={() => setPosting(false)}
          onPost={async (confirm) => { if (!confirm) throw backdated(); setPosting(false); setPosted('posted') }} />
      )}
    </>
  )
}
