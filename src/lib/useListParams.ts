import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * List filters, sort and page live in the URL (shareable, survive reload, back button works; 08 §6).
 * `set()` drops empty values, resets `page` when anything else changes and replaces the history entry.
 * `search`/`setSearch` is the search box text, written to `q` after a 300 ms pause.
 */
export function useListParams() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')

  function set(changes: Record<string, string | null | undefined>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) (v === null || v === undefined || v === '' ? next.delete(k) : next.set(k, v))
    if (!('page' in changes)) next.delete('page')
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }

  useEffect(() => {
    const t = setTimeout(() => set({ q: search.trim() || null }), 300)
    return () => clearTimeout(t)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const get = (name: string, fallback = '') => params.get(name) ?? fallback
  return { params, get, set, search, setSearch, page: Number(params.get('page') ?? '1') || 1 }
}
