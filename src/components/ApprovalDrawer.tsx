import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'
import { factsOf, useApproval, useDecideApproval } from '../api/approvals'
import { useToast } from '../app/toast'
import { useSession } from '../auth/session'
import { ds } from '../ds'
import { formatTaka } from '../lib/format'
import { useIdempotencyKey } from '../lib/useIdempotencyKey'
import { ProblemBanner } from './ProblemBanner'
import { ResponsiveDialog } from './ResponsiveDialog'

/**
 * L4 approval drawer (05 approvals; BR-007, BR-008; backlog P7.2-FE-08): the request's voucher, amount against the
 * requester's limit and its lines; Approve posts it, Reject needs a comment and sends it back. The requester sees the
 * request but cannot decide it, nor can anyone without its permission (the server checks both again).
 */
export function ApprovalDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { Button, Badge, Skeleton, Field } = ds()
  const { me, can } = useSession()
  const toast = useToast()
  const q = useApproval(id)
  const decide = useDecideApproval()
  const idem = useIdempotencyKey()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<unknown>(null)
  const a = q.data
  const facts = a ? factsOf(a) : null
  const mine = a && me ? a.requested_by.id === me.id : false
  const allowed = a ? can(a.required_permission) && !mine && a.status === 'pending' : false
  const commentError = error instanceof ApiError && error.code === 'comment_required' ? error.fieldErrors.comment?.[0] ?? 'Say why it is rejected' : undefined

  const act = async (decision: 'approve' | 'reject') => {
    setError(null)
    try {
      const r = await decide.mutateAsync({ id, decision, comment: comment.trim() || undefined, idempotencyKey: decision === 'approve' ? idem.key : undefined })
      idem.reset()
      toast(decision === 'approve' ? { tone: 'positive', title: `${r.document_number} approved and posted` } : { tone: 'info', title: `${r.document_number} rejected`, description: 'The author was told why.' })
      onClose()
    } catch (e) { setError(e) }
  }

  return (
    <ResponsiveDialog title={a ? `Approve ${a.document_number}?` : 'Approval'} onClose={onClose} width={560} testId="approval-drawer"
      footer={allowed ? <>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="danger" disabled={decide.isPending} onClick={() => void act('reject')} data-testid="reject">Reject</Button>
        <Button variant="primary" icon="check" loading={decide.isPending} onClick={() => void act('approve')} data-testid="approve">Approve and post</Button>
      </> : <Button variant="secondary" onClick={onClose}>Close</Button>}>
      {!a ? (q.error ? <ProblemBanner error={q.error} onRetry={() => void q.refetch()} /> : <Skeleton height={160} />) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!commentError && <ProblemBanner error={error} />}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Badge tone={a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'positive' : 'negative'} dot>{a.status === 'pending' ? 'Waiting' : a.status}</Badge>
            <Link to={`/accounting/vouchers/${a.document_id}`} onClick={onClose}>{a.document_number}</Link>
            <span style={{ color: 'var(--ink-muted)' }}>by {a.requested_by.name}</span>
          </div>
          <div className="lf-num" style={{ font: '500 24px/30px var(--font-serif)' }} data-testid="approval-amount">৳ {formatTaka(a.amount)}</div>
          {a.limit && <span style={{ color: 'var(--ink-muted)' }}>Above {a.requested_by.name}'s limit of ৳ {formatTaka(a.limit)}</span>}
          {facts?.narration && <p style={{ margin: 0 }}>{facts.narration}</p>}
          {facts && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--ink-muted)', fontSize: 12 }}><th>Ledger</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th></tr></thead>
              <tbody>{facts.lines.map((l, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '6px 0' }}>{l.ledger}</td>
                  <td className="lf-num" style={{ textAlign: 'right' }}>{l.debit !== '0.00' ? formatTaka(l.debit) : ''}</td>
                  <td className="lf-num" style={{ textAlign: 'right' }}>{l.credit !== '0.00' ? formatTaka(l.credit) : ''}</td>
                </tr>))}</tbody>
            </table>
          )}
          {a.comment && <p style={{ margin: 0 }}><strong>Comment:</strong> {a.comment}</p>}
          {mine && a.status === 'pending' && <p style={{ margin: 0, color: 'var(--ink-muted)' }}>You submitted this voucher; another approver decides it.</p>}
          {allowed && (
            <Field label="Comment" hint="Required to reject" error={commentError} htmlFor="ap-comment">
              <textarea id="ap-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={500}
                style={{ width: '100%', font: 'inherit', fontSize: 16, padding: 8, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--ink)' }} />
            </Field>
          )}
        </div>
      )}
    </ResponsiveDialog>
  )
}
