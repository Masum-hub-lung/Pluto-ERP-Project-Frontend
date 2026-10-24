import { useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import type { DocumentCalculation } from '../../api/contract.gen'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { ProblemBanner } from '../ProblemBanner'
import { ResponsiveDialog } from '../ResponsiveDialog'

/**
 * "Post <document>?" (Sal-DlgPost style, generic; backlog P4.4-FE-04): what posting will do (the calculate effects and
 * total), then Post. Business refusals stay in the dialog: a locked period, insufficient stock with one line per
 * shortage, and a back-dated document, which offers the confirmation the API asks for (BR-053). `onPost` gets the
 * confirmation flag and must throw the ApiError on failure.
 */
export function PostDialog({ title, number, calc, total, onPost, onClose, loading }: {
  title: string; number?: string; calc?: DocumentCalculation | null; total?: string; onPost: (confirmBackdated: boolean) => Promise<void>
  onClose: () => void; loading?: boolean
}) {
  const { Button, Banner, Switch } = ds()
  const [error, setError] = useState<unknown>(null)
  const [confirm, setConfirm] = useState(false)
  const [running, setRunning] = useState(false)
  // A ref, not state: a double click fires twice before React re-renders the disabled button.
  const inFlight = useRef(false)
  const code = error instanceof ApiError ? error.code : null
  const shortages = error instanceof ApiError && code === 'insufficient_stock' ? Object.values(error.fieldErrors).flat() : []

  async function post() {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    try {
      await onPost(confirm)
    } catch (e) {
      setError(e)
    } finally {
      inFlight.current = false
      setRunning(false)
    }
  }

  return (
    <ResponsiveDialog title={title} tone="info" width={520} onClose={onClose} testId="post-dialog"
      description={number ? `${number} goes into the books: stock and balances change, and it can then only be cancelled.` : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button>
        <Button variant="primary" icon="check" loading={loading || running} disabled={loading || running || (code === 'backdated_confirmation_required' && !confirm)}
          onClick={() => void post()} data-testid="confirm-post">Post</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {total && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total</span><strong className="lf-num">{formatTaka(total, { symbol: true })}</strong></div>}
        {!!calc?.effects?.length && (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }} data-testid="post-effects">
            {calc.effects.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        {code === 'insufficient_stock' ? (
          <Banner tone="negative" title="Not enough stock">
            <ul style={{ margin: 0, paddingLeft: 18 }}>{shortages.map((s) => <li key={s}>{s}</li>)}</ul>
          </Banner>
        ) : code === 'backdated_confirmation_required' ? (
          <Banner tone="warning" title="This document is back-dated">
            {(error as ApiError).problem.detail}
            <div style={{ marginTop: 8 }}><Switch label="Yes, post it with this date" checked={confirm} onChange={setConfirm} /></div>
          </Banner>
        ) : <ProblemBanner error={error} />}
      </div>
    </ResponsiveDialog>
  )
}
