import { useState } from 'react'
import type { BulkResult } from '../../api/contract.gen'
import { useBulkPostInvoices } from '../../api/sales'
import { useToast } from '../../app/toast'
import { ds } from '../../ds'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'

/**
 * "Post selected" for the E2 drafts tab (backlog P5.2-FE-02; L6 confirm, ERR-5): POST /sales-invoices/bulk-post, where
 * each draft posts in its own transaction. All posted → a toast; some failed → a dialog naming each failed draft and
 * why (e.g. not enough stock), so the user can fix those and post them again.
 */
export function BulkPostInvoices({ ids, clear, names }: { ids: number[]; clear: () => void; names: Map<number, string> }) {
  const { Button } = ds()
  const bulk = useBulkPostInvoices()
  const idem = useIdempotencyKey()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [result, setResult] = useState<BulkResult | null>(null)
  const plural = (n: number) => `${n} invoice${n === 1 ? '' : 's'}`

  async function run() {
    setError(null)
    try {
      const r = await bulk.mutateAsync({ ids, idempotencyKey: idem.key })
      idem.reset()
      setOpen(false)
      if (r.failed.length === 0) {
        clear()
        toast({ tone: 'positive', title: `${plural(r.succeeded.length)} posted`, description: 'Stock and customer balances are updated.' })
      } else setResult(r) // the selection (and so this component) stays until the result is closed
    } catch (e) {
      setError(e)
    }
  }

  return (
    <>
      <Button size="sm" variant="primary" icon="check" onClick={() => setOpen(true)} data-testid="bulk-post">Post selected</Button>
      {open && (
        <ConfirmDialog title={`Post ${plural(ids.length)}?`} confirmLabel="Post" tone="info" loading={bulk.isPending} onConfirm={() => void run()}
          onClose={() => setOpen(false)}
          description="Each draft is posted on its own: stock goes out and the customer is charged. A draft that cannot be posted stays a draft and is listed afterwards.">
          <ProblemBanner error={error} />
        </ConfirmDialog>
      )}
      {result && (
        <ResponsiveDialog title={`${result.succeeded.length} posted, ${result.failed.length} not posted`} tone="warning" width={520} onClose={() => { setResult(null); clear() }}
          testId="bulk-post-result" description="These drafts were not posted. Open each one to fix it, then post it again."
          footer={<Button variant="primary" onClick={() => { setResult(null); clear() }}>Done</Button>}>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="bulk-post-failures">
            {result.failed.map((f) => <li key={f.id}><strong>{names.get(f.id) ?? `#${f.id}`}</strong>: {f.detail ?? f.code}</li>)}
          </ul>
        </ResponsiveDialog>
      )}
    </>
  )
}
