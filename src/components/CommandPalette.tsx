import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SEARCH_TYPES, useSearch } from '../api/dashboard'
import { allLinks, visibleNav } from '../app/nav'
import { useSession } from '../auth/session'
import { ds } from '../ds'
import { CREATE_SHORTCUTS } from '../lib/shortcuts'

/**
 * L2 command palette (States.dc.html L2; FR-012; NFR-054; backlog P14.2-FE-04): Ctrl K anywhere. Type to search the
 * company (GET /search, 5 per type, only the types this user may view) and to filter commands — the pages of the
 * sidebar and the create shortcuts this role may use. ↑ ↓ move, Enter opens, Esc closes; "See all results" opens L1.
 * Uses the design system's palette styles (lf-cmdk) with real data.
 */
interface Item { id: string; group: string; icon: string; label: string; meta?: string; kbd?: string; go: () => void }

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { Icon } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { const t = setTimeout(() => setTerm(q), 200); return () => clearTimeout(t) }, [q])
  const search = useSearch(term, { limit: 5 })
  const open = (path: string) => { onClose(); navigate(path) }

  const items = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const out: Item[] = []
    if (term.trim().length >= 2 && search.data) {
      for (const g of search.data.groups) {
        for (const h of g.items) {
          out.push({ id: `${g.type}-${h.id}`, group: SEARCH_TYPES[g.type]?.label ?? g.type, icon: SEARCH_TYPES[g.type]?.icon ?? 'search', label: h.title,
            meta: [h.subtitle, h.badge].filter(Boolean).join(' · '), go: () => open(h.url) })
        }
      }
    }
    const creates = Object.entries(CREATE_SHORTCUTS).filter(([, c]) => can(c.permission)).map(([k, c]) => ({
      id: `create-${k}`, group: 'Create', icon: 'plus', label: c.label, kbd: `Alt ${k}`, go: () => open(c.path) }))
    const pages = allLinks(visibleNav(can)).filter((l) => l.built).map((l) => ({ id: `page-${l.path}`, group: 'Go to', icon: 'arrow-right', label: l.label, meta: l.path, go: () => open(l.path) }))
    const match = (i: Item) => !ql || i.label.toLowerCase().includes(ql) || (i.meta ?? '').toLowerCase().includes(ql)
    out.push(...creates.filter(match), ...pages.filter(match).slice(0, ql ? 8 : 6))
    if (term.trim().length >= 2) out.push({ id: 'all', group: 'Search', icon: 'search', label: `See all results for “${term.trim()}”`, go: () => open(`/search?q=${encodeURIComponent(term.trim())}`) })
    return out
  }, [q, term, search.data, can]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setActive(0) }, [items.length, term])
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active])
  useEffect(() => { input.current?.focus() }, [])

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.go() }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  const groups: Array<[string, Array<Item & { index: number }>]> = []
  items.forEach((it, index) => {
    const g = groups.find(([name]) => name === it.group)
    g ? g[1].push({ ...it, index }) : groups.push([it.group, [{ ...it, index }]])
  })
  const searching = term.trim().length >= 2 && search.isFetching
  const nothing = term.trim().length >= 2 && !search.isFetching && (search.data?.groups ?? []).every((g) => g.count === 0)

  return (
    <div className="lf-scrim lf-scrim-top" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} style={{ zIndex: 60 }}>
      <div className="lf-cmdk" role="dialog" aria-modal="true" aria-label="Command palette" data-testid="command-palette">
        <div className="lf-cmdk-input">
          <Icon name="search" size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={keys} placeholder="Search invoices, parties, vouchers… or type a command"
            role="combobox" aria-expanded="true" aria-controls="lf-cmdk-list" aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined}
            aria-autocomplete="list" data-testid="palette-input" />
          <kbd className="lf-kbd">Esc</kbd>
        </div>
        <div className="lf-cmdk-list" id="lf-cmdk-list" role="listbox" ref={list}>
          {searching && items.length === 0 && <div className="lf-cmdk-empty">Searching…</div>}
          {groups.map(([name, its]) => (
            <div key={name} role="group" aria-label={name}>
              <div className="lf-menu-heading">{name}</div>
              {its.map((it) => (
                <button type="button" key={it.id} id={`cmdk-${it.id}`} role="option" aria-selected={it.index === active} data-index={it.index} data-testid={`palette-${it.id}`}
                  className={`lf-menu-item${it.index === active ? ' is-active' : ''}`} onMouseMove={() => setActive(it.index)} onClick={it.go}>
                  <Icon name={it.icon} size={16} />
                  <span className="lf-menu-label">{it.label}{it.meta && <span className="lf-menu-desc">{it.meta}</span>}</span>
                  {it.kbd && <kbd className="lf-kbd">{it.kbd}</kbd>}
                </button>
              ))}
            </div>
          ))}
          {nothing && <div className="lf-cmdk-empty" data-testid="palette-empty">No results for “{term.trim()}”</div>}
        </div>
        <div className="lf-cmdk-foot">
          <span><kbd className="lf-kbd">↑</kbd><kbd className="lf-kbd">↓</kbd> to move</span>
          <span><kbd className="lf-kbd">Enter</kbd> to open</span>
        </div>
      </div>
    </div>
  )
}
