import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Allocation } from '../../api/contract.gen'
import { useCreateAllocation, useDeleteAllocation, useOpenDocuments } from '../../api/receipts'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds, type DataColumn } from '../../ds'
import { formatTaka } from '../../lib/format'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ConfirmDialog } from '../ConfirmDialog'
import { ProblemBanner } from '../ProblemBanner'
import { ResponsiveDialog } from '../ResponsiveDialog'

/**
 * Payments tab of an invoice (E5) or bill (F4) (backlog P6.2-FE-05; R-08): the receipts, payments, notes and advances
 * applied to it, each removable (DELETE /allocations), "Apply advance or credit" from the party's unapplied credits
 * (POST /allocations), and "Record payment" (E7 for an invoice, F5 for a bill, prefilled). Amounts and balances are the server's;
 * a wrong amount comes back as allocation_exceeds_balance and is shown in the dialog.
 */
const KIND: Record<string, string> = { receipt: 'Receipt', payment: 'Payment', credit_note: 'Credit note', debit_note: 'Debit note', advance: 'Advance' }

export function PaymentsPanel({ type, id, number, partyId, status, balance, allocations }: {
  type: 'sales_invoice' | 'purchase_bill'; id: number; number: string; partyId: number; status: string; balance: string; allocations: Allocation[]
}) {
  const { Card, DataTable, Button, Badge, EmptyState } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const remove = useDeleteAllocation()
  const [removing, setRemoving] = useState<Allocation | null>(null)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const sales = type === 'sales_invoice'
  const canApply = status === 'posted' && balance !== '0.00' && can(sales ? 'sales.create' : 'purchases.create')
  const canRemove = can(sales ? 'sales.edit' : 'purchases.edit')

  async function doRemove() {
    if (!removing) return
    setError(null)
    try {
      await remove.mutateAsync(removing.id)
      toast({ tone: 'positive', title: 'Allocation removed', description: `${formatTaka(removing.amount, { symbol: true })} of ${removing.voucher_number} is free again.` })
      setRemoving(null)
    } catch (e) {
      setRemoving(null)
      setError(e)
    }
  }

  const cols: DataColumn[] = [
    { key: 'voucher', label: 'Voucher', mono: true, render: (_v, r) => (r.kind === 'receipt' ? <Link to={`/sales/payments/${r.voucherId}`}>{r.voucher}</Link>
      : r.kind === 'payment' ? <Link to={`/purchases/payments/${r.voucherId}`}>{r.voucher}</Link> : <span className="lf-code">{r.voucher}</span>) },
    { key: 'kindLabel', label: 'Kind' },
    { key: 'date', label: 'Applied on' },
    { key: 'amount', label: 'Amount (৳)', type: 'amount' },
    { key: 'state', label: '', render: (_v, r) => (r.reversed ? <Badge tone="neutral">Removed</Badge>
      : canRemove ? <Button size="sm" variant="ghost" icon="x" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setRemoving(r.a) }} data-testid={`remove-allocation-${r.id}`}>Remove</Button> : null) },
  ]
  const rows = allocations.map((a) => ({ id: a.id, a, voucher: a.voucher_number, voucherId: a.voucher_id, kind: a.kind, kindLabel: KIND[a.kind] ?? a.kind, date: a.date, amount: a.amount, reversed: a.reversed }))

  return (
    <Card title="Payments" subtitle={status === 'posted' ? `Open balance ${formatTaka(balance, { symbol: true })}` : undefined} padding="none"
      actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canApply && <Button size="sm" variant="secondary" icon="hand-coins" onClick={() => setApplying(true)} data-testid="apply-credit">Apply advance or credit</Button>}
        {canApply && <Button size="sm" variant="primary" icon="plus" data-testid="record-payment"
          onClick={() => navigate(sales ? `/sales/payments/new?party_id=${partyId}&invoice_id=${id}` : `/purchases/payments/new?party_id=${partyId}&bill_id=${id}`)}>Record payment</Button>}
      </div>}>
      <div style={{ padding: error ? '12px 20px 0' : 0 }}><ProblemBanner error={error} /></div>
      {rows.length
        ? <div style={{ overflowX: 'auto' }} data-testid="payments-table"><DataTable caption="Payments" columns={cols} rows={rows} /></div>
        : <div style={{ padding: 16 }}><EmptyState icon="hand-coins" title="Nothing paid yet" description={status === 'posted' ? 'Record a payment or apply an advance the party already paid.' : 'Payments can be applied once it is posted.'} /></div>}
      {removing && (
        <ConfirmDialog title={`Remove ${removing.voucher_number} from ${number}?`} confirmLabel="Remove" tone="warning" loading={remove.isPending}
          description={`${formatTaka(removing.amount, { symbol: true })} goes back to the ${KIND[removing.kind]?.toLowerCase() ?? 'payment'} as unapplied, and ${number} is open for it again.`}
          onConfirm={() => void doRemove()} onClose={() => setRemoving(null)} />
      )}
      {applying && <ApplyDialog type={type} id={id} number={number} partyId={partyId} balance={balance} onClose={() => setApplying(false)} />}
    </Card>
  )
}

/** Choose one of the party's unapplied credits and the amount to apply (R-08). */
function ApplyDialog({ type, id, number, partyId, balance, onClose }: { type: 'sales_invoice' | 'purchase_bill'; id: number; number: string; partyId: number; balance: string; onClose: () => void }) {
  const { Button, Field, Input, Select } = ds()
  const toast = useToast()
  const open = useOpenDocuments(partyId)
  const create = useCreateAllocation()
  const idem = useIdempotencyKey()
  const [lineId, setLineId] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<unknown>(null)
  const credits = open.data?.credits ?? []
  const credit = credits.find((c) => String(c.journal_line_id) === lineId)

  async function apply() {
    setError(null)
    try {
      await create.mutateAsync({ input: { journal_line_id: Number(lineId), document_type: type, document_id: id, amount: amount.trim() }, idempotencyKey: idem.key })
      idem.reset()
      toast({ tone: 'positive', title: `Applied to ${number}`, description: `${formatTaka(amount.trim(), { symbol: true })} of ${credit?.number}` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <ResponsiveDialog title={`Apply an advance or credit to ${number}`} tone="info" width={520} onClose={onClose} testId="apply-dialog"
      description={`Open balance ${formatTaka(balance, { symbol: true })}. The amount can be at most the balance and what is left on the credit.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="check" loading={create.isPending} disabled={!lineId || !amount.trim() || create.isPending} onClick={() => void apply()} data-testid="confirm-apply">Apply</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {open.data && credits.length === 0 && <p style={{ margin: 0, color: 'var(--ink-muted)' }}>This party has no unapplied payments, advances or credits.</p>}
        {credits.length > 0 && <>
          <Field label="Credit to apply" htmlFor="apply-credit">
            <Select id="apply-credit" value={lineId} onChange={(e) => setLineId(e.target.value)}
              options={[{ value: '', label: 'Choose…' }, ...credits.map((c) => ({ value: String(c.journal_line_id), label: `${c.number} · ${KIND[c.kind] ?? c.kind} · ${formatTaka(c.unapplied, { symbol: true })} left` }))]} />
          </Field>
          <Field label="Amount (৳)" hint={credit ? `Up to ${formatTaka(credit.unapplied, { symbol: true })} on this credit and ${formatTaka(balance, { symbol: true })} on ${number}` : undefined} htmlFor="apply-amount">
            <Input id="apply-amount" mono align="right" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </>}
        <ProblemBanner error={error} />
      </div>
    </ResponsiveDialog>
  )
}
