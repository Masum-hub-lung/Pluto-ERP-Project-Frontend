import { useState } from 'react'
import type { Ledger, Party } from '../../api/contract.gen'
import { LedgerPicker } from '../../components/pickers/LedgerPicker'
import { PartyPicker } from '../../components/pickers/PartyPicker'
import { ds } from '../../ds'

/** Development-only page (/dev/pickers, registered only when import.meta.env.DEV): try the async pickers. */
export function PickersDemo() {
  const { PageHeader, Card, Field } = ds()
  const [party, setParty] = useState<Party | null>(null)
  const [ledger, setLedger] = useState<Ledger | null>(null)
  return (
    <>
      <PageHeader eyebrow="Development" title="Pickers" description="Search-as-you-type selects used by later forms." />
      <Card title="PartyPicker and LedgerPicker">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <Field label="Customer" htmlFor="dev-party"><PartyPicker id="dev-party" aria-label="Customer" type="customer" value={party} onChange={setParty} /></Field>
          <Field label="Purchase ledger" htmlFor="dev-ledger"><LedgerPicker id="dev-ledger" aria-label="Purchase ledger" purpose="purchase_for_supplier" value={ledger} onChange={setLedger} /></Field>
        </div>
        <p style={{ color: 'var(--ink-muted)' }} data-testid="dev-choice">Chosen: {party ? party.code : '—'} · {ledger ? ledger.code : '—'}</p>
      </Card>
    </>
  )
}
