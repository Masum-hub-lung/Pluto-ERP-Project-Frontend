import { useState } from 'react'
import { useBulkDeactivate } from '../api/parties'
import { useToast } from '../app/toast'
import { ds } from '../ds'
import { ConfirmDialog } from './ConfirmDialog'
import { ProblemBanner } from './ProblemBanner'

/**
 * "Deactivate selected" for the B1/C1 selection bar (backlog P2.2-FE-05): confirm (L6), POST /parties/bulk-deactivate,
 * then one toast with what happened per item (ERR-5: parties with history are deactivated, failures name the reason).
 */
export function BulkDeactivate({ ids, clear, noun, names }: { ids: number[]; clear: () => void; noun: 'customer' | 'supplier'; names: Map<number, string> }) {
  const { Button } = ds()
  const bulk = useBulkDeactivate()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`

  async function run() {
    setError(null)
    try {
      const r = await bulk.mutateAsync(ids)
      setOpen(false)
      clear()
      const failed = r.failed.map((f) => `${names.get(f.id) ?? `#${f.id}`}: ${f.detail}`)
      toast(r.failed.length === 0
        ? { tone: 'positive', title: `${plural(r.succeeded.length)} deactivated` }
        : { tone: 'warning', title: `${r.succeeded.length} deactivated, ${r.failed.length} could not be`, description: failed.join(' · ') })
    } catch (e) {
      setError(e)
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" icon="x" onClick={() => setOpen(true)} data-testid="bulk-deactivate">Deactivate selected</Button>
      {open && (
        <ConfirmDialog title={`Make ${plural(ids.length)} inactive?`} confirmLabel="Deactivate" loading={bulk.isPending} onConfirm={() => void run()}
          onClose={() => setOpen(false)}
          description={`They are hidden from new documents. Their ledgers and past documents stay, and you can reactivate them any time.`}>
          <ProblemBanner error={error} />
        </ConfirmDialog>
      )}
    </>
  )
}
