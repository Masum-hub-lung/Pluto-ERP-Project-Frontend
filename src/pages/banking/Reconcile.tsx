import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useReconciliation, useReconciliationAction, type BookEntry } from '../../api/banking'
import type { StatementLine } from '../../api/contract.gen'
import { useLedgerList } from '../../api/accounting'
import { useToast } from '../../app/toast'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { NotFound } from '../../components/states'
import { SummaryTile } from '../../components/SummaryTile'
import { shortDate } from '../purchases/BillList'
import { ImportStatementDialog } from './BankingDialogs'

/**
 * G10 Bank reconciliation (02 #page-g10, 05 #actions-g10; backlog P12.2-FE-06/07; BR-032): the statement lines on the
 * left with what each was matched to or the suggested book entry, the book entries not yet on the statement on the
 * right, and the summary strip (statement, book, handled, difference). Row actions: accept the suggestion or match a
 * book entry, record the missing receipt / payment / bank charge, mark lines as a pair or ignore one, undo. Every
 * action saves at once; Finish is enabled only when the server reports every line handled and a zero difference.
 */
const STATUS: Record<string, { label: string; tone: 'neutral' | 'positive' | 'info' | 'warning' }> = {
  unmatched: { label: 'To match', tone: 'warning' }, matched: { label: 'Matched', tone: 'positive' }, created: { label: 'Entry made', tone: 'positive' },
  paired: { label: 'Paired', tone: 'info' }, ignored: { label: 'Ignored', tone: 'neutral' },
}

export function Reconcile() {
  const { PageHeader, Button, Badge, Card, Segmented, Banner } = ds()
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const toast = useToast()
  const [filter, setFilter] = useState('all')
  const q = useReconciliation(id, filter)
  const act = useReconciliationAction(id)
  const [error, setError] = useState<unknown>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [matching, setMatching] = useState<StatementLine | null>(null)
  const [creating, setCreating] = useState<StatementLine | null>(null)
  const [importing, setImporting] = useState(false)
  const [finishing, setFinishing] = useState(false)

  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this reconciliation" back="/banking" backLabel="Cash and bank" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <PageSkeleton template="detail" />
  const r = q.data
  const open = r.status === 'in_progress'
  const book = r.book_entries ?? []
  const run = async (action: Parameters<typeof act.mutateAsync>[0]['action'], done?: string) => {
    setError(null)
    try {
      await act.mutateAsync({ action, idempotencyKey: crypto.randomUUID() })
      if (done) toast({ tone: 'positive', title: done })
      return true
    } catch (e) {
      setError(e)
      return false
    }
  }
  const zero = /^-?0+(\.0+)?$/.test(r.difference)
  const canFinish = open && (r.unhandled_count ?? 0) === 0 && zero
  const fieldErrors = error instanceof ApiError ? Object.values(error.fieldErrors).flat() : []
  const suggested = r.lines.filter((l) => l.status === 'unmatched' && l.suggestion).length

  return (
    <>
      <PageHeader eyebrow="Cash and bank · Reconciliation" title={r.money_account_name ?? 'Reconciliation'}
        description={`Statement to ${shortDate(r.statement_date)} · closing ${formatTaka(r.statement_balance, { symbol: true })}`}
        actions={open ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" icon="upload" onClick={() => setImporting(true)} data-testid="rec-import">Import statement</Button>
          <Button variant="secondary" icon="check-check" disabled={!suggested} loading={act.isPending} onClick={() => void run({ kind: 'accept-suggestions' }, `${suggested} suggestion${suggested === 1 ? '' : 's'} accepted`)}
            data-testid="accept-all">Accept all suggestions{suggested ? ` (${suggested})` : ''}</Button>
          <Button variant="primary" icon="check" disabled={!canFinish} onClick={() => setFinishing(true)} data-testid="finish-rec">Finish</Button>
        </div> : <Badge tone="positive" dot>Finished</Badge>} />
      <div className="lf-grid" style={{ marginBottom: 16 }} data-testid="rec-summary">
        <SummaryTile label="Statement balance" value={formatTaka(r.statement_balance, { symbol: true })} />
        <SummaryTile label="Book balance" value={formatTaka(r.book_balance, { symbol: true })} sub={`At ${shortDate(r.statement_date)}`} />
        <SummaryTile label="Handled" value={`${r.matched_count} of ${r.line_count}`} testId="rec-handled" />
        <SummaryTile label="Difference" value={formatTaka(r.difference, { symbol: true })} tone={zero ? undefined : 'negative'} testId="rec-difference" />
      </div>
      {!open && <div style={{ marginBottom: 12 }}><Banner tone="positive" title="Reconciled">Every line is handled and the books agree with the statement.</Banner></div>}
      <ProblemBanner error={error} />
      {fieldErrors.length > 0 && <ul style={{ margin: '8px 0 12px', paddingLeft: 18, color: 'var(--negative)', fontSize: 14 }} data-testid="rec-errors">{fieldErrors.map((m, i) => <li key={i}>{m}</li>)}</ul>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <Segmented key={filter} options={[{ value: 'all', label: 'All' }, { value: 'unmatched', label: 'To match' }, { value: 'handled', label: 'Handled' }]} value={filter} onChange={(v: string) => setFilter(v)} />
        {open && selected.length > 0 && (
          <>
            <Button size="sm" variant="secondary" onClick={() => void run({ kind: 'pair', line_ids: selected }, selected.length === 1 ? 'Line ignored' : 'Lines paired').then((ok) => ok && setSelected([]))}
              data-testid="pair-selected">{selected.length === 1 ? 'Ignore line' : `Mark ${selected.length} as a pair`}</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear selection</Button>
          </>
        )}
      </div>

      <div className="lf-grid" style={{ alignItems: 'start' }}>
        <div className="lf-c8" style={{ minWidth: 0 }}>
          <Card title="Statement" padding="none">
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="statement-lines">
              {r.lines.length === 0 && <li style={{ padding: 16, color: 'var(--ink-muted)' }}>No statement lines up to this date. Import the statement first.</li>}
              {r.lines.map((l) => {
                const s = l.suggestion as BookEntry | null | undefined
                const m = l.matched as { voucher_id?: number; voucher_number?: string; paired_with?: number } | null | undefined
                const st = STATUS[l.status] ?? STATUS.unmatched!
                return (
                  <li key={l.id} data-testid={`line-${l.id}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--line)', alignItems: 'start' }}>
                    <input type="checkbox" aria-label={`Select ${l.description}`} disabled={!open || l.status !== 'unmatched'} checked={selected.includes(l.id)} style={{ marginTop: 4 }}
                      onChange={(e) => setSelected((x) => (e.target.checked ? [...x, l.id] : x.filter((i) => i !== l.id)))} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <strong>{l.description}</strong><Badge tone={st.tone} dot>{st.label}</Badge>
                      </div>
                      <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{shortDate(l.txn_date)}{l.bank_reference ? ` · ${l.bank_reference}` : ''}</div>
                      {m?.voucher_number && <div style={{ fontSize: 13 }}>↔ <Link to={`/accounting/vouchers/${m.voucher_id}`} className="lf-code">{m.voucher_number}</Link></div>}
                      {l.status === 'unmatched' && s && <div style={{ fontSize: 13, color: 'var(--ink-muted)' }} data-testid="suggestion">Suggested: <span className="lf-code">{s.voucher_number}</span> {s.particulars} · {shortDate(s.date)}</div>}
                      {open && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                          {l.status === 'unmatched' && s && <Button size="sm" variant="secondary" onClick={() => void run({ kind: 'match', lineId: l.id, journal_line_id: s.journal_line_id }, 'Matched')}
                            data-testid="accept-one">Accept</Button>}
                          {l.status === 'unmatched' && book.length > 0 && <Button size="sm" variant="ghost" onClick={() => setMatching(l)}>Match…</Button>}
                          {l.status === 'unmatched' && <Button size="sm" variant="ghost" onClick={() => setCreating(l)} data-testid="create-entry">
                            {l.amount.startsWith('-') ? 'Record payment or charge' : 'Create receipt'}</Button>}
                          {l.status !== 'unmatched' && <Button size="sm" variant="ghost" onClick={() => void run({ kind: 'undo', lineId: l.id }, 'Undone')} data-testid="undo-line">Undo</Button>}
                        </div>
                      )}
                    </div>
                    <span className="lf-num" style={{ fontWeight: 600, color: l.amount.startsWith('-') ? 'var(--ink)' : 'var(--positive, var(--ink))' }}>
                      {l.amount.startsWith('-') ? `−${formatTaka(l.amount.slice(1))}` : `+${formatTaka(l.amount)}`}</span>
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>
        <aside className="lf-c4">
          <Card title="In the books, not on the statement" padding="none">
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="book-entries">
              {book.length === 0 && <li style={{ padding: 16, color: 'var(--ink-muted)' }}>Every book entry is on the statement.</li>}
              {book.map((b) => (
                <li key={b.journal_line_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
                  <span><span className="lf-code">{b.voucher_number}</span> {b.particulars}<br /><span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{shortDate(b.date)}{b.reference ? ` · ${b.reference}` : ''}</span></span>
                  <span className="lf-num">{formatTaka(b.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>

      {matching && (
        <ResponsiveDialog title={`Match ${matching.description}`} onClose={() => setMatching(null)} testId="match-dialog">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {book.filter((b) => b.amount === matching.amount).length === 0 && <li style={{ color: 'var(--ink-muted)' }}>No book entry of {formatTaka(matching.amount)}. Record the entry instead.</li>}
            {book.filter((b) => b.amount === matching.amount).map((b) => (
              <li key={b.journal_line_id}><Button variant="secondary" block onClick={() => void run({ kind: 'match', lineId: matching.id, journal_line_id: b.journal_line_id }, 'Matched').then(() => setMatching(null))}>
                {b.voucher_number} · {b.particulars} · {shortDate(b.date)}</Button></li>
            ))}
          </ul>
        </ResponsiveDialog>
      )}
      {creating && <CreateEntryDialog line={creating} onClose={() => setCreating(null)}
        onSubmit={async (body) => { const ok = await run({ kind: 'create-entry', lineId: creating.id, body }, 'Entry recorded and matched'); if (ok) setCreating(null) }} />}
      {importing && r.money_account_id && <ImportStatementDialog accountId={r.money_account_id} accountName={r.money_account_name ?? ''} onClose={() => setImporting(false)} onDone={() => void q.refetch()} />}
      {finishing && (
        <ConfirmDialog title="Finish the reconciliation?" confirmLabel="Finish" tone="info" loading={act.isPending} onClose={() => setFinishing(false)}
          description={`${r.money_account_name} is reconciled to ${shortDate(r.statement_date)}. Its lines cannot be changed afterwards.`}
          onConfirm={() => void run({ kind: 'finish' }, 'Reconciliation finished').then((ok) => { setFinishing(false); if (ok) navigate(`/banking/accounts/${r.money_account_id}`) })} />
      )}
    </>
  )
}

/** Record the missing entry for a statement line: a receipt (money in), or a payment or bank charge (money out). */
function CreateEntryDialog({ line, onClose, onSubmit }: { line: StatementLine; onClose: () => void; onSubmit: (b: { kind: 'receipt' | 'bank_charge' | 'payment'; ledger_id: number; narration?: string | null }) => Promise<void> }) {
  const { Field, Select, Input, Button, Segmented } = ds()
  const out = line.amount.startsWith('-')
  const [kind, setKind] = useState<'receipt' | 'bank_charge' | 'payment'>(out ? 'bank_charge' : 'receipt')
  const ledgers = useLedgerList({ per_page: 100, active: 'true', nature: out ? 'expense' : undefined })
  const list = (ledgers.data?.data ?? []) as { id: number; code: string; name: string }[]
  const charges = list.find((l) => l.code === '6702')
  const [ledger, setLedger] = useState('')
  const [narration, setNarration] = useState(line.description)
  const [busy, setBusy] = useState(false)
  const chosen = ledger || (kind === 'bank_charge' && charges ? String(charges.id) : '')
  return (
    <ResponsiveDialog title={out ? 'Record the payment or charge' : 'Create the receipt'} onClose={onClose} testId="create-entry-dialog"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!chosen} data-testid="confirm-create-entry"
          onClick={() => { setBusy(true); void onSubmit({ kind, ledger_id: Number(chosen), narration: narration.trim() || null }).finally(() => setBusy(false)) }}>Post and match</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>{formatTaka(line.amount.replace('-', ''), { symbol: true })} on {shortDate(line.txn_date)} — {line.description}</p>
        {out && <Field label="What is it"><Segmented key={kind} options={[{ value: 'bank_charge', label: 'Bank charge' }, { value: 'payment', label: 'Other payment' }]}
          value={kind} onChange={(v: string) => { setKind(v as 'bank_charge' | 'payment'); setLedger('') }} /></Field>}
        <Field label={out ? 'Charge to' : 'Received for'} htmlFor="ce-ledger">
          <Select key={list.length} id="ce-ledger" value={chosen} onChange={(e) => setLedger(e.target.value)}
            options={[{ value: '', label: 'Choose a ledger…' }, ...list.map((l) => ({ value: String(l.id), label: `${l.code} ${l.name}` }))]} />
        </Field>
        <Field label="Narration" htmlFor="ce-narration"><Input id="ce-narration" value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
      </div>
    </ResponsiveDialog>
  )
}
