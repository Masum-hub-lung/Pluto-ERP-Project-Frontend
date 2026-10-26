import { useState } from 'react'
import type { AccountingPeriod, FiscalYear } from '../../api/contract.gen'
import { useCloseYear, useLockPeriod, useUnlockPeriod } from '../../api/accounting'
import { dhakaToday, useFiscalYears } from '../../api/platform'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden } from '../../components/states'
import { shortDate } from '../purchases/BillList'
import { SettingsLayout } from './SettingsLayout'

/**
 * K4 Financial years (Settings.dc.html K4; backlog P7.2-FE-09): each year with its monthly periods. Periods lock in
 * date order and unlock from the latest back with a reason (BR-033); a year closes after its end with every period
 * locked, posting the year-end entry to retained earnings (BR-034). The server explains any order-rule refusal.
 */
type Pending = { kind: 'lock'; period: AccountingPeriod } | { kind: 'unlock'; period: AccountingPeriod } | { kind: 'close'; year: FiscalYear } | null

export function FinancialYears() {
  const { can } = useSession()
  if (!can('settings.view') && !can('accounting.lock_period')) return <Forbidden permission="settings.view" what="financial years" />
  return <Years />
}

function Years() {
  const { Card, Badge, Button, Skeleton, Field, Input } = ds()
  const { can } = useSession()
  const toast = useToast()
  const years = useFiscalYears()
  const lock = useLockPeriod()
  const unlock = useUnlockPeriod()
  const close = useCloseYear()
  const idem = useIdempotencyKey()
  const [pending, setPending] = useState<Pending>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<unknown>(null)
  const today = dhakaToday()
  const all = (years.data ?? []).flatMap((y) => y.periods)
  const firstOpen = [...all].sort((a, b) => a.start_date.localeCompare(b.start_date)).find((p) => p.status !== 'locked' && p.start_date <= today)
  const lastLocked = [...all].sort((a, b) => b.start_date.localeCompare(a.start_date)).find((p) => p.status === 'locked')

  const confirm = async () => {
    if (!pending) return
    setError(null)
    try {
      if (pending.kind === 'lock') {
        await lock.mutateAsync({ id: pending.period.id, note: text.trim() || undefined })
        toast({ tone: 'positive', title: `${pending.period.name} locked`, description: 'Nothing can be posted into it now.' })
      } else if (pending.kind === 'unlock') {
        await unlock.mutateAsync({ id: pending.period.id, reason: text.trim() })
        toast({ tone: 'positive', title: `${pending.period.name} unlocked`, description: 'The reason is kept in the audit log.' })
      } else {
        await close.mutateAsync({ id: pending.year.id, idempotencyKey: idem.key })
        idem.reset()
        toast({ tone: 'positive', title: `${pending.year.name} closed`, description: 'Profit moved to retained earnings.' })
      }
      setPending(null); setText('')
    } catch (e) { setPending(null); setError(e) }
  }

  return (
    <SettingsLayout current="Financial year" eyebrow="Settings · Business" title="Financial years" description="Lock months once they are checked, and close the year after it ends.">
      <ProblemBanner error={error} />
      <ProblemBanner error={years.error} onRetry={() => void years.refetch()} />
      {years.isPending && <Card><Skeleton height={200} /></Card>}
      {(years.data ?? []).map((y) => {
        const closable = y.status !== 'closed' && y.end_date < today && y.periods.every((p) => p.status === 'locked')
        return (
          <Card key={y.id} title={y.name} subtitle={`${shortDate(y.start_date)} – ${shortDate(y.end_date)}`}
            actions={<>
              <Badge tone={y.status === 'closed' ? 'neutral' : 'positive'} dot>{y.status === 'closed' ? 'Closed' : 'Open'}</Badge>
              {can('accounting.close_year') && y.status !== 'closed' && (
                <Button variant="secondary" size="sm" disabled={!closable} onClick={() => setPending({ kind: 'close', year: y })} data-testid={`close-${y.id}`}>Close year</Button>
              )}
            </>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }} data-testid={`periods-${y.id}`}>
              {y.periods.map((p) => (
                <div key={p.id} data-testid={`period-${p.id}`} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <strong>{p.name}</strong>
                    <Badge tone={p.status === 'locked' ? 'neutral' : p.status === 'open' ? 'positive' : 'info'}>{p.status === 'locked' ? 'Locked' : p.status === 'open' ? 'Open' : 'Not started'}</Badge>
                  </span>
                  {p.status === 'locked' && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{p.locked_by?.name ?? ''}{p.lock_note ? ` · ${p.lock_note}` : ''}</span>}
                  {can('accounting.lock_period') && y.status !== 'closed' && p.id === firstOpen?.id && (
                    <Button variant="ghost" size="sm" icon="check" onClick={() => setPending({ kind: 'lock', period: p })} data-testid={`lock-${p.id}`}>Lock</Button>
                  )}
                  {can('accounting.lock_period') && y.status !== 'closed' && p.id === lastLocked?.id && (
                    <Button variant="ghost" size="sm" icon="refresh-cw" onClick={() => setPending({ kind: 'unlock', period: p })} data-testid={`unlock-${p.id}`}>Unlock</Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )
      })}
      {pending && (
        <ConfirmDialog tone={pending.kind === 'unlock' ? 'warning' : 'info'} loading={lock.isPending || unlock.isPending || close.isPending}
          title={pending.kind === 'lock' ? `Lock ${pending.period.name}?` : pending.kind === 'unlock' ? `Unlock ${pending.period.name}?` : `Close ${pending.year.name}?`}
          confirmLabel={pending.kind === 'lock' ? 'Lock' : pending.kind === 'unlock' ? 'Unlock' : 'Close year'}
          description={pending.kind === 'lock' ? 'Nothing can be posted, edited or reversed into this month once it is locked. Months lock in order.'
            : pending.kind === 'unlock' ? 'Postings into this month become possible again. Give the reason; it is audited.'
              : 'Posts the year-end entry moving this year\'s profit or loss to retained earnings. The year stays locked.'}
          onConfirm={() => { if (pending.kind !== 'unlock' || text.trim()) void confirm() }} onClose={() => { setPending(null); setText('') }}>
          {pending.kind !== 'close' && (
            <Field label={pending.kind === 'unlock' ? 'Reason' : 'Note'} required={pending.kind === 'unlock'} htmlFor="period-text">
              <Input id="period-text" value={text} maxLength={255} onChange={(e) => setText(e.target.value)} />
            </Field>
          )}
        </ConfirmDialog>
      )}
    </SettingsLayout>
  )
}
