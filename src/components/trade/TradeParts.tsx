import { useState, type ReactNode } from 'react'
import { ds } from '../../ds'
import { ConfirmDialog } from '../ConfirmDialog'
import { ProblemBanner } from '../ProblemBanner'

/**
 * Small shared parts of the trade documents (backlog P10 frontend): the status badge of a quotation, order, return or
 * note; the e-mail dialog (EmailRequest: an empty list means the party's e-mail on file); and the reason dialog used to
 * cancel or change a status. The dialogs keep the server's error inside them so the user can correct and retry.
 */
const TONES: Record<string, 'neutral' | 'info' | 'positive' | 'warning' | 'negative' | 'accent'> = {
  draft: 'neutral', sent: 'info', accepted: 'positive', declined: 'negative', expired: 'warning', converted: 'accent',
  partly_received: 'warning', received: 'positive', closed: 'neutral', cancelled: 'negative', posted: 'positive', dispatched: 'info', reversed: 'warning',
}

export const statusLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')

export function DocStatusBadge({ status }: { status: string }) {
  const { Badge } = ds()
  return <Badge tone={TONES[status] ?? 'neutral'} dot>{statusLabel(status)}</Badge>
}

/** E-mail a document with its PDF: recipients separated by commas; empty = the party's e-mail on file. */
export function SendDialog({ title, party, loading, onSend, onClose }: {
  title: string; party: string; loading: boolean; onSend: (to: string[], message: string) => Promise<unknown>; onClose: () => void
}) {
  const { Field, Input } = ds()
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<unknown>(null)
  const send = async () => {
    setError(null)
    try {
      await onSend(to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean), message)
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ConfirmDialog title={title} confirmLabel="Send" tone="info" loading={loading} onConfirm={() => void send()} onClose={onClose}
      description={`The PDF is attached. Leave "To" empty to use ${party}'s e-mail on file.`}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error} />
        <Field label="To" hint="Separate addresses with commas" htmlFor="send-to"><Input id="send-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Message" htmlFor="send-msg"><Input id="send-msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional" /></Field>
      </div>
    </ConfirmDialog>
  )
}

/** Asks for a reason (kept in the audit log) before cancelling or changing a status. */
export function ReasonDialog({ title, description, confirmLabel, required = true, loading, onConfirm, onClose, children }: {
  title: string; description: string; confirmLabel: string; required?: boolean; loading: boolean
  onConfirm: (reason: string) => Promise<unknown>; onClose: () => void; children?: ReactNode
}) {
  const { Field, Input } = ds()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [missing, setMissing] = useState(false)
  const confirm = async () => {
    if (required && !reason.trim()) { setMissing(true); return }
    setError(null)
    try {
      await onConfirm(reason.trim())
    } catch (e) {
      setError(e)
    }
  }
  return (
    <ConfirmDialog title={title} description={description} confirmLabel={confirmLabel} tone="warning" loading={loading} onConfirm={() => void confirm()} onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <ProblemBanner error={error} />
        {children}
        <Field label="Reason" error={missing ? 'Give the reason; it is kept in the audit log' : undefined} htmlFor="reason-input">
          <Input id="reason-input" value={reason} onChange={(e) => { setReason(e.target.value); setMissing(false) }} invalid={missing} placeholder={required ? undefined : 'Optional'} />
        </Field>
      </div>
    </ConfirmDialog>
  )
}

/** A row of document actions under the header (wraps on phones). */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 16px' }} data-testid="doc-actions">{children}</div>
}
