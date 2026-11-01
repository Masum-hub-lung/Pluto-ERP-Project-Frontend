/**
 * Keyboard shortcuts (NFR-054; TC-FE-005; backlog P14.2-FE-05), as the design's Create menu shows them:
 *  - Ctrl K (⌘K on a Mac): command palette — anywhere, also inside fields;
 *  - Alt S / P / R / Y / J / C: new sales invoice, purchase bill, receipt, supplier payment, journal, contra voucher —
 *    not while typing in a field, where Alt (Option on a Mac) letters type characters;
 *  - Ctrl S: save the form (its "Save" / "Save draft" button); Ctrl Enter: the form's primary action. Both work from
 *    inside fields, which is where they are needed, and stop the browser's own "Save page".
 * `shortcutFor` is pure (unit-tested); the Shell wires it to window keydown.
 */
export type ShortcutAction =
  | { kind: 'palette' }
  | { kind: 'create'; key: 'S' | 'P' | 'R' | 'Y' | 'J' | 'C'; path: string; permission: string; label: string }
  | { kind: 'save' }
  | { kind: 'primary' }

export const CREATE_SHORTCUTS = {
  S: { path: '/sales/invoices/new', permission: 'sales.create', label: 'New sales invoice' },
  P: { path: '/purchases/bills/new', permission: 'purchases.create', label: 'New purchase bill' },
  R: { path: '/sales/payments/new', permission: 'sales.create', label: 'Record a receipt' },
  Y: { path: '/purchases/payments/new', permission: 'purchases.create', label: 'Pay a supplier' },
  J: { path: '/accounting/vouchers/new/journal', permission: 'accounting.create', label: 'Journal voucher' },
  C: { path: '/accounting/vouchers/new/contra', permission: 'banking.create', label: 'Contra voucher' },
} as const

export interface KeyLike { key: string; code?: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; target?: unknown }

/** True when the event comes from somewhere the user types (input, textarea, select, contenteditable). */
export function inField(target: unknown): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean; type?: string } | null
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true
  return tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes((el.type ?? 'text').toLowerCase())
}

export function shortcutFor(e: KeyLike, mac = false): ShortcutAction | null {
  const mod = mac ? e.metaKey : e.ctrlKey
  // Alt S on some layouts reports e.key as a special character; the physical key (code) still says KeyS.
  const letter = (e.code?.startsWith('Key') ? e.code.slice(3) : e.key).toUpperCase()
  if (mod && !e.altKey && !e.shiftKey && letter === 'K') return { kind: 'palette' }
  if (mod && !e.altKey && !e.shiftKey && letter === 'S') return { kind: 'save' }
  if (mod && !e.altKey && e.key === 'Enter') return { kind: 'primary' }
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && letter in CREATE_SHORTCUTS && !inField(e.target)) {
    const key = letter as keyof typeof CREATE_SHORTCUTS
    return { kind: 'create', key, ...CREATE_SHORTCUTS[key] }
  }
  return null
}

/**
 * The button Ctrl S or Ctrl Enter presses on the current page: one marked data-shortcut="save" / "primary", else the
 * visible "Save" / "Save draft" button (save) or the primary button of the sticky form footer or open dialog (primary).
 */
export function shortcutButton(kind: 'save' | 'primary', root: ParentNode = document): HTMLButtonElement | null {
  const visible = (b: HTMLButtonElement) => !b.disabled && b.offsetParent !== null
  const marked = [...root.querySelectorAll<HTMLButtonElement>(`button[data-shortcut="${kind}"]`)].find(visible)
  if (marked) return marked
  if (kind === 'save') return [...root.querySelectorAll<HTMLButtonElement>('main button, [role="dialog"] button')].filter(visible)
    .find((b) => /^\s*save( draft| changes)?\s*$/i.test(b.textContent ?? '')) ?? null
  return [...root.querySelectorAll<HTMLButtonElement>('.lf-form-footer .lf-btn-primary, [role="dialog"] .lf-btn-primary')].filter(visible).pop() ?? null
}
