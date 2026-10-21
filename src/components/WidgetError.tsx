import { ds } from '../ds'

/** Small in-card error with Retry, so one failing widget does not break the whole page (dashboards, L11). */
export function WidgetError({ title = 'Could not load this', onRetry }: { title?: string; onRetry?: () => void }) {
  const { Icon, Button } = ds()
  return (
    <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--negative-soft)', color: 'var(--ink)' }}>
      <span style={{ color: 'var(--negative)', display: 'inline-flex' }}><Icon name="triangle-alert" size={16} /></span>
      <span style={{ flex: 1 }}>{title}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  )
}
