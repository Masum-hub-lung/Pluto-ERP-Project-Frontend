import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { SetupChecklist as Checklist, SetupStep } from '../../api/contract.gen'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'

/**
 * PEP-511 new-company setup checklist on the dashboard: nine first steps, each ticked by the server from the company's
 * own data (never by hand), with a "Do this" link. Shown until every step is done or an Owner hides it.
 * Wording and links live here (one place, ready for Bangla later); the API only says which keys are done.
 */
export const SETUP_STEPS: Record<SetupStep['key'], { title: string; hint: string; path: string; permission: string }> = {
  profile: { title: 'Add your company address and BIN/TIN', hint: 'Printed on invoices and statements', path: '/settings/company', permission: 'settings.edit' },
  logo: { title: 'Upload your logo', hint: 'Your invoices and PDFs carry it', path: '/settings/company', permission: 'settings.edit' },
  tax: { title: 'Set up VAT and tax rules', hint: 'So invoices and bills work out tax for you', path: '/settings/tax', permission: 'settings.edit' },
  money: { title: 'Add your bank and cash accounts', hint: 'With their opening balances', path: '/banking/accounts/new', permission: 'banking.create' },
  warehouse: { title: 'Add a warehouse (godown)', hint: 'Where your stock is kept', path: '/inventory/warehouses', permission: 'inventory.edit' },
  items: { title: 'Add the items you buy and sell', hint: 'One by one, or import a spreadsheet', path: '/inventory/products/new', permission: 'inventory.create' },
  customers: { title: 'Add your customers', hint: 'With what they owe you today', path: '/customers/new', permission: 'parties.create' },
  first_invoice: { title: 'Post your first sales invoice', hint: 'Stock, the books and the customer’s balance update together', path: '/sales/invoices/new', permission: 'sales.create' },
  team: { title: 'Invite your team', hint: 'Accountant, store keeper, sales staff, each with their own role', path: '/settings/users', permission: 'settings.users' },
}

const key = () => ['company', api.getCompany(), 'setup-checklist'] as const

export function useSetupChecklist(enabled = true) {
  return useQuery({
    queryKey: key(),
    queryFn: async ({ signal }) => (await api.request<{ data: Checklist }>('GET', '/setup-checklist', { signal })).data.data,
    staleTime: 30_000, enabled,
  })
}

export function useHideSetupChecklist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => (await api.request<{ data: Checklist }>('POST', '/setup-checklist/hide')).data.data,
    onSuccess: (data) => qc.setQueryData(key(), data),
  })
}

/** The dashboard card; renders nothing once every step is done or it was hidden. */
export function SetupChecklistCard() {
  const { Card, Button, Icon } = ds()
  const { can } = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const q = useSetupChecklist()
  const hide = useHideSetupChecklist()
  const c = q.data
  if (!c || c.hidden_at || c.done >= c.steps_count) return null
  const pct = Math.round((c.done / c.steps_count) * 100)
  return (
    <div style={{ marginBottom: 16 }} data-testid="setup-checklist">
      <Card title="Set up your company" subtitle={`${c.done} of ${c.steps_count} done`}
        actions={can('settings.edit') ? <Button size="sm" variant="ghost" loading={hide.isPending} data-testid="setup-hide"
          onClick={() => hide.mutate(undefined, { onSuccess: () => toast({ tone: 'positive', title: 'Setup checklist hidden', description: 'Each step stays available from its own page.' }) })}>Hide</Button> : null}>
        <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={c.steps_count} aria-valuenow={c.done}
          style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--brand)' }} />
        </div>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
          {c.steps.map((s) => {
            const step = SETUP_STEPS[s.key]
            return (
              <li key={s.key} data-testid={`setup-step-${s.key}`} data-done={s.done}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px', borderTop: '1px solid var(--line)' }}>
                <span aria-hidden style={{ flex: 'none', width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  background: s.done ? 'var(--positive)' : 'transparent', border: s.done ? 'none' : '2px solid var(--line-strong, var(--line))', color: 'var(--on-brand)' }}>
                  {s.done && <Icon name="check" size={14} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, textDecoration: s.done ? 'line-through' : 'none', color: s.done ? 'var(--ink-muted)' : 'var(--ink)' }}>
                    {step.title}<span className="lf-sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
                  </span>
                  {!s.done && <span style={{ display: 'block', fontSize: 13, color: 'var(--ink-muted)' }}>{step.hint}</span>}
                </span>
                {!s.done && can(step.permission) && <Button size="sm" variant="secondary" onClick={() => navigate(step.path)} aria-label={`Do this: ${step.title}`}>Do this</Button>}
              </li>
            )
          })}
        </ol>
      </Card>
    </div>
  )
}
