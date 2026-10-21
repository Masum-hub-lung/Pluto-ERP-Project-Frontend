import { useEffect, useId, useRef, useState } from 'react'
import { lf } from '../ds'
import { comboKey, type ComboKey } from '../lib/combobox'

export interface AsyncSelectProps<T> {
  value: T | null
  onChange: (item: T | null) => void
  search: (q: string, signal: AbortSignal) => Promise<T[]>
  itemKey: (item: T) => string | number
  itemLabel: (item: T) => string
  renderItem?: (item: T) => React.ReactNode
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

/**
 * Search-as-you-type select for big lists (parties, ledgers, products): never loads every row. Typing searches
 * after 250 ms; ↑ ↓ Enter Esc work; "No matches" when empty. ARIA combobox pattern (role, aria-expanded,
 * aria-activedescendant) so screen readers announce the highlighted option.
 */
export function AsyncSelect<T>({ value, onChange, search, itemKey, itemLabel, renderItem, placeholder = 'Type to search', invalid, disabled, id, ...rest }: AsyncSelectProps<T>) {
  const { Input, Icon } = lf()
  const listId = useId()
  const [text, setText] = useState(value ? itemLabel(value) : '')
  const [items, setItems] = useState<T[]>([])
  const [state, setState] = useState({ open: false, active: -1 })
  const [loading, setLoading] = useState(false)
  const typed = useRef(false)

  useEffect(() => { if (!typed.current) setText(value ? itemLabel(value) : '') }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!state.open) return
    const ctrl = new AbortController()
    setLoading(true)
    const t = setTimeout(() => {
      search(typed.current ? text.trim() : '', ctrl.signal)
        .then((r) => { setItems(r); setState((s) => ({ ...s, active: r.length ? 0 : -1 })) })
        .catch(() => { if (!ctrl.signal.aborted) setItems([]) })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [text, state.open]) // eslint-disable-line react-hooks/exhaustive-deps

  function choose(i: number) {
    const item = items[i]
    if (!item) return
    typed.current = false
    onChange(item)
    setText(itemLabel(item))
    setState({ open: false, active: -1 })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Home', 'End'].includes(e.key)) return
    if (e.key === 'Enter' && !state.open) return
    e.preventDefault()
    const r = comboKey(state, e.key as ComboKey, items.length)
    if (r.choose !== undefined) choose(r.choose)
    else setState({ open: r.open, active: r.active })
  }

  const activeId = state.open && state.active >= 0 ? `${listId}-${state.active}` : undefined
  return (
    <div style={{ position: 'relative' }}>
      <Input id={id} role="combobox" aria-label={rest['aria-label']} aria-expanded={state.open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={activeId} value={text} placeholder={placeholder} invalid={invalid} disabled={disabled} icon="search" autoComplete="off"
        onChange={(e) => { typed.current = true; setText(e.target.value); setState({ open: true, active: -1 }); if (e.target.value === '') onChange(null) }}
        onFocus={() => setState((s) => ({ ...s, open: true }))}
        onBlur={() => setTimeout(() => { setState({ open: false, active: -1 }); if (typed.current) { typed.current = false; setText(value ? itemLabel(value) : '') } }, 120)}
        onKeyDown={onKeyDown} />
      {state.open && (
        <ul id={listId} role="listbox" style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: 'calc(100% + 4px)', margin: 0, padding: 4, listStyle: 'none',
          maxHeight: 280, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-2, 0 8px 24px rgb(0 0 0 / .12))' }}>
          {loading && items.length === 0 && <li style={{ padding: '8px 10px', color: 'var(--ink-muted)' }}>Searching…</li>}
          {!loading && items.length === 0 && <li role="option" aria-disabled="true" aria-selected="false" style={{ padding: '8px 10px', color: 'var(--ink-muted)' }}>No matches</li>}
          {items.map((it, i) => (
            <li key={itemKey(it)} id={`${listId}-${i}`} role="option" aria-selected={i === state.active}
              onMouseDown={(e) => { e.preventDefault(); choose(i) }} onMouseEnter={() => setState((s) => ({ ...s, active: i }))}
              style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center',
                background: i === state.active ? 'var(--brand-soft)' : undefined }}>
              {renderItem ? renderItem(it) : itemLabel(it)}
              {value && itemKey(value) === itemKey(it) && <span style={{ marginLeft: 'auto', color: 'var(--brand)' }}><Icon name="check" size={14} /></span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
