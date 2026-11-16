import { useState } from 'react'
import { ApiError } from '../../api/client'
import type { Party, PaymentReminder } from '../../api/contract.gen'
import { usePaymentReminders, useSendPaymentReminder } from '../../api/partyAccounts'
import { useToast } from '../../app/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'

/**
 * PEP-516 payment reminders on B4: "Send payment reminder" (confirm → the API e-mails the overdue invoices with the
 * statement attached; at most one a week) and the "Reminders sent" card. Which invoices are overdue, the amount and the
 * weekly limit are the API's; the page only shows them.
 */
export function reminderLine(r: PaymentReminder): string {
  const when = new Date(r.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' })
  const who = r.trigger === 'auto' ? 'automatic' : r.sent_by ? `by ${r.sent_by.name}` : 'by hand'
  return `${when} · ${who} · ${r.invoices_count} invoice${r.invoices_count === 1 ? '' : 's'}`
}

export function useReminderAction(p: Party | undefined) {
  const [open, setOpen] = useState(false)
  const send = useSendPaymentReminder(p?.id ?? 0)
  const idem = useIdempotencyKey()
  const toast = useToast()
  const dialog = open && p ? (
    p.email ? (
      <ConfirmDialog title="Send a payment reminder?" tone="info" confirmLabel="Send reminder" loading={send.isPending} onClose={() => setOpen(false)}
        description={`Pluto e-mails ${p.email} a polite list of ${p.name}'s overdue invoices, with their statement attached.`}
        onConfirm={async () => {
          try {
            const r = await send.mutateAsync({ idempotencyKey: idem.key })
            idem.reset()
            setOpen(false)
            toast({ tone: 'positive', title: 'Reminder sent', description: `${r.invoices_count} overdue invoice${r.invoices_count === 1 ? '' : 's'}, ${formatTaka(r.overdue_amount, { symbol: true })}, to ${r.email}.` })
          } catch (e) {
            setOpen(false)
            toast({ tone: e instanceof ApiError && e.code === 'reminder_sent_recently' ? 'info' : 'negative', title: 'Reminder not sent',
              description: e instanceof Error ? e.message : 'Try again in a moment.' })
          }
        }}>
        <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 14 }}>Customers get at most one reminder a week.</p>
      </ConfirmDialog>
    ) : (
      <ConfirmDialog title="Add an e-mail address first" tone="info" confirmLabel="OK" onConfirm={() => setOpen(false)} onClose={() => setOpen(false)}
        description={`${p.name} has no e-mail address. Edit the customer to add one, then send the reminder.`} />
    )
  ) : null
  return { start: () => setOpen(true), dialog }
}

export function RemindersCard({ partyId }: { partyId: number }) {
  const q = usePaymentReminders(partyId)
  const rows = q.data?.data ?? []
  if (!rows.length) return null
  return (
    <section className="lf-c4" data-testid="reminders-card"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-1)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ margin: 0, font: '650 16px/24px var(--font-sans)' }}>Reminders sent</h2>
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
          <span style={{ color: 'var(--ink-muted)' }}>{reminderLine(r)}</span>
          <span className="lf-num" style={{ fontWeight: 600, textAlign: 'right' }}>{formatTaka(r.overdue_amount, { symbol: true })}</span>
        </div>
      ))}
    </section>
  )
}
