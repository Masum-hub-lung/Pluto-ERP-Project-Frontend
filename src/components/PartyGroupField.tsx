import { useState } from 'react'
import { ApiError } from '../api/client'
import { useCreatePartyGroup, usePartyGroups, type PartyType } from '../api/parties'
import { ds } from '../ds'
import { useIdempotencyKey } from '../lib/useIdempotencyKey'
import { ResponsiveDialog } from './ResponsiveDialog'

const ADD = '__add__'

/**
 * Customer/supplier group select with "Add group…" (B2/C2, backlog P2.2-FE-03): the last option opens a small dialog,
 * POST /party-groups creates the group and the select picks it. `value` is the group id as a string ('' = none).
 */
export function PartyGroupField({ type, value, onChange, id, error }: {
  type: PartyType; value: string; onChange: (groupId: string) => void; id?: string; error?: string
}) {
  const { Field, Select, Input, Button } = ds()
  const groups = usePartyGroups(type)
  const create = useCreatePartyGroup()
  const idem = useIdempotencyKey()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | undefined>()
  const noun = type === 'supplier' ? 'Supplier' : 'Customer'

  const close = () => { setAdding(false); setName(''); setNameError(undefined) }
  async function save() {
    if (!name.trim()) { setNameError('Enter a group name'); return }
    try {
      const g = await create.mutateAsync({ input: { party_type: type, name: name.trim() }, idempotencyKey: idem.key })
      idem.reset()
      onChange(String(g.id))
      close()
    } catch (e) {
      setNameError(e instanceof ApiError ? (e.problem.errors?.name?.[0] ?? e.problem.title) : 'The group could not be saved')
    }
  }

  return (
    <>
      <Field label={`${noun} group`} hint="Used to filter lists and reports" htmlFor={id} error={error}>
        <Select id={id} value={value} onChange={(e) => (e.target.value === ADD ? setAdding(true) : onChange(e.target.value))}
          options={[{ value: '', label: 'No group' }, ...(groups.data ?? []).map((g) => ({ value: String(g.id), label: g.name })), { value: ADD, label: 'Add group…' }]} />
      </Field>
      {adding && (
        <ResponsiveDialog title={`Add a ${noun.toLowerCase()} group`} description="For example Wholesale, Edible oils or Packaging." onClose={close} width={420}
          testId="add-group-dialog"
          footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} disabled={create.isPending} onClick={() => void save()}>Add group</Button></>}>
          {/* No <form> here: the dialog renders inside the supplier/customer form, and a nested form would let Enter submit that one. */}
          <Field label="Group name" required error={nameError} htmlFor="new-group-name">
            <Input id="new-group-name" value={name} maxLength={80} autoFocus invalid={!!nameError} onChange={(e) => { setName(e.target.value); setNameError(undefined) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save() } }} />
          </Field>
        </ResponsiveDialog>
      )}
    </>
  )
}
