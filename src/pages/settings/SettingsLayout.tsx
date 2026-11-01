import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'

/**
 * The section rail of the Settings design (Settings.dc.html; backlog P15.2-FE-01): Business, People, You, Data. A
 * section shows only when the user may open it; the personal ones (notifications, appearance, security) are for
 * everyone.
 */
export const RAIL: Array<{ title: string; items: Array<{ label: string; icon: string; path: string; permission: string | null }> }> = [
  { title: 'Business', items: [
    { label: 'Company profile', icon: 'building-2', path: '/settings/company', permission: 'settings.view' },
    { label: 'Preferences', icon: 'sliders-horizontal', path: '/settings/preferences', permission: 'settings.view' },
    { label: 'Financial year', icon: 'calendar', path: '/settings/financial-years', permission: null },
    { label: 'Accounting defaults', icon: 'book-open-text', path: '/settings/accounting', permission: 'accounting.view' },
    { label: 'Currency and region', icon: 'banknote', path: '/settings/region', permission: 'settings.view' },
    { label: 'Tax', icon: 'percent', path: '/settings/tax', permission: 'settings.view' },
    { label: 'Invoice design', icon: 'file-text', path: '/settings/invoice', permission: 'settings.view' },
  ] },
  { title: 'People', items: [
    { label: 'Users', icon: 'users', path: '/settings/users', permission: 'settings.users' },
    { label: 'Roles and permissions', icon: 'list-tree', path: '/settings/roles', permission: 'settings.roles' },
  ] },
  { title: 'You', items: [
    { label: 'Notifications', icon: 'bell', path: '/settings/notifications', permission: null },
    { label: 'Appearance', icon: 'eye', path: '/settings/appearance', permission: null },
    { label: 'Security', icon: 'circle-check', path: '/settings/security', permission: null },
  ] },
  { title: 'Data', items: [{ label: 'Backup and export', icon: 'download', path: '/settings/backup', permission: 'settings.backup' }] },
]

export function SettingsLayout({ current, eyebrow, title, description, actions, children }:
  { current: string; eyebrow: string; title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  const { PageHeader, Icon } = ds()
  const navigate = useNavigate()
  const { can } = useSession()
  const rail = RAIL.map((g) => ({ ...g, items: g.items.filter((it) => it.permission === null || can(it.permission)) })).filter((g) => g.items.length > 0)
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      <div className="se-wrap">
        <nav className="se-rail" aria-label="Settings sections" data-testid="settings-rail">
          {rail.map((g) => (
            <div key={g.title} style={{ display: 'contents' }}>
              <span className="se-rail-h">{g.title}</span>
              {g.items.map((it) => (
                <button key={it.label} type="button" className="se-link" aria-current={it.label === current ? 'page' : 'false'} onClick={() => navigate(it.path)}>
                  <span style={{ display: 'inline-flex', color: 'var(--ink-muted)' }}><Icon name={it.icon} size={16} /></span>{it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>{children}</div>
      </div>
    </>
  )
}
