import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useMatches, useNavigate, useNavigationType } from 'react-router-dom'
import { currentFiscalYear, useFiscalYears } from '../api/platform'
import { useSession } from '../auth/session'
import { lf } from '../ds'
import { activePath, allLinks, QUICK_CREATE, visibleNav } from './nav'
import type { RouteHandle } from './router'
import { useToast } from './toast'
import './shell.css'

/** VITE_APP_ENV: local | preview | production (backlog P0.5-FE-02); anything but production shows a badge. */
const APP_ENV: string = import.meta.env.VITE_APP_ENV || 'local'

/**
 * App shell (02 S0, Shell.dc.html): sidebar built from the navigation registry (nav.ts) for the user's permissions,
 * top bar with breadcrumbs from the route, the current financial year, quick create and the profile menu; the
 * company card switches company when the user belongs to more than one.
 */
export function Shell() {
  const { Sidebar, NavSection, NavItem, NavSubItem, Topbar, Menu, Badge, Icon } = lf()
  const { me, signOut, companyId, can, switchCompany } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const { pathname } = location
  const navigationType = useNavigationType()
  const matches = useMatches()
  const toast = useToast()
  const fiscalYears = useFiscalYears()
  const [profileOpen, setProfileOpen] = useState(false)
  const [companyOpen, setCompanyOpen] = useState(false)
  const avatarZone = useRef<HTMLDivElement>(null)
  const companyZone = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const [scrolled, setScrolled] = useState(false)
  const { compact, toggle: toggleSidebar } = useSidebarMode()
  const [flyout, setFlyout] = useState<null | { path: string; top: number }>(null)
  const company = me?.companies.find((c) => c.company_id === companyId)
  const companies = (me?.companies ?? []).filter((c) => c.status === 'active')
  const sections = visibleNav(can)
  const active = activePath(pathname, allLinks(sections))
  const crumbs = [...matches].reverse().map((m) => (m.handle as RouteHandle | undefined)?.crumbs).find(Boolean) ?? ['LedgerFlow']
  const fy = currentFiscalYear(fiscalYears.data)
  const fyName = fy ? fy.name.replace(/(\d)-(\d)/, '$1–$2') : fyLabel(new Date())

  useEffect(() => {
    if (!profileOpen && !companyOpen) return
    const close = (e: MouseEvent) => {
      if (!avatarZone.current?.contains(e.target as Node)) setProfileOpen(false)
      if (!companyZone.current?.contains(e.target as Node)) setCompanyOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [profileOpen, companyOpen])

  useEffect(() => { setFlyout(null) }, [pathname, compact])
  useEffect(() => {
    if (!flyout) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.lf-shell-flyout, .lf-nav-item')) setFlyout(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [flyout])

  // Top bar shadow once the page has scrolled (a 1 px sentinel at the top of the scroll area).
  useEffect(() => {
    const el = sentinel.current
    if (!el || !scroller.current) return
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { root: scroller.current })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // New page → top; browser back/forward → where the user was on that page (per history entry).
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const saved = navigationType === 'POP' ? scrollPositions.current.get(location.key) : undefined
    el.scrollTop = saved ?? 0
    const key = location.key
    const remember = () => scrollPositions.current.set(key, el.scrollTop)
    el.addEventListener('scroll', remember, { passive: true })
    return () => el.removeEventListener('scroll', remember)
  }, [location.key, navigationType])

  function quickCreate(label: string) {
    const target = QUICK_CREATE[label]
    if (target?.built) navigate(target.path)
    else toast({ tone: 'info', title: `${label}: not in this release yet` })
  }

  async function chooseCompany(id: number) {
    setCompanyOpen(false)
    if (id === companyId) return
    await switchCompany(id) // reloads the app at the landing page
  }

  return (
    <div data-theme="light" className="lf-shell" style={{ background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: '20px' }}>
      <div className="lf-shell-side" id="lf-sidebar" ref={companyZone} style={{ flex: 'none', alignSelf: 'stretch', position: 'relative' }}
        onClickCapture={(e) => { if (companies.length > 1 && (e.target as Element).closest('.lf-company')) setCompanyOpen((o) => !o) }}>
        <Sidebar compact={compact} company={{ name: company?.company_name ?? '—', meta: companies.length > 1 ? `BDT · ${companies.length} companies` : 'BDT' }} user={{ name: me?.name ?? '', role: company?.role ?? '' }}>
          {sections.map((s, si) => (
            <NavSection key={s.label ?? si} label={s.label}>
              {s.items.map((i) => {
                const itemActive = active === i.path || !!i.children?.some((c) => c.path === active)
                return (
                  <NavItem key={i.path} icon={i.icon} label={i.label} active={itemActive} open={itemActive && !!i.children?.length}
                    onClick={() => {
                      // Icon rail: sub-pages open in a flyout next to the icon instead of under it.
                      if (compact && i.children?.length) {
                        const top = (document.activeElement as HTMLElement | null)?.getBoundingClientRect().top ?? 120
                        setFlyout((f) => (f?.path === i.path ? null : { path: i.path, top }))
                      } else navigate(i.path)
                    }}>
                    {i.children?.map((c) => <NavSubItem key={c.path} label={c.label} active={active === c.path} onClick={() => navigate(c.path)} />)}
                  </NavItem>
                )
              })}
            </NavSection>
          ))}
        </Sidebar>
        <button type="button" className="lf-sidebar-handle" onClick={toggleSidebar} aria-controls="lf-sidebar" aria-expanded={!compact}
          aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'} title={`${compact ? 'Expand' : 'Collapse'} sidebar (${shortcutLabel()})`} data-testid="sidebar-handle">
          <span className="lf-handle-icon"><Icon name="chevron-left" size={16} /></span>
        </button>
        {flyout && (() => {
          const item = sections.flatMap((s) => s.items).find((i) => i.path === flyout.path)
          return item ? (
            <div className="lf-shell-flyout" style={{ position: 'fixed', left: 'calc(var(--sidebar-compact) + 10px)', top: Math.min(flyout.top, window.innerHeight - 320), minWidth: 220, zIndex: 50 }}>
              <Menu items={[{ heading: item.label, label: '' }, ...(item.children ?? []).map((c) => ({
                label: c.label, icon: active === c.path ? 'check' : undefined, onClick: () => { setFlyout(null); navigate(c.path) },
              }))]} />
            </div>
          ) : null
        })()}
        {companyOpen && (
          <Menu style={compact ? { position: 'absolute', left: 10, width: 260, top: 112, zIndex: 30 } : { position: 'absolute', left: 12, right: 12, top: 112, zIndex: 30 }}
            items={[{ heading: 'Switch company', label: '' }, ...companies.map((c) => ({
              icon: c.company_id === companyId ? 'check' : 'building-2', label: c.company_name, description: c.role, onClick: () => void chooseCompany(c.company_id),
            }))]} />
        )}
      </div>
      <div className="lf-shell-main">
        {APP_ENV !== 'production' && (
          <div data-testid="env-badge" style={{ display: 'flex', justifyContent: 'center', padding: '3px 0', background: 'var(--surface-sunken)', borderBottom: '1px solid var(--line)' }}>
            <Badge tone={APP_ENV === 'preview' ? 'info' : 'warning'}>{APP_ENV.toUpperCase()} · not the live site</Badge>
          </div>
        )}
        <div className="lf-shell-top" data-scrolled={scrolled}>
          <Topbar breadcrumbs={crumbs} company={company?.company_name} fy={fyName} notifications={0} user={me?.name} onCreateItem={quickCreate} />
          {/* The design opens the profile menu from the avatar (Shell.dc.html "profileItems"); Settings opens Security, the only built settings page. */}
          <div ref={avatarZone} style={{ position: 'absolute', right: 16, top: 0, bottom: 0, width: 40 }}>
            <button type="button" aria-label="Profile menu" aria-haspopup="menu" aria-expanded={profileOpen} data-testid="profile-menu"
              onClick={() => setProfileOpen((o) => !o)}
              style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer' }} />
            {profileOpen && (
              <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% - 6px)', minWidth: 220, zIndex: 20 }}
                items={[{ icon: 'users', label: me?.name ?? '', description: me?.email ?? '' },
                  { icon: 'settings', label: 'Settings', description: 'Security', onClick: () => { setProfileOpen(false); navigate('/settings/security') } }, '-',
                  { icon: 'log-out', label: 'Sign out', danger: true, onClick: () => { setProfileOpen(false); void signOut() } }]} />
            )}
          </div>
        </div>
        <main ref={scroller} className="lf-shell-scroll" tabIndex={-1} aria-label="Page content">
          <div ref={sentinel} className="lf-shell-sentinel" aria-hidden />
          <div className="lf-page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

/** Fallback FY label while /fiscal-years loads (Bangladesh July–June, the company default in 04 §11.2). */
export function fyLabel(d: Date): string {
  const start = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1
  return `FY ${start}–${String((start + 1) % 100).padStart(2, '0')}`
}

const SIDEBAR_PREF = 'lf.sidebar'
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const shortcutLabel = () => (isMac() ? '⌘B' : 'Ctrl+B')

/**
 * Sidebar width (P1.5-FE-02 / P1.6-FE-04): automatic by screen — full at ≥ 1200 px, icon rail at 900–1199 px —
 * until the user chooses with the edge handle or Ctrl/⌘+B; the choice is remembered (localStorage, best effort).
 */
function useSidebarMode() {
  const [pref, setPref] = useState<'expanded' | 'collapsed' | null>(() => {
    try { const v = localStorage.getItem(SIDEBAR_PREF); return v === 'expanded' || v === 'collapsed' ? v : null } catch { return null }
  })
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 1200px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1200px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const compact = pref ? pref === 'collapsed' : !wide
  const toggle = () => {
    const next = compact ? 'expanded' : 'collapsed'
    setPref(next)
    try { localStorage.setItem(SIDEBAR_PREF, next) } catch { /* storage unavailable: choice lasts this visit */ }
  }
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b' || e.altKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]'))) return
      e.preventDefault()
      toggleRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return { compact, toggle }
}
