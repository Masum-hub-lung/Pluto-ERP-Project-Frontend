import type { DocumentCalculation, Party } from '../../api/contract.gen'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'
import { PartyPicker } from '../pickers/PartyPicker'

/**
 * The party of a trade document (F3 supplier / E3 customer; backlog P4.4-FE-04): a PartyPicker, then a card with the
 * party's balance, overdue amount and credit limit, and — once calculated — the balance after this document and
 * the credit/overdue warnings. All figures come from the API (party resource, calculate response).
 */
export function PartyPanel({ type, party, onChange, calc, invalid, error, disabled }: {
  type: 'customer' | 'supplier'; party: Party | null; onChange: (p: Party | null) => void; calc?: DocumentCalculation | null
  invalid?: boolean; error?: string; disabled?: boolean
}) {
  const { Field, Badge } = ds()
  const label = type === 'supplier' ? 'Supplier' : 'Customer'
  const owes = type === 'supplier' ? 'You owe them' : 'They owe you'
  const row = (k: string, v: React.ReactNode, testId?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--ink-muted)' }}>{k}</span><span className="lf-num" data-testid={testId}>{v}</span>
    </div>
  )
  const side = (p: Party) => (p.balance_side === (type === 'supplier' ? 'cr' : 'dr') || p.balance === '0.00' ? owes : 'Advance')
  const warnings = (calc?.warnings ?? []).filter((w) => w.code === 'CREDIT_LIMIT_EXCEEDED' || w.code === 'PARTY_OVERDUE')
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="party-panel">
      <Field label={label} required error={error} htmlFor="doc-party">
        <PartyPicker id="doc-party" type={type} value={party} onChange={onChange} invalid={invalid} disabled={disabled} aria-label={label} />
      </Field>
      {party && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong>{party.name}</strong><span className="lf-code">{party.code}</span>
          </div>
          {row(`Balance (${side(party)})`, formatTaka(party.balance, { symbol: true }), 'party-balance')}
          {party.overdue !== '0.00' && row('Overdue', <Badge tone="warning">{formatTaka(party.overdue, { symbol: true })}</Badge>)}
          {party.credit_limit && row('Credit limit', formatTaka(party.credit_limit, { symbol: true }))}
          {calc?.party_balance_after && row('After this document', formatTaka(calc.party_balance_after, { symbol: true }), 'party-balance-after')}
          {warnings.map((w) => <span key={w.code} role="status" style={{ color: 'var(--warning)', fontSize: 13 }}>{w.message}</span>)}
        </div>
      )}
    </section>
  )
}
