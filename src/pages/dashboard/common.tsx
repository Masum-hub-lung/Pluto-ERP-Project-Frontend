import { useNavigate } from 'react-router-dom'
import type { DashboardPeriod, Lens } from '../../api/dashboard'
import { failuresOf } from '../../api/dashboard'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { useListParams } from '../../lib/useListParams'

/**
 * Shared parts of the dashboard pages (A1–A8; backlog P14.2-FE-01..03): the lens tabs, the period control and the
 * per-widget failure lookup. A lens tab shows only when the user holds every permission the API checks for it
 * (05 GET /dashboard/lenses/{lens}; DEC-13: profit and balance lenses need reports.financial).
 */
export const LENSES: Array<{ lens: Lens; label: string; path: string; needs: string[] }> = [
  { lens: 'financial', label: 'Financial', path: '/dashboard/financial', needs: ['reports.financial'] },
  { lens: 'sales', label: 'Sales', path: '/dashboard/sales', needs: ['sales.view'] },
  { lens: 'expenses', label: 'Expenses', path: '/dashboard/expenses', needs: ['banking.view'] },
  { lens: 'receivables', label: 'Receivables', path: '/dashboard/receivables', needs: ['parties.view', 'reports.financial'] },
  { lens: 'payables', label: 'Payables', path: '/dashboard/payables', needs: ['parties.view', 'reports.financial'] },
  { lens: 'cash', label: 'Cash and bank', path: '/dashboard/cash', needs: ['banking.view', 'reports.financial'] },
  { lens: 'inventory', label: 'Inventory alerts', path: '/dashboard/inventory', needs: ['inventory.view'] },
]

export const lensAllowed = (can: (p: string) => boolean, lens: Lens) => (LENSES.find((l) => l.lens === lens)?.needs ?? []).every(can)

export const PERIODS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: 'this_month', label: 'This month' }, { value: 'this_quarter', label: 'Quarter' }, { value: 'this_year', label: 'FY to date' },
]

/** The period lives in the URL (?period=), so a link or refresh keeps it. */
export function usePeriod(): [DashboardPeriod, (p: DashboardPeriod) => void] {
  const { get, set } = useListParams()
  const raw = get('period', 'this_month')
  const period = (PERIODS.some((p) => p.value === raw) ? raw : 'this_month') as DashboardPeriod
  return [period, (p) => set({ period: p === 'this_month' ? null : p })]
}

export function PeriodControl() {
  const { Segmented } = ds()
  const [period, setPeriod] = usePeriod()
  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }} data-testid="dashboard-period">
      <Segmented options={PERIODS} value={period} onChange={(v: string) => setPeriod(v as DashboardPeriod)} />
    </div>
  )
}

/** Overview + the lenses this user may open. */
export function LensNav({ active }: { active: 'overview' | Lens }) {
  const { Tabs } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const [period] = usePeriod()
  const items = [{ value: 'overview', label: 'Overview' }, ...LENSES.filter((l) => l.needs.every(can)).map((l) => ({ value: l.lens, label: l.label }))]
  if (items.length < 2) return null
  const go = (v: string) => {
    const base = v === 'overview' ? '/dashboard' : `/dashboard/${v}`
    navigate(period === 'this_month' ? base : `${base}?period=${period}`)
  }
  return (
    <div style={{ overflowX: 'auto', marginBottom: 16 }} data-testid="lens-nav">
      <Tabs key={active} items={items} value={active} onChange={go} />
    </div>
  )
}

/** The failure entry of one widget (ERR-8), if the API reported it. */
export function failureOf(d: { widget_errors?: Array<Record<string, unknown>> } | undefined, widget: string) {
  return failuresOf(d).find((f) => f.widget === widget)
}

export function greeting(name: string | undefined, now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', hourCycle: 'h23' }).format(now))
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? `${part}, ${first}` : part
}
