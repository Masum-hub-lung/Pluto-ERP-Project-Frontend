import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ds } from '../../ds'

/** The section rail of the Settings design (Settings.dc.html). Built: Financial year (K4), Accounting defaults (K16), Security; the rest say so honestly. */
const RAIL: Array<{ title: string; items: Array<{ label: string; icon: string; path?: string }> }> = [
  { title: 'Business', items: [{ label: 'Company profile', icon: 'building-2' }, { label: 'Preferences', icon: 'sliders-horizontal' },
    { label: 'Financial year', icon: 'calendar', path: '/settings/financial-years' }, { label: 'Accounting defaults', icon: 'book-open-text', path: '/settings/accounting' },
    { label: 'Currency and region', icon: 'banknote' }, { label: 'Tax', icon: 'percent' },
    { label: 'Invoice design', icon: 'file-text' }] },
  { title: 'People', items: [{ label: 'Users', icon: 'users' }, { label: 'Roles and permissions', icon: 'list-tree' }] },
  { title: 'You', items: [{ label: 'Notifications', icon: 'bell' }, { label: 'Appearance', icon: 'eye' },
    { label: 'Security', icon: 'circle-check', path: '/settings/security' }] },
  { title: 'Data', items: [{ label: 'Backup and export', icon: 'download' }] },
]

export function SettingsLayout({ current, eyebrow, title, description, children }:
  { current: string; eyebrow: string; title: string; description: string; children: ReactNode }) {
  const { PageHeader, Icon } = ds()
  const navigate = useNavigate()
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <div className="se-wrap">
        <nav className="se-rail" aria-label="Settings sections">
          {RAIL.map((g) => (
            <div key={g.title} style={{ display: 'contents' }}>
              <span className="se-rail-h">{g.title}</span>
              {g.items.map((it) => (
                <button key={it.label} type="button" className="se-link" aria-current={it.label === current ? 'page' : 'false'}
                  onClick={() => (it.path ? navigate(it.path) : navigate('/not-in-release', { state: { label: `Settings › ${it.label}` } }))}>
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
