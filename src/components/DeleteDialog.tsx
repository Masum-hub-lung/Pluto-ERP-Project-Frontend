import { useState } from 'react'
import { ds } from '../ds'
import { ResponsiveDialog } from './ResponsiveDialog'

/** L7 delete confirmation (02 #page-l7): the user types the record's name before Delete is enabled. */
export function DeleteDialog({ name, what, description, loading, onConfirm, onClose }: {
  name: string; what: string; description?: string; loading?: boolean; onConfirm: () => void; onClose: () => void
}) {
  const { Button, Field, Input } = ds()
  const [typed, setTyped] = useState('')
  const label = `Type the ${what} name to confirm`
  return (
    <ResponsiveDialog title={`Delete ${name}?`} description={description ?? 'This cannot be undone.'} tone="negative" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={typed.trim() !== name || loading} loading={loading} onClick={onConfirm}>Delete {what}</Button></>}>
      <Field label={label}>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} aria-label={label} autoFocus />
      </Field>
    </ResponsiveDialog>
  )
}
