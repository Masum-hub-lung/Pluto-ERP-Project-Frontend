import { useBranches } from '../../api/platform'
import { ds } from '../../ds'

/**
 * Filter-bar controls of the financial reports (backlog P9.2-FE-01). Values live in the URL (useListParams), so a
 * report can be bookmarked, shared and printed as filtered; `onChange('')` clears a value back to the API default.
 */
export function DateFilter({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const { Field, Input } = ds()
  return (
    <div style={{ width: 170 }}>
      <Field label={label} htmlFor={id}><Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} /></Field>
    </div>
  )
}

export function ChoiceFilter({ label, value, options, onChange }: {
  label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void
}) {
  const { Field, Segmented } = ds()
  return (
    <div role="group" aria-label={label}>
      <Field label={label}><Segmented size="sm" value={value} options={options} onChange={onChange} /></Field>
    </div>
  )
}

/** Branch filter: hidden when the company has a single branch (nothing to choose). */
export function BranchFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { Field, Select } = ds()
  const branches = useBranches()
  const list = branches.data ?? []
  if (list.length < 2) return null
  return (
    <div style={{ width: 200 }}>
      <Field label="Branch" htmlFor="rpt-branch">
        <Select id="rpt-branch" value={value} onChange={(e) => onChange(e.target.value)}
          options={[{ value: '', label: 'All branches' }, ...list.map((b) => ({ value: String(b.id), label: b.name }))]} />
      </Field>
    </div>
  )
}
