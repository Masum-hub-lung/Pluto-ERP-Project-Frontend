/**
 * Remembered browser preferences (localStorage, best effort: private windows or blocked storage just forget).
 * Keys are prefixed `pluto.`; values saved under the old `lf.` keys are moved over once on first read (P1.7-FE-02).
 */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const store = (): Store | null => {
  try { return globalThis.localStorage ?? null } catch { return null }
}

export function readPref(key: string, legacyKey?: string, s: Store | null = store()): string | null {
  if (!s) return null
  try {
    const v = s.getItem(key)
    if (v !== null || !legacyKey) return v
    const old = s.getItem(legacyKey)
    if (old !== null) {
      s.setItem(key, old)
      s.removeItem(legacyKey)
    }
    return old
  } catch {
    return null
  }
}

export function writePref(key: string, value: string, s: Store | null = store()): void {
  try { s?.setItem(key, value) } catch { /* storage unavailable: the choice lasts this visit */ }
}
