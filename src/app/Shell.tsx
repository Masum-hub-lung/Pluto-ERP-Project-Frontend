import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../auth/session'
import { lf } from '../ds'
import { useToast } from './toast'

/** App shell from the design (Parties.dc.html / Shell.dc.html): sidebar navigation, top bar, page area. */
export function Shell() {
  const { Sidebar, NavSection, NavItem, NavSubItem, Topbar, Menu } = lf()
  const { me, signOut, companyId } = useSession()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const toast = useToast()
  const [profileOpen, setProfileOpen] = useState(false)
  const avatarZone = useRef<HTMLDivElement>(null)
  const company = me?.companies.find((c) => c.company_id === companyId)
  const inCustomers = pathname.startsWith('/customers')
  const soon = (label: string) => () => navigate('/not-in-release', { state: { label } })

  useEffect(() => {
    if (!profileOpen) return
    const close = (e: MouseEvent) => { if (!avatarZone.current?.contains(e.target as Node)) setProfileOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [profileOpen])

  return (
    <div data-theme="light" style={{ minHeight: '100vh', display: 'flex', background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: '20px' }}>
      <div className="lf-shell-side" style={{ flex: 'none', alignSelf: 'stretch' }}>
        <Sidebar company={{ name: company?.company_name ?? '—', meta: 'BDT' }} user={{ name: me?.name ?? '', role: company?.role ?? '' }}>
          <NavSection>
            <NavItem icon="layout-dashboard" label="Dashboard" onClick={soon('Dashboard')} />
          </NavSection>
          <NavSection label="Operations">
            <NavItem icon="receipt-text" label="Sales" onClick={soon('Sales')} />
            <NavItem icon="shopping-cart" label="Purchases" onClick={soon('Purchases')} />
            <NavItem icon="file-text" label="LC Management" onClick={soon('LC Management')} />
            <NavItem icon="users" label="Customers" active={inCustomers} open={inCustomers} onClick={() => navigate('/customers')}>
              <NavSubItem label="All customers" active={pathname === '/customers'} onClick={() => navigate('/customers')} />
              <NavSubItem label="Add customer" active={pathname === '/customers/new'} onClick={() => navigate('/customers/new')} />
            </NavItem>
            <NavItem icon="truck" label="Suppliers" onClick={soon('Suppliers')} />
            <NavItem icon="package" label="Inventory" onClick={soon('Inventory')} />
          </NavSection>
          <NavSection label="Money">
            <NavItem icon="landmark" label="Cash and bank" onClick={soon('Cash and bank')} />
            <NavItem icon="wallet" label="Income and expenses" onClick={soon('Income and expenses')} />
          </NavSection>
          <NavSection label="Books">
            <NavItem icon="book-open-text" label="Accounting" onClick={soon('Accounting')} />
            <NavItem icon="scale" label="Reports" onClick={soon('Reports')} />
          </NavSection>
          <NavSection label="Admin">
            <NavItem icon="settings" label="Settings" active={pathname.startsWith('/settings')} onClick={() => navigate('/settings/security')} />
          </NavSection>
        </Sidebar>
      </div>
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="lf-shell-top" style={{ position: 'relative' }}>
          <Topbar breadcrumbs={crumbs(pathname)} company={company?.company_name} fy={fyLabel(new Date())} notifications={0} user={me?.name}
            onCreateItem={(label) => (label === 'Customer or supplier' ? navigate('/customers/new') : toast({ tone: 'info', title: `${label}: not in this release yet` }))} />
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
        <main className="lf-page">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function crumbs(path: string): string[] {
  if (path === '/customers') return ['Customers']
  if (path === '/customers/new') return ['Customers', 'New customer']
  if (/^\/customers\/\d+\/edit$/.test(path)) return ['Customers', 'Edit customer']
  if (/^\/customers\/\d+$/.test(path)) return ['Customers', 'Customer']
  if (path === '/settings/security') return ['Settings', 'Security']
  return ['LedgerFlow']
}

/** Bangladesh financial year label (July-June, the company default in 04 §11.2). */
export function fyLabel(d: Date): string {
  const start = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1
  return `FY ${start}–${String((start + 1) % 100).padStart(2, '0')}`
}

