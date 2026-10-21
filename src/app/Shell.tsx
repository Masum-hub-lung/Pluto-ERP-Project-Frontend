import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useMatches, useNavigate, useNavigationType } from 'react-router-dom'
import { currentFiscalYear, useFiscalYears } from '../api/platform'
import { useSession } from '../auth/session'
import { ds } from '../ds'
import { NavDrawer } from '../components/NavDrawer'
import { initials } from '../lib/format'
import { readPref, writePref } from '../lib/prefs'
import { activePath, allLinks, QUICK_CREATE, visibleNav, type NavSection as NavSectionDef } from './nav'
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
  const { Sidebar, NavSection, NavItem, NavSubItem, Topbar, Menu, Badge, Icon, IconButton, Button } = ds()
  const { me, signOut, companyId, can, switchCompany } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const { pathname } = location
  const navigationType = useNavigationType()
  const matches = useMatches()
  const toast = useToast()
  const fiscalYears = useFiscalYears()
  const [profileOpen, setProfileOpen] = useState<false | 'top' | 'mobile'>(false) // which bar opened it
  const [companyOpen, setCompanyOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerCreateOpen, setDrawerCreateOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const avatarZone = useRef<HTMLDivElement>(null)
  const mobileAvatarZone = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
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
  const crumbs = [...matches].reverse().map((m) => (m.handle as RouteHandle | undefined)?.crumbs).find(Boolean) ?? ['Pluto']
  const fy = currentFiscalYear(fiscalYears.data)
  const fyName = fy ? fy.name.replace(/(\d)-(\d)/, '$1–$2') : fyLabel(new Date())

  useEffect(() => {
    if (!profileOpen && !companyOpen) return
    const close = (e: MouseEvent) => {
      const t = e.target as Element
      if (!avatarZone.current?.contains(t) && !mobileAvatarZone.current?.contains(t)) setProfileOpen(false)
      if (!companyZone.current?.contains(t) && !t.closest?.('.lf-navdrawer-company')) setCompanyOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [profileOpen, companyOpen])

  useEffect(() => { setFlyout(null) }, [pathname, compact])

  // Phone drawer (P1.5-FE-01): closes after navigating and when the window grows past the phone layout; opens with
  // the current module expanded.
  useEffect(() => { setDrawerOpen(false) }, [pathname])
  useEffect(() => {
    if (drawerOpen) setExpanded(active)
    else { setDrawerCreateOpen(false); setCompanyOpen(false) }
  }, [drawerOpen])
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)')
    const on = () => { if (mq.matches) setDrawerOpen(false) }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
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

  /** Sidebar and phone drawer share the registry items; in the drawer a module with sub-pages expands instead of navigating. */
  function navTree(list: NavSectionDef[], mode: 'sidebar' | 'drawer') {
    const go = (path: string) => { if (path === pathname) setDrawerOpen(false); navigate(path) }
    return list.map((s, si) => (
      <NavSection key={s.label ?? si} label={s.label}>
        {s.items.map((i) => {
          const itemActive = active === i.path || !!i.children?.some((c) => c.path === active)
          const open = mode === 'drawer' ? expanded === i.path : itemActive
          return (
            <NavItem key={i.path} icon={i.icon} label={i.label} active={itemActive} open={open && !!i.children?.length}
              onClick={() => {
                if (mode === 'drawer') {
                  if (i.children?.length) setExpanded((e) => (e === i.path ? null : i.path))
                  else go(i.path)
                } else if (compact && i.children?.length) {
                  // Icon rail: sub-pages open in a flyout next to the icon instead of under it.
                  const top = (document.activeElement as HTMLElement | null)?.getBoundingClientRect().top ?? 120
                  setFlyout((f) => (f?.path === i.path ? null : { path: i.path, top }))
                } else navigate(i.path)
              }}>
              {i.children?.map((c) => <NavSubItem key={c.path} label={c.label} active={active === c.path} onClick={() => go(c.path)} />)}
            </NavItem>
          )
        })}
      </NavSection>
    ))
  }

  const profileItems = [{ icon: 'users', label: me?.name ?? '', description: me?.email ?? '' },
    { icon: 'settings', label: 'Settings', description: 'Security', onClick: () => { setProfileOpen(false); navigate('/settings/security') } }, '-' as const,
    { icon: 'log-out', label: 'Sign out', danger: true, onClick: () => { setProfileOpen(false); void signOut() } }]
  const companyMenu = [{ heading: 'Switch company', label: '' }, ...companies.map((c) => ({
    icon: c.company_id === companyId ? 'check' : 'building-2', label: c.company_name, description: c.role, onClick: () => void chooseCompany(c.company_id),
  }))]

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
          {navTree(sections, 'sidebar')}
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
        {companyOpen && !drawerOpen && (
          <Menu style={compact ? { position: 'absolute', left: 10, width: 260, top: 112, zIndex: 30 } : { position: 'absolute', left: 12, right: 12, top: 112, zIndex: 30 }}
            items={companyMenu} />
        )}
      </div>
      <div className="lf-shell-main">
        {APP_ENV !== 'production' && (
          <div data-testid="env-badge" style={{ display: 'flex', justifyContent: 'center', padding: '3px 0', background: 'var(--surface-sunken)', borderBottom: '1px solid var(--line)' }}>
            <Badge tone={APP_ENV === 'preview' ? 'info' : 'warning'}>{APP_ENV.toUpperCase()} · not the live site</Badge>
          </div>
        )}
        {/* Phone layout (< 900 px, P1.5-FE-01): menu button, page title, profile; the CSS shows it instead of the top bar. */}
        <header className="lf-mobilebar" data-scrolled={scrolled}>
          <button ref={menuButton} type="button" className="lf-mobilebar-btn" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={drawerOpen}
            aria-controls="lf-navdrawer" data-testid="open-menu" onClick={() => setDrawerOpen(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="lf-mobilebar-title">{crumbs[crumbs.length - 1]}</span>
          <div ref={mobileAvatarZone} className="lf-mobilebar-profile">
            <button type="button" className="lf-mobilebar-btn" aria-label="Profile menu" aria-haspopup="menu" aria-expanded={profileOpen === 'mobile'}
              data-testid="mobile-profile-menu" onClick={() => setProfileOpen((o) => (o === 'mobile' ? false : 'mobile'))}>
              <span className="lf-avatar lf-avatar-accent" style={{ width: 32, height: 32, fontSize: 13 }} aria-hidden="true">{initials(me?.name ?? '')}</span>
            </button>
            {profileOpen === 'mobile' && <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% + 2px)', minWidth: 220, zIndex: 20 }} items={profileItems} />}
          </div>
        </header>
        <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} returnFocus={menuButton}
          header={<>
            <div className="lf-navdrawer-create">
              <Button variant="primary" size="sm" icon="plus" onClick={() => setDrawerCreateOpen((o) => !o)} data-testid="drawer-create">Create</Button>
              {drawerCreateOpen && (
                <Menu style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', minWidth: 230, zIndex: 5 }}
                  items={QUICK_CREATE_MENU.map((it) => (it === '-' ? it : { ...it, onClick: () => { setDrawerCreateOpen(false); setDrawerOpen(false); quickCreate(it.label) } }))} />
              )}
            </div>
            <span className="lf-navdrawer-fy"><Icon name="calendar" size={14} />{fyName}</span>
            <IconButton icon="x" label="Close menu" onClick={() => setDrawerOpen(false)} />
          </>}>
          <div className="lf-navdrawer-company" onClickCapture={(e) => { if (companies.length > 1 && (e.target as Element).closest('.lf-company')) setCompanyOpen((o) => !o) }}>
            <Sidebar company={{ name: company?.company_name ?? '—', meta: companies.length > 1 ? `BDT · ${companies.length} companies` : 'BDT' }} user={{ name: me?.name ?? '', role: company?.role ?? '' }}>
              {navTree(sections, 'drawer')}
            </Sidebar>
            {companyOpen && drawerOpen && <Menu style={{ position: 'absolute', left: 12, right: 12, top: 112, zIndex: 30 }} items={companyMenu} />}
          </div>
        </NavDrawer>
        <div className="lf-shell-top" data-scrolled={scrolled}>
          <Topbar breadcrumbs={crumbs} company={company?.company_name} fy={fyName} notifications={0} user={me?.name} onCreateItem={quickCreate} />
          {/* The design opens the profile menu from the avatar (Shell.dc.html "profileItems"); Settings opens Security, the only built settings page. */}
          <div ref={avatarZone} style={{ position: 'absolute', right: 16, top: 0, bottom: 0, width: 40 }}>
            <button type="button" aria-label="Profile menu" aria-haspopup="menu" aria-expanded={profileOpen === 'top'} data-testid="profile-menu"
              onClick={() => setProfileOpen((o) => (o === 'top' ? false : 'top'))}
              style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'pointer' }} />
            {profileOpen === 'top' && (
              <Menu style={{ position: 'absolute', right: 0, top: 'calc(100% - 6px)', minWidth: 220, zIndex: 20 }} items={profileItems} />
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

/** The top bar's quick-create menu (bundle Topbar), repeated in the phone drawer header. */
const QUICK_CREATE_MENU: Array<{ icon: string; label: string } | '-'> = [
  { icon: 'receipt-text', label: 'Sales invoice' }, { icon: 'shopping-cart', label: 'Purchase bill' }, { icon: 'hand-coins', label: 'Receipt' },
  { icon: 'banknote', label: 'Payment' }, { icon: 'book-open-text', label: 'Journal voucher' }, '-',
  { icon: 'users', label: 'Customer or supplier' }, { icon: 'package', label: 'Product' },
]

/** Fallback FY label while /fiscal-years loads (Bangladesh July–June, the company default in 04 §11.2). */
export function fyLabel(d: Date): string {
  const start = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1
  return `FY ${start}–${String((start + 1) % 100).padStart(2, '0')}`
}

const SIDEBAR_PREF = 'pluto.sidebar'
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const shortcutLabel = () => (isMac() ? '⌘B' : 'Ctrl+B')

/**
 * Sidebar width (P1.5-FE-02 / P1.6-FE-04): automatic by screen — full at ≥ 1200 px, icon rail at 900–1199 px —
 * until the user chooses with the edge handle or Ctrl/⌘+B; the choice is remembered (localStorage, best effort).
 */
function useSidebarMode() {
  const [pref, setPref] = useState<'expanded' | 'collapsed' | null>(() => {
    const v = readPref(SIDEBAR_PREF, 'lf.sidebar')
    return v === 'expanded' || v === 'collapsed' ? v : null
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
    writePref(SIDEBAR_PREF, next)
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
