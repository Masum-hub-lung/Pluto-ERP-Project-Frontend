/** Keyboard state of a search-as-you-type select (AsyncSelect): which option is highlighted and whether it is open. */
export interface ComboState { open: boolean; active: number }
export type ComboKey = 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Escape' | 'Home' | 'End'
export type ComboResult = ComboState & { choose?: number }

/** ↑ ↓ move (wrapping), Home/End jump, Enter chooses the highlighted option, Esc closes. Pure, for unit tests. */
export function comboKey(s: ComboState, key: ComboKey, count: number): ComboResult {
  if (key === 'Escape') return { open: false, active: -1 }
  if (count === 0) return { open: key === 'ArrowDown' || key === 'ArrowUp' ? true : s.open, active: -1 }
  switch (key) {
    case 'ArrowDown': return { open: true, active: !s.open || s.active < 0 ? 0 : (s.active + 1) % count }
    case 'ArrowUp': return { open: true, active: !s.open || s.active < 0 ? count - 1 : (s.active - 1 + count) % count }
    case 'Home': return { open: true, active: 0 }
    case 'End': return { open: true, active: count - 1 }
    case 'Enter': return s.open && s.active >= 0 ? { open: false, active: -1, choose: s.active } : s
  }
}
