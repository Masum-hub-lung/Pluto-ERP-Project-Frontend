import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useImportStatement, useRecordCashCount, useStartReconciliation, type CashCountView } from '../../api/banking'
import { dhakaToday } from '../../api/platform'
import { useToast } from '../../app/toast'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'

/**
 * Cash and bank dialogs (backlog P12.2-FE-03/06): count cash (G2; a difference goes for approval, BR-058), import a bank
 * statement (G5, G10; the same file twice is refused) and start a reconciliation (G1, G5 → G10).
 */
const NOTES = ['1000', '500', '200', '100', '50', '20', '10', '5', '2', '1']

export function CashCountDialog({ accountId, accountName, onClose, onDone }: { accountId: number; accountName: string; onClose: () => void; onDone: (c: CashCountView) => void }) {
  const { Field, Input, Button } = ds()
  const toast = useToast()
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [error, setError] = useState<unknown>(null)
  const record = useRecordCashCount()
  const idem = useIdempotencyKey()
  const save = async () => {
    setError(null)
    const denominations = NOTES.filter((d) => (counts[d] ?? '').trim() !== '').map((d) => ({ denomination: d, count: Number(counts[d]) || 0 })) // note counts, not money
    if (!denominations.length) { setError(new Error('Enter how many of each note and coin you counted.')); return }
    try {
      const c = await record.mutateAsync({ input: { money_account_id: accountId, counted_at: new Date().toISOString(), denominations, note: note.trim() || null }, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: c.difference === '0.00' ? 'positive' : 'warning', title: c.difference === '0.00' ? 'Cash count matches the book'
        : `Counted ${formatTaka(c.difference, { symbol: true })} ${c.difference.startsWith('-') ? 'short' : 'over'}`,
        description: c.adjustment_number ? `${c.adjustment_number} waits for approval before the book changes.` : `Counted ${formatTaka(c.counted_total, { symbol: true })}.` })
      onDone(c)
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ResponsiveDialog title={`Count cash — ${accountName}`} onClose={onClose} testId="cash-count-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={record.isPending} onClick={() => void save()} data-testid="save-count">Record count</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>How many of each? The total is worked out and compared with the book; any difference waits for approval.</p>
        <ProblemBanner error={error} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
          {NOTES.map((d) => (
            <Field key={d} label={`৳ ${d}`} htmlFor={`cc-${d}`}>
              <Input id={`cc-${d}`} inputMode="numeric" value={counts[d] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, '') }))} aria-label={`Count of ৳ ${d}`} />
            </Field>
          ))}
        </div>
        <Field label="Note" htmlFor="cc-note"><Input id="cc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
      </div>
    </ResponsiveDialog>
  )
}

export function ImportStatementDialog({ accountId, accountName, onClose, onDone }: { accountId: number; accountName: string; onClose: () => void; onDone?: () => void }) {
  const { Button, Banner } = ds()
  const toast = useToast()
  const ref = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<unknown>(null)
  const run = useImportStatement()
  const idem = useIdempotencyKey()
  const go = async () => {
    if (!file) return
    setError(null)
    try {
      const r = await run.mutateAsync({ file, moneyAccountId: accountId, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `${r.line_count} statement line${r.line_count === 1 ? '' : 's'} imported`,
        description: `${r.period_from} to ${r.period_to}${r.duplicates_skipped ? ` · ${r.duplicates_skipped} already imported, skipped` : ''}` })
      onDone?.()
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  const duplicate = error instanceof ApiError && error.code === 'duplicate_statement'
  return (
    <ResponsiveDialog title={`Import a statement — ${accountName}`} onClose={onClose} testId="import-statement-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!file} loading={run.isPending} onClick={() => void go()} data-testid="run-statement-import">Import</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>The bank's CSV or Excel download: a date column, a description, and either an amount or withdrawal and deposit columns.</p>
        {duplicate ? <Banner tone="warning" title="Already imported">{(error as ApiError).problem.detail}</Banner> : <ProblemBanner error={error} />}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" icon="upload" onClick={() => ref.current?.click()}>Choose file</Button>
          <span style={{ color: 'var(--ink-muted)' }}>{file?.name ?? 'No file chosen'}</span>
          <input ref={ref} type="file" accept=".csv,.xlsx,text/csv" hidden data-testid="statement-input" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); e.target.value = '' }} />
        </div>
      </div>
    </ResponsiveDialog>
  )
}

export function StartReconciliationDialog({ accountId, accountName, onClose }: { accountId: number; accountName: string; onClose: () => void }) {
  const { Field, Input, Button } = ds()
  const navigate = useNavigate()
  const [date, setDate] = useState(dhakaToday())
  const [balance, setBalance] = useState('')
  const [error, setError] = useState<unknown>(null)
  const start = useStartReconciliation()
  const go = async () => {
    setError(null)
    try {
      const r = await start.mutateAsync({ money_account_id: accountId, statement_date: date, statement_balance: balance.replace(/,/g, '').trim() })
      navigate(`/banking/reconcile/${r.id}`)
    } catch (e) {
      setError(e)
    }
  }
  const fieldErrors = error instanceof ApiError ? Object.values(error.fieldErrors).flat() : []
  return (
    <ResponsiveDialog title={`Reconcile ${accountName}`} onClose={onClose} testId="start-reconcile-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={start.isPending} disabled={!balance.trim()} onClick={() => void go()}
        data-testid="start-reconcile">Start</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>From your bank statement: its last date and the closing balance on it.</p>
        <ProblemBanner error={error} />
        {fieldErrors.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--negative)', fontSize: 14 }}>{fieldErrors.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        <Field label="Statement date" htmlFor="rec-date"><Input id="rec-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Closing balance on the statement (৳)" htmlFor="rec-balance"><Input id="rec-balance" mono inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} /></Field>
      </div>
    </ResponsiveDialog>
  )
}
