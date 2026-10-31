import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { Voucher, VoucherInput, VoucherPreview } from '../../api/contract.gen'
import { calculateVoucher, useCreateVoucher, useReplaceVoucher, useVoucherTemplates } from '../../api/accounting'
import { useMoneyAccounts } from '../../api/money'
import { METHODS } from '../../api/receipts'
import { useToast } from '../../app/toast'
import { ds } from '../../ds'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { useUnsavedChangesBlocker } from '../../lib/useUnsavedChangesBlocker'
import { differenceLine, isComplete, newLine, readyToCalculate, toVoucherInput, type VoucherFormState, type VoucherLineState } from '../../lib/voucherForm'
import { useCalculate } from '../document/useCalculate'
import { ConfirmDialog } from '../ConfirmDialog'
import { ConflictBanner } from '../ConflictBanner'
import { ProblemBanner } from '../ProblemBanner'
import { BalanceStatus } from './BalanceStatus'
import { VoucherLedgerPicker } from './VoucherLedgerPicker'

/**
 * Voucher editor (H9 journal, H10 payment, H11 receipt, H12 contra; 08 §7; backlog P7.2-FE-05/06). The lines are
 * typed here; the balance, the posting preview and the warnings come from POST /vouchers/calculate 300 ms after each
 * change. Save draft keeps it unposted; Post is disabled while out of balance, and becomes "Submit for approval" when
 * the server says the amount is above the user's limit (202, BR-007). Back-dated vouchers ask for confirmation
 * (BR-053); a locked period, missing funds or an unbalanced entry stay on the page with the server's message.
 */
const TITLES = { journal: 'Journal voucher', payment: 'Payment voucher', receipt: 'Receipt voucher', contra: 'Contra voucher' } as const
const HINTS = {
  journal: 'Adjustments with no cash: debits and credits must balance.',
  payment: 'Money out of a cash or bank account to one or more ledgers.',
  receipt: 'Money into a cash or bank account from one or more ledgers.',
  contra: 'Money moved between your own cash and bank accounts.',
} as const

/** `heading`: the page's own title when a cash and bank page (G6–G9) uses the editor. */
export function VoucherEditor({ initial, voucher, heading }: { initial: VoucherFormState; voucher?: Voucher; heading?: { eyebrow: string; title: string; description: string } }) {
  const { PageHeader, Card, Field, Input, Select, Button, IconButton, Banner } = ds()
  const navigate = useNavigate()
  const toast = useToast()
  const [s, setS] = useState<VoucherFormState>(initial)
  const [error, setError] = useState<unknown>(null)
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({})
  const [backdated, setBackdated] = useState<null | VoucherInput['action']>(null)
  const create = useCreateVoucher()
  const replace = useReplaceVoucher(voucher?.id ?? 0)
  const idem = useIdempotencyKey()
  const templates = useVoucherTemplates()
  const accounts = useMoneyAccounts(s.type === 'receipt' ? { purpose: 'receipts' } : s.type === 'payment' ? { purpose: 'payments' } : {})
  const dirty = JSON.stringify(s) !== JSON.stringify(initial)
  const guard = useUnsavedChangesBlocker(dirty, 'This voucher is not saved.')
  const input = readyToCalculate(s) ? toVoucherInput(s, 'post') : null
  const calc = useCalculate<VoucherInput, VoucherPreview>(input, calculateVoucher)
  const busy = create.isPending || replace.isPending
  const type = s.type
  const needsApproval = !!calc.result?.needs_approval
  const canPost = !!calc.result?.balanced && !calc.pending
  const fe = error instanceof ApiError && error.status === 422 ? error.fieldErrors : {}
  const conflict = error instanceof ApiError && error.status === 409 && error.code === 'version_conflict'

  const patch = (p: Partial<VoucherFormState>) => setS((x) => ({ ...x, ...p }))
  const pay = (p: Partial<VoucherFormState['payment']>) => setS((x) => ({ ...x, payment: { ...x.payment, ...p } }))
  const line = (key: string, p: Partial<VoucherLineState>) => setS((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }))
  const remove = (key: string) => setS((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((l) => l.key !== key) : x.lines }))
  const add = () => setS((x) => ({ ...x, lines: [...x.lines, newLine()] }))
  const putDifference = () => { const d = differenceLine(calc.result); if (d) setS((x) => ({ ...x, lines: [...x.lines, d] })) }
  const applyTemplate = (key: string) => {
    const t = templates.data?.find((x) => x.key === key)
    patch({ template_key: key, ...(t && t.lines.length ? { narration: s.narration || t.description, lines: t.lines.map((l) => newLine({ ledgerId: l.ledger_id, ledgerLabel: `${l.ledger_code} · ${l.ledger_name}` })) } : {}) })
  }

  /** 422 `lines.N.*` from the server count only the complete lines that were sent; map them back to the rows. */
  const placeLineErrors = (e: ApiError) => {
    const sent = s.lines.filter((l) => isComplete(type, l))
    const out: Record<string, string> = {}
    for (const [path, msgs] of Object.entries(e.fieldErrors)) {
      const m = /^lines\.(\d+)\./.exec(path)
      if (m && sent[Number(m[1])]) out[sent[Number(m[1])].key] = msgs[0]
    }
    setLineErrors(out)
  }

  const save = async (action: VoucherInput['action'], confirm = false) => {
    setError(null); setLineErrors({})
    const body = toVoucherInput(s, action, confirm)
    try {
      const r = voucher ? await replace.mutateAsync({ input: body, version: voucher.version }) : await create.mutateAsync({ input: body, idempotencyKey: idem.key })
      idem.reset()
      const v = r.voucher
      toast(v.status === 'posted' ? { tone: 'positive', title: `${v.voucher_number} posted`, description: `৳ ${v.total_debit}` }
        : v.status === 'submitted' ? { tone: 'info', title: `${v.voucher_number} sent for approval`, description: 'It posts when an approver accepts it.' }
          : { tone: 'positive', title: `${v.voucher_number} saved as draft` })
      guard.allowNavigation()
      navigate(`/accounting/vouchers/${v.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'backdated_confirmation_required') { idem.reset(); setBackdated(action); return }
      if (e instanceof ApiError && e.status === 422) placeLineErrors(e)
      setError(e)
    }
  }

  const lineGrid = type === 'journal' ? 'minmax(220px, 2fr) minmax(140px, 1.2fr) 130px 130px 40px' : 'minmax(220px, 2fr) minmax(120px, 1fr) minmax(140px, 1.2fr) 140px 40px'
  const accountOptions = useMemo(() => (accounts.data ?? []).filter((a) => a.is_active).map((a) => ({ value: String(a.id), label: a.name })), [accounts.data])

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate data-testid="voucher-editor">
      <PageHeader eyebrow={voucher ? `Edit ${voucher.voucher_number}` : heading?.eyebrow ?? 'New voucher'} title={heading?.title ?? TITLES[type]} description={heading?.description ?? HINTS[type]} />
      {conflict ? <ConflictBanner onReload={() => window.location.reload()} /> : <ProblemBanner error={error} />}
      {voucher?.status === 'rejected' && voucher.approval?.comment && <Banner tone="warning" title="Rejected">{voucher.approval.comment}</Banner>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
        <Card title="Voucher">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <Field label="Date" required error={fe.date?.[0]} htmlFor="v-date"><Input id="v-date" type="date" value={s.date} onChange={(e) => patch({ date: e.target.value })} /></Field>
            <Field label="Reference" error={fe.reference?.[0]} htmlFor="v-ref"><Input id="v-ref" value={s.reference} onChange={(e) => patch({ reference: e.target.value })} /></Field>
            {type === 'journal' && (
              <Field label="Template" htmlFor="v-tpl">
                <Select id="v-tpl" value={s.template_key} onChange={(e) => applyTemplate(e.target.value)}
                  options={[{ value: '', label: 'Blank journal' }, ...(templates.data ?? []).map((t) => ({ value: t.key, label: t.name }))]} />
              </Field>
            )}
            {type !== 'journal' && <>
              <Field label={type === 'receipt' ? 'Received into' : type === 'contra' ? 'Move from' : 'Paid from'} required error={fe['payment.money_account_id']?.[0] ?? fe.payment?.[0]} htmlFor="v-acc">
                <Select id="v-acc" value={s.payment.money_account_id} onChange={(e) => pay({ money_account_id: e.target.value })}
                  options={[{ value: '', label: 'Choose the account' }, ...accountOptions]} />
              </Field>
              <Field label="Method" htmlFor="v-method">
                <Select id="v-method" value={s.payment.method} onChange={(e) => pay({ method: e.target.value as VoucherFormState['payment']['method'] })} options={METHODS} />
              </Field>
              {s.payment.method === 'cheque' && <>
                <Field label="Cheque no." htmlFor="v-chq"><Input id="v-chq" mono value={s.payment.cheque_number} onChange={(e) => pay({ cheque_number: e.target.value })} /></Field>
                <Field label="Cheque date" htmlFor="v-chqd"><Input id="v-chqd" type="date" value={s.payment.cheque_date} onChange={(e) => pay({ cheque_date: e.target.value })} /></Field>
              </>}
              {s.payment.method !== 'cash' && s.payment.method !== 'cheque' && (
                <Field label="Transaction ref." htmlFor="v-tx"><Input id="v-tx" value={s.payment.transaction_reference} onChange={(e) => pay({ transaction_reference: e.target.value })} /></Field>
              )}
              {type === 'payment' && <Field label="Paid to (if not a ledger)" htmlFor="v-payee"><Input id="v-payee" value={s.payment.payee_text} onChange={(e) => pay({ payee_text: e.target.value })} /></Field>}
              {s.payment.method !== 'cash' && (
                <Field label="Bank charge (৳)" error={fe['payment.bank_charge']?.[0]} htmlFor="v-charge">
                  <Input id="v-charge" mono align="right" inputMode="decimal" placeholder="0.00" value={s.payment.bank_charge} onChange={(e) => pay({ bank_charge: e.target.value })} />
                </Field>
              )}
            </>}
          </div>
        </Card>

        <Card title={type === 'contra' ? 'Move to' : 'Lines'} padding="none"
          actions={type === 'journal' && calc.result && !calc.result.balanced
            ? <Button variant="ghost" size="sm" icon="scale" onClick={putDifference} data-testid="put-difference">Put difference on last line</Button> : undefined}>
          <div style={{ overflowX: 'auto' }}>
            <div role="table" aria-label="Voucher lines" style={{ minWidth: 640 }}>
              <div role="row" style={{ display: 'grid', gridTemplateColumns: lineGrid, gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--line)', font: '600 12px/16px var(--font-sans)', color: 'var(--ink-muted)' }}>
                <span role="columnheader">{type === 'contra' ? 'Account' : 'Ledger'}</span>
                {type !== 'journal' && <span role="columnheader">Against</span>}
                <span role="columnheader">Line narration</span>
                {type === 'journal' ? <><span role="columnheader" style={{ textAlign: 'right' }}>Debit (৳)</span><span role="columnheader" style={{ textAlign: 'right' }}>Credit (৳)</span></>
                  : <span role="columnheader" style={{ textAlign: 'right' }}>Amount (৳)</span>}
                <span />
              </div>
              {s.lines.map((l, i) => (
                <div key={l.key} role="row" data-testid={`vline-${i}`} style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: lineGrid, gap: 8, alignItems: 'start' }}>
                    {type === 'contra'
                      ? <Select aria-label={`Account, line ${i + 1}`} value={String(accounts.data?.find((a) => a.ledger_id === l.ledgerId)?.id ?? '')}
                          onChange={(e) => { const a = accounts.data?.find((x) => String(x.id) === e.target.value); line(l.key, { ledgerId: a?.ledger_id ?? null, ledgerLabel: a?.name ?? '' }); pay({ counter_money_account_id: e.target.value }) }}
                          options={[{ value: '', label: 'Choose the account' }, ...accountOptions.filter((a) => a.value !== s.payment.money_account_id)]} />
                      : <VoucherLedgerPicker aria-label={`Ledger, line ${i + 1}`} value={l.ledgerId ? { id: l.ledgerId, label: l.ledgerLabel } : null}
                          onChange={(x) => line(l.key, { ledgerId: x?.id ?? null, ledgerLabel: x?.label ?? '' })} invalid={!!lineErrors[l.key]} />}
                    {type !== 'journal' && <Input aria-label={`Against, line ${i + 1}`} value={l.against_reference} placeholder="Bill or invoice no." onChange={(e) => line(l.key, { against_reference: e.target.value })} />}
                    <Input aria-label={`Narration, line ${i + 1}`} value={l.line_narration} onChange={(e) => line(l.key, { line_narration: e.target.value })} />
                    {type === 'journal' ? <>
                      <Input aria-label={`Debit, line ${i + 1}`} mono align="right" inputMode="decimal" value={l.debit} onChange={(e) => line(l.key, { debit: e.target.value, ...(e.target.value ? { credit: '' } : {}) })} />
                      <Input aria-label={`Credit, line ${i + 1}`} mono align="right" inputMode="decimal" value={l.credit} onChange={(e) => line(l.key, { credit: e.target.value, ...(e.target.value ? { debit: '' } : {}) })} />
                    </> : <Input aria-label={`Amount, line ${i + 1}`} mono align="right" inputMode="decimal" value={l.amount} onChange={(e) => line(l.key, { amount: e.target.value })} />}
                    <IconButton icon="trash-2" label={`Remove line ${i + 1}`} onClick={() => remove(l.key)} />
                  </div>
                  {lineErrors[l.key] && <div role="alert" style={{ color: 'var(--negative)', fontSize: 13, marginTop: 4 }}>{lineErrors[l.key]}</div>}
                </div>
              ))}
              <div style={{ padding: '8px 16px' }}><Button variant="ghost" size="sm" icon="plus" onClick={add} data-testid="add-line">Add line</Button></div>
            </div>
          </div>
          {fe.lines?.[0] && <div role="alert" style={{ color: 'var(--negative)', padding: '0 16px 12px' }}>{fe.lines[0]}</div>}
        </Card>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: '2 1 360px' }}>
            <Card title="Narration">
              <textarea aria-label="Narration" value={s.narration} onChange={(e) => patch({ narration: e.target.value })} rows={3} maxLength={1000}
                style={{ width: '100%', font: 'inherit', fontSize: 16, padding: 8, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--ink)' }} />
            </Card>
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <Card title="Balance"><BalanceStatus {...calc} /></Card>
            {calc.result && type !== 'journal' && calc.result.lines.length > 0 && (
              <Card title="Will post" padding="none">
                <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="posting-preview">
                  <tbody>{calc.result.lines.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '6px 12px' }}><span className="lf-code">{p.ledger_code}</span> {p.ledger_name}</td>
                      <td className="lf-num" style={{ padding: '6px 12px', textAlign: 'right' }}>{p.debit !== '0.00' ? `Dr ${p.debit}` : `Cr ${p.credit}`}</td>
                    </tr>))}</tbody>
                </table>
              </Card>
            )}
          </div>
        </div>
      </div>

      <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, margin: '16px -24px -48px', padding: '12px 24px', background: 'var(--surface)',
        borderTop: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={() => navigate(voucher ? `/accounting/vouchers/${voucher.id}` : '/accounting/vouchers')}>Cancel</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void save('draft')} data-testid="save-draft">Save draft</Button>
        <Button variant="primary" icon={needsApproval ? 'arrow-up-right' : 'check'} loading={busy} disabled={busy || !canPost} onClick={() => void save(needsApproval ? 'submit' : 'post')}
          data-testid="post-voucher">{needsApproval ? 'Submit for approval' : 'Post voucher'}</Button>
      </div>
      {backdated && <ConfirmDialog title="Post a back-dated voucher?" confirmLabel="Yes, post it" tone="warning"
        description={`It is dated ${s.date}, older than the company's back-date window.`} onClose={() => setBackdated(null)}
        onConfirm={() => { const a = backdated; setBackdated(null); void save(a, true) }} />}
      {guard.dialog}
    </form>
  )
}
